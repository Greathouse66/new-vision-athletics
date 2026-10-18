-- Add a reviewed coach workflow; no existing class, booking, or schedule is changed on install.
alter table public.standing_class_slots
  add column replaces_slot_id uuid unique references public.standing_class_slots(id),
  add column revision integer not null default 1 check (revision > 0);
create table private.weekly_schedule_state (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 1
);
insert into private.weekly_schedule_state(singleton) values(true);
create table private.weekly_schedule_changes (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  changed_at timestamptz not null default now(),
  effective_from date not null,
  old_slot_id uuid,
  new_slot_id uuid not null,
  before_slot jsonb,
  after_slot jsonb not null,
  carried_assignments integer not null
);
revoke all on private.weekly_schedule_state,private.weekly_schedule_changes from public,anon,authenticated;
revoke all on sequence private.weekly_schedule_changes_id_seq from public,anon,authenticated;

create function public.coach_weekly_schedule()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'revision',(select s.revision from private.weekly_schedule_state s),
    'last_created_by_day',coalesce((select jsonb_object_agg(d.weekday,d.last_date) from (select extract(isodow from class_date)::integer as weekday,max(class_date) as last_date from public.class_occurrences group by 1) d),'{}'::jsonb),
    'classes',coalesce((select jsonb_agg(to_jsonb(t) order by t.iso_weekday,t.local_start_time,t.active_from,t.id) from (
      select s.id,s.group_id,s.class_kind,s.iso_weekday,s.local_start_time,s.duration_minutes,s.capacity,
        s.active_from,s.active_until,s.replaces_slot_id,s.revision,
        case when s.class_kind='intro' then 'Intro' else g.name end as class_label,
        not exists(select 1 from public.standing_class_slots child where child.replaces_slot_id=s.id) as is_latest,
        (select max(o.class_date) from public.class_occurrences o where o.standing_slot_id=s.id) as last_created_date,
        greatest((now() at time zone 'America/Chicago')::date,s.active_from,
          coalesce((select max(o.class_date)+1 from public.class_occurrences o where o.standing_slot_id=s.id),s.active_from)) as earliest_change_date,
        (select count(*) from public.regular_class_assignments a where a.standing_slot_id=s.id
          and (a.ends_on is null or a.ends_on>(now() at time zone 'America/Chicago')::date)) as regular_assignments
      from public.standing_class_slots s left join public.skill_groups g on g.id=s.group_id
    ) t),'[]'::jsonb)
  );
end;
$$;

