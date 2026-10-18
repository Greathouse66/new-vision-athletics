-- Allow linked parents to request any class level without changing group assignments.
-- Keep ownership, future-date, capacity, duplicate and declined-request checks.
create or replace function public.request_drop_in(p_athlete_id uuid, p_occurrence_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_occ public.class_occurrences%rowtype;
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
  -- Any skill level may request; suitability remains a coach approval decision.
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

-- Preserve the narrow authenticated-only RPC boundary explicitly.
revoke all on function public.request_drop_in(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_drop_in(uuid, uuid) to authenticated;
