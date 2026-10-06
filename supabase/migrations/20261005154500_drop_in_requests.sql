-- A request is not a reservation. Only coach approval calls the existing
-- serialized seat helper, which enforces the dated class's capacity.
create table public.drop_in_requests (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id),
  occurrence_id uuid not null references public.class_occurrences(id),
  requested_by uuid not null references auth.users(id),
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  seat_id uuid unique references public.class_seats(id),
  check ((reviewed_by is null) = (reviewed_at is null)),
  check ((status = 'pending') = (reviewed_by is null and reviewed_at is null)),
  check ((status = 'approved') = (seat_id is not null))
);
create unique index one_pending_drop_in_request
  on public.drop_in_requests(athlete_id, occurrence_id)
  where status = 'pending';
create index drop_in_requests_recent_idx
  on public.drop_in_requests(requested_at desc, id);
alter table public.drop_in_requests enable row level security;
revoke all on public.drop_in_requests from public, anon, authenticated;

-- Only signed-in guardians see available dated class details. No roster names
-- or other family's request details are returned.
create function public.list_open_drop_in_classes()
returns table (
  occurrence_id uuid, class_date date, starts_at timestamptz,
  ends_at timestamptz, class_label text, location_name text,
  time_zone text, places_left integer, group_id uuid, class_kind text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.family_guardians fg where fg.user_id = (select auth.uid())
  ) then
    raise exception 'Guardian access required' using errcode = '42501';
  end if;
  return query
    select o.id, o.class_date, o.starts_at, o.ends_at,
      case when s.class_kind = 'intro' then 'Intro'::text else g.name end,
      l.display_name, l.time_zone,
      (o.capacity - (select count(*)::integer from public.class_seats b
        where b.occurrence_id = o.id and b.cancelled_at is null))::integer,
      s.group_id, s.class_kind
    from public.class_occurrences o
    join public.standing_class_slots s on s.id = o.standing_slot_id
    left join public.skill_groups g on g.id = s.group_id
    join public.class_locations l on l.id = o.location_id
    where o.starts_at > now() and o.starts_at < now() + interval '60 days'
    order by o.starts_at, o.id limit 201;
end;
$$;

