-- Scheduling structure only. This migration inserts no venue, slot, session, or child.
-- A coach chooses one venue for a week; dated classes save the venue actually used.
-- Class bookings and public drop-in requests are added separately.

-- Intro is a class type, not a fourth skill group. A group's regular attendees
-- may differ from each athlete's assigned skill group.
alter table public.standing_class_slots
  alter column group_id drop not null,
  alter column location_id drop not null,
  add column class_kind text not null default 'skill_group';
alter table public.standing_class_slots
  add constraint standing_slot_kind_valid check (
    (class_kind = 'skill_group' and group_id is not null) or
    (class_kind = 'intro' and group_id is null)
  ),
  add constraint standing_slot_max_ten check (capacity <= 10);

alter table public.class_occurrences
  add column location_id uuid references public.class_locations(id),
  add constraint class_occurrence_max_ten check (capacity <= 10);

-- Preserve historical rows if test data exists, then require an explicit venue
-- for every newly created dated class. A later verification may VALIDATE this
-- constraint once any older undated-venue records are reviewed.
update public.class_occurrences o set location_id = s.location_id
  from public.standing_class_slots s
  where o.standing_slot_id = s.id and o.location_id is null
    and s.location_id is not null;
alter table public.class_occurrences
  add constraint class_occurrence_has_venue check (location_id is not null) not valid;
create index class_occurrences_location_id_idx on public.class_occurrences(location_id);

create table public.class_week_venues (
  week_start date primary key check (extract(isodow from week_start) = 1),
  location_id uuid not null references public.class_locations(id),
  selected_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.class_week_venues enable row level security;
revoke all on public.class_week_venues from public, anon, authenticated;
grant select on public.class_week_venues to authenticated;
create policy class_week_venues_coach_read on public.class_week_venues
  for select to authenticated using ((select private.is_coach()));

-- Only a coach can set a week's default. Once dated classes exist, changing
-- the default alone would make the week's published locations inconsistent.
create function public.set_class_week_venue(p_week_start date, p_location_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1
      or p_location_id is null then
    raise exception 'Choose a Monday and a venue' using errcode = '22023';
  end if;
  perform 1 from public.class_locations where id = p_location_id for share;
  if not found then
    raise exception 'Venue not found' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.class_occurrences
    where class_date >= p_week_start and class_date < p_week_start + 7
  ) then
    raise exception 'Review existing dated classes before changing this week''s venue'
      using errcode = '55000';
  end if;
  insert into public.class_week_venues (week_start, location_id, selected_by)
    values (p_week_start, p_location_id, v_actor)
    on conflict (week_start) do update set
      location_id = excluded.location_id,
      selected_by = excluded.selected_by,
      updated_at = now();
end;
$$;
revoke all on function public.set_class_week_venue(date, uuid)
  from public, anon, authenticated;
grant execute on function public.set_class_week_venue(date, uuid)
  to authenticated;
