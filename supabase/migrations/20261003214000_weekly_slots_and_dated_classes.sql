-- The eight confirmed weekly class times. No athlete, booking, or dated class
-- is created by this migration. First week is Monday, October 5, 2026.
do $$
declare
  v_foundational uuid;
  v_post_bigs uuid;
  v_advanced uuid;
  v_count integer;
begin
  select count(*), (array_agg(id))[1] into v_count, v_foundational
    from public.skill_groups where lower(btrim(name)) = 'foundational' and is_active;
  if v_count <> 1 then raise exception 'Expected one active Foundational group'; end if;
  select count(*), (array_agg(id))[1] into v_count, v_post_bigs
    from public.skill_groups where lower(btrim(name)) = 'post-bigs' and is_active;
  if v_count <> 1 then raise exception 'Expected one active Post-Bigs group'; end if;
  select count(*), (array_agg(id))[1] into v_count, v_advanced
    from public.skill_groups where lower(btrim(name)) = 'advanced' and is_active;
  if v_count <> 1 then raise exception 'Expected one active Advanced group'; end if;

  -- Stop for review if another schedule was entered before this migration.
  if exists (select 1 from public.standing_class_slots) then
    raise exception 'Existing class slots need review before the agreed schedule is loaded';
  end if;

  insert into public.standing_class_slots
    (group_id, location_id, iso_weekday, local_start_time, duration_minutes,
     capacity, active_from, class_kind)
  values
    (v_post_bigs, null, 1, time '18:00', 60, 10, date '2026-10-05', 'skill_group'),
    (v_advanced, null, 1, time '19:00', 60, 10, date '2026-10-05', 'skill_group'),
    (v_foundational, null, 2, time '18:00', 60, 10, date '2026-10-05', 'skill_group'),
    (v_post_bigs, null, 3, time '18:00', 60, 10, date '2026-10-05', 'skill_group'),
    (v_advanced, null, 3, time '19:00', 60, 10, date '2026-10-05', 'skill_group'),
    (v_foundational, null, 4, time '18:00', 60, 10, date '2026-10-05', 'skill_group'),
    (null, null, 5, time '18:00', 60, 10, date '2026-10-05', 'intro'),
    (v_advanced, null, 5, time '19:00', 60, 10, date '2026-10-05', 'skill_group');
end;
$$;

-- Serialize venue changes with dated-class creation for the same week. The
-- existing checked venue function is redefined only to take that lock first.
create or replace function public.set_class_week_venue(p_week_start date, p_location_id uuid)
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
  perform pg_catalog.pg_advisory_xact_lock(1568974, p_week_start - date '2000-01-01');
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

-- Explicitly selected open dates only. No automatic recurrence or holiday
-- assumption. One call creates all classes on the selected dates atomically.
create function public.create_dated_classes(p_week_start date, p_open_dates date[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_location uuid;
  v_zone text;
  v_date date;
  v_slot record;
  v_local_start timestamp;
  v_local_end timestamp;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_count integer := 0;
  v_day_slots integer;
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_week_start is null or extract(isodow from p_week_start) <> 1
      or p_week_start < date '2026-10-05' or p_open_dates is null
      or cardinality(p_open_dates) not between 1 and 5 then
    raise exception 'Choose a class week and one to five open dates' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_open_dates) as d(class_date)
    where class_date is null or class_date < p_week_start
      or class_date > p_week_start + 4
  ) or (select count(distinct d.class_date) from unnest(p_open_dates) as d(class_date))
      <> cardinality(p_open_dates) then
    raise exception 'Dates must be distinct weekdays in the selected week'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1568974, p_week_start - date '2000-01-01');
  select w.location_id, l.time_zone into v_location, v_zone
    from public.class_week_venues w
    join public.class_locations l on l.id = w.location_id
    where w.week_start = p_week_start;
  if v_location is null then
    raise exception 'Choose the weekly venue before creating dated classes'
      using errcode = '22023';
  end if;

  foreach v_date in array p_open_dates loop
    if exists (select 1 from public.class_occurrences where class_date = v_date) then
      raise exception 'Dated classes already exist for %', v_date using errcode = '55000';
    end if;
    v_day_slots := 0;
    for v_slot in
      select id, local_start_time, duration_minutes, capacity
        from public.standing_class_slots
        where iso_weekday = extract(isodow from v_date)
          and active_from <= v_date and (active_until is null or active_until > v_date)
        order by local_start_time, id
    loop
      v_day_slots := v_day_slots + 1;
      v_local_start := v_date + v_slot.local_start_time;
      v_local_end := v_local_start + make_interval(mins => v_slot.duration_minutes);
      v_starts_at := v_local_start at time zone v_zone;
      v_ends_at := v_local_end at time zone v_zone;
      if (v_starts_at at time zone v_zone) <> v_local_start
          or (v_ends_at at time zone v_zone) <> v_local_end
          or v_ends_at <= v_starts_at then
        raise exception 'Ambiguous or missing local class time on %', v_date
          using errcode = '22023';
      end if;
      insert into public.class_occurrences
        (standing_slot_id, class_date, starts_at, ends_at, capacity, location_id)
        values (v_slot.id, v_date, v_starts_at, v_ends_at,
                v_slot.capacity, v_location);
      v_count := v_count + 1;
    end loop;
    if v_day_slots = 0 then
      raise exception 'No standing classes for %', v_date using errcode = '22023';
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.create_dated_classes(date, date[])
  from public, anon, authenticated;
grant execute on function public.create_dated_classes(date, date[]) to authenticated;
