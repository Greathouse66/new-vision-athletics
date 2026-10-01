-- Structure only: do not insert locations, weekly slots, or dated classes here.
-- A coach must confirm the venue, local times, capacity, and exception rules
-- before a later migration enables schedule entry and occurrence generation.
create table public.class_locations (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  time_zone text not null check (length(btrim(time_zone)) between 1 and 120),
  created_at timestamptz not null default now()
);

-- PostgreSQL's named zones account for seasonal clock changes. This validation
-- rejects unrecognized zone names; venue review still excludes fixed-offset names.
create function private.validate_class_location_zone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.time_zone
  ) then
    raise exception 'Unknown time zone: %', new.time_zone using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger class_location_zone_valid
  before insert or update of time_zone on public.class_locations
  for each row execute function private.validate_class_location_zone();
revoke all on function private.validate_class_location_zone() from public, anon, authenticated;

-- ISO weekday: Monday = 1 through Sunday = 7. active_until is exclusive.
-- A change to a confirmed weekly slot creates a new dated rule later, rather
-- than rewriting its group, location, weekday, or local start time.
create table public.standing_class_slots (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.skill_groups(id),
  location_id uuid not null references public.class_locations(id),
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  local_start_time time without time zone not null,
  duration_minutes smallint not null check (duration_minutes between 1 and 360),
  capacity integer not null check (capacity > 0),
  active_from date not null,
  active_until date,
  created_at timestamptz not null default now(),
  check (active_until is null or active_until > active_from)
);
create index standing_class_slots_group_id_idx on public.standing_class_slots(group_id);
create index standing_class_slots_location_id_idx on public.standing_class_slots(location_id);

-- Each dated session is distinct. Actual UTC instants and its capacity are
-- saved for history; no rows are generated until holiday and DST rules are set.
create table public.class_occurrences (
  id uuid primary key default gen_random_uuid(),
  standing_slot_id uuid not null references public.standing_class_slots(id),
  class_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity > 0),
  created_at timestamptz not null default now(),
  unique (standing_slot_id, class_date),
  check (ends_at > starts_at)
);
create index class_occurrences_class_date_idx on public.class_occurrences(class_date);

alter table public.class_locations enable row level security;
alter table public.standing_class_slots enable row level security;
alter table public.class_occurrences enable row level security;

-- Static browser clients may only read these records as a coach. A later
-- reviewed workflow will add narrow writes and family-specific session reads.
revoke all on public.class_locations, public.standing_class_slots,
  public.class_occurrences from public, anon, authenticated;
grant select on public.class_locations, public.standing_class_slots,
  public.class_occurrences to authenticated;

create policy class_locations_coach_read on public.class_locations
  for select to authenticated using ((select private.is_coach()));
create policy standing_class_slots_coach_read on public.standing_class_slots
  for select to authenticated using ((select private.is_coach()));
create policy class_occurrences_coach_read on public.class_occurrences
  for select to authenticated using ((select private.is_coach()));
