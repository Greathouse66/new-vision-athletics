-- Reversible athlete status. Installing this migration archives nobody.
-- Keep athlete RLS unchanged so guardians retain their own financial/document history.
alter table public.athletes
  add column archived_at timestamptz,
  add column archive_revision integer not null default 1 check (archive_revision > 0);
create index athletes_active_name_idx on public.athletes(display_name,id) where archived_at is null;

-- A coach can still correct names through the existing audited UI, but cannot
-- forge lifecycle fields or bypass the checked RPC with a direct Data API write.
revoke update on public.athletes from authenticated;
grant update(display_name) on public.athletes to authenticated;

create table private.athlete_archive_events (
  id bigint generated always as identity primary key,
  athlete_id uuid not null,
  family_id uuid not null,
  actor_id uuid not null,
  changed_at timestamptz not null default now(),
  action text not null check (action in ('archived','reactivated')),
  before_athlete jsonb not null,
  after_athlete jsonb not null
);
alter table private.athlete_archive_events enable row level security;
revoke all on private.athlete_archive_events from public,anon,authenticated,service_role;
revoke all on sequence private.athlete_archive_events_id_seq from public,anon,authenticated,service_role;

create function public.set_athlete_archived(
  p_athlete_id uuid,p_expected_revision integer,p_archived boolean,p_confirmation_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.athletes%rowtype;
  v_after public.athletes%rowtype;
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  if p_athlete_id is null or p_expected_revision is null or p_archived is null then
    raise exception 'Choose an athlete and reload the roster' using errcode='22023';
  end if;
  -- Use the same order as weekly schedule editing/generation. Athlete row
  -- locking also serializes this status with individual seat/request inserts.
  perform pg_catalog.pg_advisory_xact_lock(1568975,0);
  select * into v_before from public.athletes where id=p_athlete_id for update;
  if not found or v_before.archive_revision<>p_expected_revision
      or p_confirmation_name is distinct from v_before.display_name then
    raise exception 'Athlete changed. Reload the roster before trying again.' using errcode='40001';
  end if;
  if (v_before.archived_at is not null)=p_archived then
    raise exception 'Athlete already has this status. Reload the roster.' using errcode='40001';
  end if;
  update public.athletes set archived_at=case when p_archived then now() else null end,
    archive_revision=archive_revision+1 where id=p_athlete_id returning * into v_after;
  insert into private.athlete_archive_events(athlete_id,family_id,actor_id,action,before_athlete,after_athlete)
    values(v_after.id,v_after.family_id,v_actor,case when p_archived then 'archived' else 'reactivated' end,
      to_jsonb(v_before),to_jsonb(v_after));
  return jsonb_build_object('athlete_id',v_after.id,'archived',p_archived,'revision',v_after.archive_revision);
end;
$$;
revoke all on function public.set_athlete_archived(uuid,integer,boolean,text) from public,anon,authenticated;
grant execute on function public.set_athlete_archived(uuid,integer,boolean,text) to authenticated;

-- Enforce status in the database, including stale browser tabs and coach approval.
create function private.require_active_athlete(p_athlete_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_archived timestamptz;
begin
  select archived_at into v_archived from public.athletes where id=p_athlete_id for share;
  if not found then raise exception 'Athlete not found' using errcode='22023'; end if;
  if v_archived is not null then
    raise exception 'This athlete is archived. Ask the coach to reactivate them before booking.' using errcode='55000';
  end if;
end;
$$;
revoke all on function private.require_active_athlete(uuid) from public,anon,authenticated;
create function private.require_active_booking_athlete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_active_athlete(new.athlete_id);
  return new;
end;
$$;
revoke all on function private.require_active_booking_athlete() from public,anon,authenticated;
create trigger active_athlete_for_new_seat before insert on public.class_seats
  for each row execute function private.require_active_booking_athlete();
create trigger active_athlete_for_new_drop_in_request before insert on public.drop_in_requests
  for each row execute function private.require_active_booking_athlete();

-- Preserve existing regular assignments, their reserved capacity and all dated
-- seats. Only automatic seats in newly generated dates pause while archived.
create or replace function private.reserve_regular_class_seats()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_assignment record;
begin
  perform 1 from public.standing_class_slots where id=new.standing_slot_id for update;
  for v_assignment in
    select r.id,r.athlete_id from public.regular_class_assignments r
    join public.athletes a on a.id=r.athlete_id
    where r.standing_slot_id=new.standing_slot_id and r.starts_on<=new.class_date
      and (r.ends_on is null or r.ends_on>new.class_date) and a.archived_at is null
    order by r.id
  loop
    perform private.confirm_class_seat(new.id,v_assignment.athlete_id,'regular',v_assignment.id,(select auth.uid()));
  end loop;
  return new;
end;
$$;

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
  perform private.require_active_athlete(p_athlete_id);
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

-- Guard new coach assignments; schedule versioning may still carry archived terms.
create or replace function private.add_regular_class_term(
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
  perform private.require_active_athlete(p_athlete_id);
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