create function public.save_weekly_class(
  p_slot_id uuid,p_revision integer,p_effective_from date,p_iso_weekday integer,
  p_local_start_time time,p_duration_minutes integer,p_capacity integer,p_class_kind text,p_group_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_old public.standing_class_slots%rowtype;
  v_new public.standing_class_slots%rowtype;
  v_assignment public.regular_class_assignments%rowtype;
  v_last date;
  v_peak integer;
  v_count integer:=0;
  v_in_place boolean:=false;
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  if p_effective_from is null or p_effective_from<v_today
     or p_iso_weekday is null or p_iso_weekday not between 1 and 7
     or p_local_start_time is null or extract(second from p_local_start_time)<>0
     or p_duration_minutes is null or p_duration_minutes not between 1 and 360
     or date '2000-01-01'+p_local_start_time+make_interval(mins=>p_duration_minutes)>date '2000-01-02'
     or p_capacity is null or p_capacity not between 1 and 10
     or p_class_kind is null or p_class_kind not in ('intro','skill_group')
     or (p_class_kind='intro' and p_group_id is not null)
     or (p_class_kind='skill_group' and p_group_id is null) then
    raise exception 'Choose a current/future effective date, day, minute time, duration, class and capacity from 1 to 10.' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1568975,0);
  if p_class_kind='skill_group' then
    perform 1 from public.skill_groups where id=p_group_id and is_active for share;
    if not found then raise exception 'Choose an active skill group' using errcode='22023'; end if;
  end if;
  if p_slot_id is not null then
    select * into v_old from public.standing_class_slots where id=p_slot_id for update;
    if not found or p_revision is null or v_old.revision<>p_revision
       or exists(select 1 from public.standing_class_slots where replaces_slot_id=p_slot_id) then
      raise exception 'This weekly class changed. Reload and edit its latest version.' using errcode='40001';
    end if;
    if p_effective_from<v_old.active_from or (v_old.active_until is not null and p_effective_from>=v_old.active_until) then
      raise exception 'Effective date must fit the selected weekly class version' using errcode='22023';
    end if;
    select max(class_date) into v_last from public.class_occurrences where standing_slot_id=p_slot_id;
    if v_last is not null and p_effective_from<=v_last then
      raise exception 'Created classes are preserved. Choose an effective date after %.',v_last using errcode='55000';
    end if;
    v_in_place:=p_effective_from=v_old.active_from;
    if v_in_place and (v_old.active_from<v_today or v_last is not null) then
      raise exception 'Choose a later effective date to preserve this class history' using errcode='55000';
    end if;
    select coalesce(max((select count(*) from public.regular_class_assignments a
      where a.standing_slot_id=p_slot_id and a.starts_on<=d.on_date and (a.ends_on is null or a.ends_on>d.on_date))),0)
      into v_peak from (select distinct greatest(a.starts_on,p_effective_from) as on_date
        from public.regular_class_assignments a where a.standing_slot_id=p_slot_id and (a.ends_on is null or a.ends_on>p_effective_from)) d;
    if v_peak>p_capacity then
      raise exception 'Capacity cannot be below the % regular athletes already assigned during this period.',v_peak using errcode='23514';
    end if;
  elsif p_revision is not null then
    raise exception 'A new weekly class has no previous revision' using errcode='22023';
  end if;
  select max(o.class_date) into v_last from public.class_occurrences o where extract(isodow from o.class_date)=p_iso_weekday;
  if v_last is not null and p_effective_from<=v_last then
    raise exception 'Classes are already created on that weekday. Choose an effective date after %.',v_last using errcode='55000';
  end if;
  if exists(select 1 from public.standing_class_slots s where s.id is distinct from p_slot_id
    and s.iso_weekday=p_iso_weekday and s.local_start_time=p_local_start_time
    and s.class_kind=p_class_kind and s.group_id is not distinct from p_group_id
    and daterange(s.active_from,s.active_until,'[)') && daterange(p_effective_from,v_old.active_until,'[)')) then
    raise exception 'This class already has a weekly rule at that day and time' using errcode='23505';
  end if;
  if v_in_place then
    -- A not-yet-used planned version can be corrected at its own start date.
    -- The audit preserves its prior values; any created occurrence prevents this path.
    update public.standing_class_slots set group_id=p_group_id,class_kind=p_class_kind,
      iso_weekday=p_iso_weekday,local_start_time=p_local_start_time,duration_minutes=p_duration_minutes,
      capacity=p_capacity,revision=revision+1 where id=p_slot_id returning * into v_new;
    select count(*) into v_count from public.regular_class_assignments a where a.standing_slot_id=p_slot_id
      and (a.ends_on is null or a.ends_on>p_effective_from);
  else
    if p_slot_id is not null then
      update public.standing_class_slots set active_until=p_effective_from,revision=revision+1 where id=p_slot_id;
    end if;
    insert into public.standing_class_slots(group_id,location_id,class_kind,iso_weekday,local_start_time,
      duration_minutes,capacity,active_from,active_until,replaces_slot_id)
      values(p_group_id,v_old.location_id,p_class_kind,p_iso_weekday,p_local_start_time,p_duration_minutes,
        p_capacity,p_effective_from,v_old.active_until,p_slot_id) returning * into v_new;
    for v_assignment in select * from public.regular_class_assignments a where a.standing_slot_id=p_slot_id
      and (a.ends_on is null or a.ends_on>p_effective_from) order by a.starts_on,a.id for update
    loop
      if v_assignment.starts_on>=p_effective_from then
        update public.regular_class_assignments set standing_slot_id=v_new.id where id=v_assignment.id;
      else
        update public.regular_class_assignments set ends_on=p_effective_from where id=v_assignment.id;
        insert into public.regular_class_assignments(standing_slot_id,athlete_id,starts_on,ends_on,created_by)
          values(v_new.id,v_assignment.athlete_id,p_effective_from,v_assignment.ends_on,v_actor);
      end if;
      v_count:=v_count+1;
    end loop;
  end if;
  update private.weekly_schedule_state set revision=revision+1;
  insert into private.weekly_schedule_changes(actor_id,effective_from,old_slot_id,new_slot_id,before_slot,after_slot,carried_assignments)
    values(v_actor,p_effective_from,p_slot_id,v_new.id,case when p_slot_id is null then null else to_jsonb(v_old) end,to_jsonb(v_new),v_count);
  return v_new.id;
