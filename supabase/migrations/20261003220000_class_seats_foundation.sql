-- No assignments or seats are inserted. All browser writes go through checked
-- coach functions. The public parent drop-in request flow is a later step.
create table public.regular_class_assignments (
  id uuid primary key default gen_random_uuid(),
  standing_slot_id uuid not null references public.standing_class_slots(id),
  athlete_id uuid not null references public.athletes(id),
  starts_on date not null,
  ends_on date,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on > starts_on)
);
create index regular_class_assignments_athlete_idx
  on public.regular_class_assignments(athlete_id);
-- Keep an athlete's history for a slot without allowing overlapping terms.
set search_path = public, extensions, pg_catalog;
alter table public.regular_class_assignments
  add constraint no_overlapping_regular_assignment
  exclude using gist (
    athlete_id with =, standing_slot_id with =,
    daterange(starts_on, ends_on, '[)') with &&
  );
reset search_path;

create table public.class_seats (
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.class_occurrences(id),
  athlete_id uuid not null references public.athletes(id),
  seat_kind text not null check (seat_kind in ('regular', 'drop_in')),
  regular_assignment_id uuid references public.regular_class_assignments(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz not null default now(),
  cancelled_by uuid references auth.users(id),
  cancelled_at timestamptz,
  check ((seat_kind = 'regular') = (regular_assignment_id is not null)),
  check ((cancelled_at is null) = (cancelled_by is null))
);
-- A cancelled row stays for history; a new confirmation is a new row.
create unique index one_active_seat_per_athlete_class
  on public.class_seats(occurrence_id, athlete_id)
  where cancelled_at is null;
create index class_seats_active_count_idx
  on public.class_seats(occurrence_id) where cancelled_at is null;
create index class_seats_athlete_idx on public.class_seats(athlete_id);

alter table public.regular_class_assignments enable row level security;
alter table public.class_seats enable row level security;
revoke all on public.regular_class_assignments, public.class_seats
  from public, anon, authenticated;
grant select on public.regular_class_assignments, public.class_seats to authenticated;
create policy regular_class_assignments_coach_read on public.regular_class_assignments
  for select to authenticated using ((select private.is_coach()));
create policy class_seats_coach_read on public.class_seats
  for select to authenticated using ((select private.is_coach()));

-- The occurrence row lock serializes all additions and cancellations for one
-- class. Parents and unsigned visitors cannot invoke this private helper.
create function private.confirm_class_seat(
  p_occurrence_id uuid, p_athlete_id uuid, p_kind text,
  p_assignment_id uuid, p_actor uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_occ public.class_occurrences%rowtype;
  v_existing public.class_seats%rowtype;
  v_count integer;
  v_seat_id uuid;
begin
  select * into v_occ from public.class_occurrences
    where id = p_occurrence_id for update;
  if not found then
    raise exception 'Dated class not found' using errcode = '22023';
  end if;
  perform 1 from public.athletes where id = p_athlete_id for share;
  if not found then
    raise exception 'Athlete not found' using errcode = '22023';
  end if;
  if p_kind = 'regular' then
    if not exists (
      select 1 from public.regular_class_assignments a
      where a.id = p_assignment_id and a.athlete_id = p_athlete_id
        and a.standing_slot_id = v_occ.standing_slot_id
        and a.starts_on <= v_occ.class_date
        and (a.ends_on is null or a.ends_on > v_occ.class_date)
    ) then
      raise exception 'Regular assignment does not cover this class'
        using errcode = '22023';
    end if;
  elsif p_kind <> 'drop_in' or p_assignment_id is not null then
    raise exception 'Invalid seat type' using errcode = '22023';
  end if;

  select * into v_existing from public.class_seats
    where occurrence_id = p_occurrence_id and athlete_id = p_athlete_id
      and cancelled_at is null;
  if found then
    if p_kind = 'regular' and v_existing.seat_kind = 'drop_in' then
      update public.class_seats set seat_kind = 'regular',
        regular_assignment_id = p_assignment_id where id = v_existing.id;
      return v_existing.id;
    end if;
    raise exception 'Athlete already has a seat in this class'
      using errcode = '23505';
  end if;

  select count(*) into v_count from public.class_seats
    where occurrence_id = p_occurrence_id and cancelled_at is null;
  if v_count >= v_occ.capacity then
    raise exception 'Class is full' using errcode = '23514';
  end if;
  insert into public.class_seats
    (occurrence_id, athlete_id, seat_kind, regular_assignment_id, confirmed_by)
    values (p_occurrence_id, p_athlete_id, p_kind, p_assignment_id, p_actor)
    returning id into v_seat_id;
  return v_seat_id;
end;
$$;
revoke all on function private.confirm_class_seat(uuid, uuid, text, uuid, uuid)
  from public, anon, authenticated;

-- When a coach creates a dated class, regular assignments reserve seats in
-- that same transaction. Lock the slot to coordinate with assignment writes.
create function private.reserve_regular_class_seats()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_assignment record;
begin
  perform 1 from public.standing_class_slots where id = new.standing_slot_id for update;
  for v_assignment in
    select id, athlete_id from public.regular_class_assignments
    where standing_slot_id = new.standing_slot_id
      and starts_on <= new.class_date
      and (ends_on is null or ends_on > new.class_date)
    order by id
  loop
    perform private.confirm_class_seat(
      new.id, v_assignment.athlete_id, 'regular', v_assignment.id, (select auth.uid())
    );
  end loop;
  return new;
end;
$$;
create trigger reserve_regular_seats_on_class_creation
  after insert on public.class_occurrences
  for each row execute function private.reserve_regular_class_seats();
revoke all on function private.reserve_regular_class_seats()
  from public, anon, authenticated;

create function public.add_regular_class_athlete(
  p_slot_id uuid, p_athlete_id uuid, p_starts_on date, p_ends_on date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_slot public.standing_class_slots%rowtype;
  v_assignment_id uuid;
  v_count integer;
  v_occurrence record;
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_slot_id is null or p_athlete_id is null or p_starts_on is null
      or (p_ends_on is not null and p_ends_on <= p_starts_on) then
    raise exception 'Choose a class, athlete, and valid effective dates'
      using errcode = '22023';
  end if;
  select * into v_slot from public.standing_class_slots
    where id = p_slot_id for update;
  if not found or p_starts_on < v_slot.active_from
      or (v_slot.active_until is not null and
          (p_starts_on >= v_slot.active_until or
           p_ends_on is null or p_ends_on > v_slot.active_until)) then
    raise exception 'Regular dates must fit the standing class'
      using errcode = '22023';
  end if;
  perform 1 from public.athletes where id = p_athlete_id for share;
  if not found then
    raise exception 'Athlete not found' using errcode = '22023';
  end if;
  -- Conservative admission rule: each assignment overlapping this term
  -- counts toward the slot's maximum, even if no dates exist yet.
  select count(*) into v_count from public.regular_class_assignments
    where standing_slot_id = p_slot_id
      and daterange(starts_on, ends_on, '[)') &&
          daterange(p_starts_on, p_ends_on, '[)');
  if v_count >= v_slot.capacity then
    raise exception 'No regular places remain for this class'
      using errcode = '23514';
  end if;
  insert into public.regular_class_assignments
    (standing_slot_id, athlete_id, starts_on, ends_on, created_by)
    values (p_slot_id, p_athlete_id, p_starts_on, p_ends_on, (select auth.uid()))
    returning id into v_assignment_id;

  -- Also reserve the athlete's seat in dated classes already created.
  for v_occurrence in
    select id from public.class_occurrences
    where standing_slot_id = p_slot_id and class_date >= p_starts_on
      and (p_ends_on is null or class_date < p_ends_on)
    order by class_date, id
  loop
    perform private.confirm_class_seat(
      v_occurrence.id, p_athlete_id, 'regular', v_assignment_id, (select auth.uid())
    );
  end loop;
  return v_assignment_id;
end;
$$;
revoke all on function public.add_regular_class_athlete(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.add_regular_class_athlete(uuid, uuid, date, date)
  to authenticated;

create function public.confirm_coach_drop_in(p_occurrence_id uuid, p_athlete_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  return private.confirm_class_seat(
    p_occurrence_id, p_athlete_id, 'drop_in', null, (select auth.uid())
  );
end;
$$;
revoke all on function public.confirm_coach_drop_in(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_coach_drop_in(uuid, uuid) to authenticated;

-- Cancellation releases this one dated seat and retains the original record.
-- It does not change the regular weekly assignment or send an email.
create function public.cancel_coach_class_seat(p_seat_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_occurrence_id uuid;
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  select occurrence_id into v_occurrence_id from public.class_seats where id = p_seat_id;
  if v_occurrence_id is null then
    raise exception 'Seat not found' using errcode = '22023';
  end if;
  perform 1 from public.class_occurrences where id = v_occurrence_id for update;
  update public.class_seats set cancelled_at = now(), cancelled_by = (select auth.uid())
    where id = p_seat_id and cancelled_at is null;
  if not found then
    raise exception 'Seat was already cancelled' using errcode = '55000';
  end if;
end;
$$;
revoke all on function public.cancel_coach_class_seat(uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_coach_class_seat(uuid) to authenticated;