create function public.request_drop_in(p_athlete_id uuid, p_occurrence_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_occ public.class_occurrences%rowtype;
  v_group_id uuid;
  v_kind text;
  v_family_id uuid;
  v_existing uuid;
  v_request_id uuid;
begin
  if v_actor is null or p_athlete_id is null or p_occurrence_id is null then
    raise exception 'Choose your athlete and a dated class' using errcode = '22023';
  end if;
  select * into v_occ from public.class_occurrences o
    where o.id = p_occurrence_id for update;
  if not found or v_occ.starts_at <= now() then
    raise exception 'Class is unavailable for a drop-in request' using errcode = '22023';
  end if;
  select a.family_id into v_family_id from public.athletes a
    where a.id = p_athlete_id;
  if v_family_id is null or not exists (
    select 1 from public.family_guardians fg
    where fg.user_id = v_actor and fg.family_id = v_family_id
  ) then
    raise exception 'Guardian access required for this athlete' using errcode = '42501';
  end if;
  select s.group_id, s.class_kind into v_group_id, v_kind
    from public.standing_class_slots s where s.id = v_occ.standing_slot_id;
  if v_kind <> 'intro' and not exists (
    select 1 from public.group_enrollments e
    where e.athlete_id = p_athlete_id and e.group_id = v_group_id
      and e.starts_on <= v_occ.class_date
      and (e.ends_on is null or e.ends_on > v_occ.class_date)
  ) then
    raise exception 'Athlete is not assigned to this class group'
      using errcode = '22023';
  end if;
  if exists (select 1 from public.class_seats b
    where b.occurrence_id = v_occ.id and b.athlete_id = p_athlete_id
      and b.cancelled_at is null) then
    raise exception 'Athlete already has a confirmed place'
      using errcode = '23505';
  end if;
  select r.id into v_existing from public.drop_in_requests r
    where r.occurrence_id = v_occ.id and r.athlete_id = p_athlete_id
      and r.status = 'pending';
  if v_existing is not null then return v_existing; end if;
  if exists (select 1 from public.drop_in_requests r
    where r.occurrence_id = v_occ.id and r.athlete_id = p_athlete_id
      and r.status = 'declined') then
    raise exception 'This class request was already declined'
      using errcode = '55000';
  end if;
  if (select count(*) from public.class_seats b
      where b.occurrence_id = v_occ.id and b.cancelled_at is null) >= v_occ.capacity then
    raise exception 'No places remain in this class' using errcode = '23514';
  end if;
  insert into public.drop_in_requests(athlete_id, occurrence_id, requested_by)
    values (p_athlete_id, v_occ.id, v_actor) returning id into v_request_id;
  return v_request_id;
end;
$$;

create function public.list_my_drop_in_requests()
returns table (
  request_id uuid, athlete_name text, starts_at timestamptz,
  class_label text, location_name text, time_zone text, status text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  return query
    select r.id, a.display_name, o.starts_at,
      case when s.class_kind = 'intro' then 'Intro'::text else g.name end,
      l.display_name, l.time_zone,
      case when r.status = 'approved' and b.cancelled_at is not null
        then 'cancelled'::text else r.status end
    from public.drop_in_requests r
    join public.athletes a on a.id = r.athlete_id
    join public.class_occurrences o on o.id = r.occurrence_id
    join public.standing_class_slots s on s.id = o.standing_slot_id
    left join public.skill_groups g on g.id = s.group_id
    join public.class_locations l on l.id = o.location_id
    left join public.class_seats b on b.id = r.seat_id
    where exists (select 1 from public.family_guardians fg
      where fg.family_id = a.family_id and fg.user_id = (select auth.uid()))
    order by r.requested_at desc, r.id desc limit 201;
end;
$$;

create function public.list_coach_drop_in_requests()
returns table (
  request_id uuid, athlete_name text, starts_at timestamptz,
  class_label text, location_name text, time_zone text,
  places_left integer, requested_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  return query
    select r.id, a.display_name, o.starts_at,
      case when s.class_kind = 'intro' then 'Intro'::text else g.name end,
      l.display_name, l.time_zone,
      (o.capacity - (select count(*)::integer from public.class_seats b
        where b.occurrence_id = o.id and b.cancelled_at is null))::integer,
      r.requested_at
    from public.drop_in_requests r
    join public.athletes a on a.id = r.athlete_id
    join public.class_occurrences o on o.id = r.occurrence_id
    join public.standing_class_slots s on s.id = o.standing_slot_id
    left join public.skill_groups g on g.id = s.group_id
    join public.class_locations l on l.id = o.location_id
    where r.status = 'pending'
    order by o.starts_at, r.requested_at, r.id limit 201;
end;
$$;

create function public.review_drop_in_request(p_request_id uuid, p_approve boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_occurrence_id uuid;
  v_request public.drop_in_requests%rowtype;
  v_seat uuid;
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_approve is null then
    raise exception 'Choose a request and a decision' using errcode = '22023';
  end if;
  select r.occurrence_id into v_occurrence_id from public.drop_in_requests r
    where r.id = p_request_id;
  if v_occurrence_id is null then
    raise exception 'Request not found' using errcode = '22023';
  end if;
  perform 1 from public.class_occurrences o
    where o.id = v_occurrence_id for update;
  select * into v_request from public.drop_in_requests r
    where r.id = p_request_id for update;
  if v_request.status <> 'pending' then
    raise exception 'Request was already reviewed' using errcode = '55000';
  end if;
  if p_approve then
    if not exists (select 1 from public.class_occurrences o
      where o.id = v_occurrence_id and o.starts_at > now()) then
      raise exception 'Class has already started' using errcode = '55000';
    end if;
    if not exists (select 1 from public.athletes a
      join public.family_guardians fg on fg.family_id = a.family_id
      where a.id = v_request.athlete_id and fg.user_id = v_request.requested_by) then
      raise exception 'Requesting guardian no longer has athlete access'
        using errcode = '42501';
    end if;
    v_seat := private.confirm_class_seat(
      v_occurrence_id, v_request.athlete_id, 'drop_in', null, v_actor
    );
  end if;
  update public.drop_in_requests r
    set status = case when p_approve then 'approved' else 'declined' end,
        reviewed_by = v_actor, reviewed_at = now(), seat_id = v_seat
    where r.id = p_request_id;
  return v_seat;
end;
$$;

revoke all on function public.list_open_drop_in_classes(),
  public.request_drop_in(uuid,uuid), public.list_my_drop_in_requests(),
  public.list_coach_drop_in_requests(), public.review_drop_in_request(uuid,boolean)
  from public, anon, authenticated;
grant execute on function public.list_open_drop_in_classes(),
  public.request_drop_in(uuid,uuid), public.list_my_drop_in_requests(),
  public.list_coach_drop_in_requests(), public.review_drop_in_request(uuid,boolean)
  to authenticated;