end;
$$;
revoke all on function public.coach_weekly_schedule(),
  public.save_weekly_class(uuid,integer,date,integer,time,integer,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.coach_weekly_schedule(),
  public.save_weekly_class(uuid,integer,date,integer,time,integer,integer,text,uuid) to authenticated;

-- Serialize generation with edits; retain the existing two-argument API.
create or replace function public.create_dated_classes(p_week_start date, p_open_dates date[])
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
      or cardinality(p_open_dates) not between 1 and 7 then
    raise exception 'Choose a class week and one to seven open dates' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_open_dates) as d(class_date)
    where class_date is null or class_date < p_week_start
      or class_date > p_week_start + 6
  ) or (select count(distinct d.class_date) from unnest(p_open_dates) as d(class_date))
      <> cardinality(p_open_dates) then
    raise exception 'Dates must be distinct dates in the selected week'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1568975,0);
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
          or v_ends_at <= v_starts_at
          or exists(select 1 from generate_series(-180,180,15) as delta(minutes)
            where delta.minutes<>0 and (
              ((v_starts_at+make_interval(mins=>delta.minutes)) at time zone v_zone)=v_local_start
              or ((v_ends_at+make_interval(mins=>delta.minutes)) at time zone v_zone)=v_local_end)) then
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

-- New UI reviews the exact schedule revision before creating dates.
create function public.create_reviewed_dated_classes(p_week_start date,p_open_dates date[],p_schedule_revision bigint)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1568975,0);
  if p_schedule_revision is null or p_schedule_revision<>(select revision from private.weekly_schedule_state) then
    raise exception 'The weekly schedule changed. Reload and review the dates before creating classes.' using errcode='40001';
  end if;
  return public.create_dated_classes(p_week_start,p_open_dates);
end;
$$;
revoke all on function public.create_reviewed_dated_classes(date,date[],bigint) from public,anon,authenticated;
grant execute on function public.create_reviewed_dated_classes(date,date[],bigint) to authenticated;

-- Internal single-version term helper, using the existing seat and capacity checks.
create function private.add_regular_class_term(
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

revoke all on function private.add_regular_class_term(uuid,uuid,date,date) from public,anon,authenticated;
-- Follow planned replacements for an ongoing regular assignment, including new athletes.
create or replace function public.add_regular_class_athlete(
  p_slot_id uuid,p_athlete_id uuid,p_starts_on date,p_ends_on date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_slot public.standing_class_slots%rowtype;
  v_id uuid;
  v_first uuid;
  v_start date:=p_starts_on;
  v_end date;
  v_steps integer:=0;
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  if p_slot_id is null or p_athlete_id is null or p_starts_on is null
     or (p_ends_on is not null and p_ends_on<=p_starts_on) then
    raise exception 'Choose a class, athlete, and valid effective dates' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(1568975,0);
  select * into v_slot from public.standing_class_slots where id=p_slot_id for update;
  if not found or p_starts_on<v_slot.active_from then
    raise exception 'Regular dates must fit the standing class' using errcode='22023';
  end if;
  loop
    v_steps:=v_steps+1;
    if v_steps>1000 then raise exception 'Class version history needs review' using errcode='55000'; end if;
    if v_slot.active_until is not null and v_start>=v_slot.active_until then
      select * into v_slot from public.standing_class_slots where replaces_slot_id=v_slot.id for update;
      if not found then raise exception 'Regular dates must fit the standing class' using errcode='22023'; end if;
      continue;
    end if;
    v_end:=case when v_slot.active_until is null then p_ends_on
      when p_ends_on is null then v_slot.active_until else least(p_ends_on,v_slot.active_until) end;
    v_id:=private.add_regular_class_term(v_slot.id,p_athlete_id,v_start,v_end);
    v_first:=coalesce(v_first,v_id);
    if v_slot.active_until is null or (p_ends_on is not null and p_ends_on<=v_slot.active_until) then exit; end if;
    v_start:=v_slot.active_until;
    select * into v_slot from public.standing_class_slots where replaces_slot_id=v_slot.id for update;
    if not found or v_slot.active_from<>v_start then
      raise exception 'Regular dates must fit the standing class' using errcode='22023';
    end if;
  end loop;
  return v_first;
end;
$$;
