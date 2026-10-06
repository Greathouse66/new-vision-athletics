-- A guardian cancels one confirmed dated seat. The seat and its regular
-- assignment remain as history. A cancellation records no makeup or refund.
create table public.parent_class_cancellations (
  seat_id uuid primary key references public.class_seats(id),
  cancelled_by uuid not null references auth.users(id),
  cancelled_at timestamptz not null
);
create index parent_class_cancellations_recent_idx
  on public.parent_class_cancellations(cancelled_at desc, seat_id);
alter table public.parent_class_cancellations enable row level security;
revoke all on public.parent_class_cancellations from public, anon, authenticated;

-- Keep the existing read-only RPC unchanged for old clients. The new list
-- adds an opaque seat id so a stale browser cannot cancel a replacement seat.
create function public.list_my_cancellable_sessions()
returns table (
  seat_id uuid, family_id uuid, athlete_id uuid, athlete_name text,
  occurrence_id uuid, class_date date, starts_at timestamptz,
  ends_at timestamptz, class_label text, location_name text, time_zone text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  return query
    select b.id, a.family_id, a.id, a.display_name, o.id, o.class_date,
           o.starts_at, o.ends_at,
           case when s.class_kind = 'intro' then 'Intro'::text else g.name end,
           l.display_name, l.time_zone
      from public.class_seats b
      join public.athletes a on a.id = b.athlete_id
      join public.class_occurrences o on o.id = b.occurrence_id
      join public.standing_class_slots s on s.id = o.standing_slot_id
      left join public.skill_groups g on g.id = s.group_id
      join public.class_locations l on l.id = o.location_id
      where b.cancelled_at is null and o.starts_at > now()
        and exists (select 1 from public.family_guardians fg
          where fg.family_id = a.family_id and fg.user_id = (select auth.uid()))
      order by o.starts_at, o.id, a.id
      limit 201;
end;
$$;

create function public.cancel_my_class_seat(p_seat_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_occurrence_id uuid;
  v_seat public.class_seats%rowtype;
  v_starts_at timestamptz;
  v_cancelled_at timestamptz;
begin
  if v_actor is null or p_seat_id is null then
    raise exception 'Sign-in and a confirmed place are required'
      using errcode = '42501';
  end if;
  -- Only check existence here; authorization is rechecked after locking the
  -- occurrence, which serializes this write with coach cancellation/rebooking.
  select b.occurrence_id into v_occurrence_id
    from public.class_seats b where b.id = p_seat_id;
  if v_occurrence_id is null then
    raise exception 'Confirmed place is unavailable' using errcode = '42501';
  end if;
  perform 1 from public.class_occurrences o
    where o.id = v_occurrence_id for update;
  select b.* into v_seat from public.class_seats b
    join public.athletes a on a.id = b.athlete_id
    join public.family_guardians fg on fg.family_id = a.family_id
    where b.id = p_seat_id and fg.user_id = v_actor for update of b;
  if not found then
    raise exception 'Guardian access required for this athlete'
      using errcode = '42501';
  end if;
  if v_seat.cancelled_at is not null then
    if exists (select 1 from public.parent_class_cancellations c
      where c.seat_id = p_seat_id and c.cancelled_by = v_actor) then
      return p_seat_id; -- Retry of the same cancellation has no side effects.
    end if;
    raise exception 'Confirmed place has already been cancelled'
      using errcode = '55000';
  end if;
  select o.starts_at into v_starts_at from public.class_occurrences o
    where o.id = v_occurrence_id;
  if v_starts_at <= now() then
    raise exception 'Class has already started' using errcode = '55000';
  end if;
  v_cancelled_at := now();
  update public.class_seats b
    set cancelled_at = v_cancelled_at, cancelled_by = v_actor
    where b.id = p_seat_id;
  insert into public.parent_class_cancellations
    (seat_id, cancelled_by, cancelled_at)
    values (p_seat_id, v_actor, v_cancelled_at);
  return p_seat_id;
end;
$$;

-- Parents retain a confirmation history, subject to current guardian access.
create function public.list_my_parent_cancellations()
returns table (
  seat_id uuid, athlete_name text, class_label text,
  starts_at timestamptz, cancelled_at timestamptz, time_zone text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  return query
    select c.seat_id, a.display_name,
      case when s.class_kind = 'intro' then 'Intro'::text else g.name end,
      o.starts_at, c.cancelled_at, l.time_zone
    from public.parent_class_cancellations c
    join public.class_seats b on b.id = c.seat_id
    join public.athletes a on a.id = b.athlete_id
    join public.class_occurrences o on o.id = b.occurrence_id
    join public.standing_class_slots s on s.id = o.standing_slot_id
    left join public.skill_groups g on g.id = s.group_id
    join public.class_locations l on l.id = o.location_id
    where exists (select 1 from public.family_guardians fg
      where fg.family_id = a.family_id and fg.user_id = (select auth.uid()))
    order by c.cancelled_at desc, c.seat_id desc limit 201;
end;
$$;

-- Coach queue is a history of parent actions, not a makeup decision.
create function public.list_coach_parent_cancellations()
returns table (
  seat_id uuid, athlete_name text, class_label text,
  starts_at timestamptz, location_name text, time_zone text,
  seat_kind text, cancelled_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  return query
    select c.seat_id, a.display_name,
      case when s.class_kind = 'intro' then 'Intro'::text else g.name end,
      o.starts_at, l.display_name, l.time_zone, b.seat_kind, c.cancelled_at
    from public.parent_class_cancellations c
    join public.class_seats b on b.id = c.seat_id
    join public.athletes a on a.id = b.athlete_id
    join public.class_occurrences o on o.id = b.occurrence_id
    join public.standing_class_slots s on s.id = o.standing_slot_id
    left join public.skill_groups g on g.id = s.group_id
    join public.class_locations l on l.id = o.location_id
    order by c.cancelled_at desc, c.seat_id desc limit 201;
end;
$$;
revoke all on function public.list_my_cancellable_sessions(),
  public.cancel_my_class_seat(uuid), public.list_my_parent_cancellations(),
  public.list_coach_parent_cancellations()
  from public, anon, authenticated;
grant execute on function public.list_my_cancellable_sessions(),
  public.cancel_my_class_seat(uuid), public.list_my_parent_cancellations(),
  public.list_coach_parent_cancellations()
  to authenticated;
