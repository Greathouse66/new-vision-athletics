-- Installs class-change support only. No existing class is changed or emailed.
alter table public.class_occurrences
  add column schedule_revision integer not null default 1 check(schedule_revision > 0),
  add column closed_at timestamptz,
  add column closed_by uuid references auth.users(id),
  add column closure_reason text,
  add constraint class_closure_consistent check(
    (closed_at is null and closed_by is null and closure_reason is null)
    or (closed_at is not null and closed_by is not null and length(btrim(closure_reason)) between 3 and 500));
-- class_date remains the ORIGINAL roster date. UTC starts_at/ends_at record
-- the actual time; keeping the original key prevents accidental regeneration.
create table private.class_change_events(
  id uuid primary key default gen_random_uuid(),
  occurrence_id uuid not null references public.class_occurrences(id),
  revision integer not null,
  action text not null check(action in ('rescheduled','closed')),
  reason text not null check(length(btrim(reason)) between 3 and 500),
  actor_id uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  class_label text not null,
  before_details jsonb not null,
  after_details jsonb not null,
  unique(occurrence_id,revision)
);
create table private.class_change_athletes(
  change_id uuid not null references private.class_change_events(id),
  athlete_id uuid not null references public.athletes(id),
  family_id uuid not null references public.families(id),
  athlete_name text not null,
  booking_kind text not null check(booking_kind in ('confirmed','pending_request')),
  primary key(change_id,athlete_id)
);
alter table private.class_change_events enable row level security;
alter table private.class_change_athletes enable row level security;
revoke all on private.class_change_events,private.class_change_athletes from public,anon,authenticated;

create table private.class_change_notification_outbox (
  change_id uuid not null references private.class_change_events(id),
  parent_id uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,
  queued_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'retry', 'sent', 'skipped', 'review')),
  attempts integer not null default 0,
  first_attempt_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  delivery_payload jsonb,
  provider_message_id text,
  sent_at timestamptz,
  failure_code text,
  primary key(change_id, parent_id)
);
alter table private.class_change_notification_outbox enable row level security;
revoke all on private.class_change_notification_outbox from public, anon, authenticated;
create index class_change_notification_work_idx
  on private.class_change_notification_outbox(status, next_attempt_at, queued_at);


create function private.class_change_review(p_occurrence_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  with affected as (
    select b.athlete_id,'confirmed'::text as booking_kind from public.class_seats b
      where b.occurrence_id=p_occurrence_id and b.cancelled_at is null
    union all
    select r.athlete_id,'pending_request'::text from public.drop_in_requests r
      where r.occurrence_id=p_occurrence_id and r.status='pending'
      and not exists(select 1 from public.class_seats b where b.occurrence_id=p_occurrence_id
        and b.athlete_id=r.athlete_id and b.cancelled_at is null)
  )
  select jsonb_build_object(
    'occurrence',to_jsonb(o),
    'class_label',case when s.class_kind='intro' then 'Intro' else g.name end,
    'location_name',l.display_name,'time_zone',l.time_zone,
    'athletes',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'family_id',a.family_id,'name',a.display_name,'booking_kind',x.booking_kind,
      'parents',coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,
        'email',lower(u.email),'verified',u.email_confirmed_at is not null)
        order by u.id) from public.family_guardians fg join auth.users u on u.id=fg.user_id
        where fg.family_id=a.family_id),'[]'::jsonb)
    ) order by a.id) from affected x join public.athletes a on a.id=x.athlete_id),'[]'::jsonb))
  from public.class_occurrences o
  join public.standing_class_slots s on s.id=o.standing_slot_id
  left join public.skill_groups g on g.id=s.group_id
  join public.class_locations l on l.id=o.location_id where o.id=p_occurrence_id;
$$;
revoke all on function private.class_change_review(uuid) from public,anon,authenticated;

create function public.review_coach_class_change(p_occurrence_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_review jsonb; v_count integer; v_missing integer;
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  v_review:=private.class_change_review(p_occurrence_id);
  if v_review is null then raise exception 'Dated class not found' using errcode='22023'; end if;
  select count(distinct p->>'email')::integer into v_count
    from jsonb_array_elements(v_review->'athletes') a,
      jsonb_array_elements(a->'parents') p
    where (p->>'verified')::boolean and nullif(p->>'email','') is not null;
  select count(*)::integer into v_missing from jsonb_array_elements(v_review->'athletes') a
    where not exists(select 1 from jsonb_array_elements(a->'parents') p
      where (p->>'verified')::boolean and nullif(p->>'email','') is not null);
  -- Browser receives counts, not private guardian email addresses.
  return jsonb_build_object('review_token',md5(v_review::text),
    'occurrence',v_review->'occurrence','class_label',v_review->'class_label',
    'location_name',v_review->'location_name','time_zone',v_review->'time_zone',
    'email_count',v_count,'missing_contact_count',v_missing,
    'athletes',coalesce((select jsonb_agg(a-'parents'||jsonb_build_object(
      'has_email',exists(select 1 from jsonb_array_elements(a->'parents') p
        where (p->>'verified')::boolean and nullif(p->>'email','') is not null)))
      from jsonb_array_elements(v_review->'athletes') a),'[]'::jsonb));
end;
$$;
revoke all on function public.review_coach_class_change(uuid) from public,anon,authenticated;
grant execute on function public.review_coach_class_change(uuid) to authenticated;

create function public.save_coach_class_change(
  p_occurrence_id uuid,p_review_token text,p_action text,p_reason text,
  p_location_id uuid default null,p_local_start timestamp default null,
  p_duration_minutes integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := (select auth.uid());
  v_before public.class_occurrences%rowtype; v_after public.class_occurrences%rowtype;
  v_review jsonb; v_event uuid; v_zone text; v_starts timestamptz; v_ends timestamptz;
  v_local_end timestamp; v_label text; v_before_location text; v_before_zone text;
  v_queued integer; v_missing integer;
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('rescheduled','closed')
      or p_reason is null or length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'Choose an action and a parent-visible reason of 3 to 500 characters' using errcode='22023';
  end if;
  -- Same order as weekly edits and class generation; seats/requests lock this
  -- occurrence too, so the reviewed roster cannot change during the save.
  perform pg_catalog.pg_advisory_xact_lock(1568975,0);
  select * into v_before from public.class_occurrences where id=p_occurrence_id for update;
  if not found then raise exception 'Dated class not found' using errcode='22023'; end if;
  v_review:=private.class_change_review(p_occurrence_id);
  if p_review_token is null or p_review_token<>md5(v_review::text) then
    raise exception 'Class, roster or parent contacts changed. Reload and review again.' using errcode='40001';
  end if;
  if v_before.closed_at is not null or v_before.starts_at<=now() or exists(
    select 1 from public.class_attendance a join public.class_seats b on b.id=a.seat_id
    where b.occurrence_id=p_occurrence_id) then
    raise exception 'Only an open class that has not started can be changed' using errcode='55000';
  end if;
  v_label:=v_review->>'class_label';
  v_before_location:=v_review->>'location_name'; v_before_zone:=v_review->>'time_zone';
  if p_action='rescheduled' then
    if p_location_id is null or p_local_start is null or p_duration_minutes is null
        or p_duration_minutes not between 1 and 360 or not isfinite(p_local_start) then
      raise exception 'Choose a venue, local start and duration from 1 to 360 minutes' using errcode='22023';
    end if;
    select time_zone into v_zone from public.class_locations where id=p_location_id for share;
    if not found then raise exception 'Venue not found' using errcode='22023'; end if;
    v_local_end:=p_local_start+make_interval(mins=>p_duration_minutes);
    v_starts:=p_local_start at time zone v_zone; v_ends:=v_local_end at time zone v_zone;
    if (v_starts at time zone v_zone)<>p_local_start or (v_ends at time zone v_zone)<>v_local_end
      or v_ends<=v_starts or exists(select 1 from generate_series(-180,180,15) d(minutes)
        where d.minutes<>0 and (((v_starts+make_interval(mins=>d.minutes)) at time zone v_zone)=p_local_start
          or ((v_ends+make_interval(mins=>d.minutes)) at time zone v_zone)=v_local_end)) then
      raise exception 'This local time is missing or ambiguous because of daylight saving. Choose another time.' using errcode='22023';
    end if;
    if v_starts<=now() then raise exception 'The new class must start in the future' using errcode='22023'; end if;
    if (v_starts,v_ends,p_location_id) is not distinct from
        (v_before.starts_at,v_before.ends_at,v_before.location_id) then
      raise exception 'Change the time, duration or venue before saving' using errcode='22023';
    end if;
    if exists(select 1 from public.class_occurrences o where o.id<>p_occurrence_id and o.closed_at is null
      and o.starts_at<v_ends and o.ends_at>v_starts) then
      raise exception 'Another class overlaps this time. Review the schedule first.' using errcode='23514';
    end if;
    update public.class_occurrences set starts_at=v_starts,ends_at=v_ends,location_id=p_location_id,
      schedule_revision=schedule_revision+1 where id=p_occurrence_id returning * into v_after;
  else
    update public.class_occurrences set closed_at=now(),closed_by=v_actor,closure_reason=btrim(p_reason),
      schedule_revision=schedule_revision+1 where id=p_occurrence_id returning * into v_after;
  end if;
  insert into private.class_change_events(occurrence_id,revision,action,reason,actor_id,class_label,before_details,after_details)
    values(p_occurrence_id,v_after.schedule_revision,p_action,btrim(p_reason),v_actor,v_label,
      to_jsonb(v_before)||jsonb_build_object('location_name',v_before_location,'time_zone',v_before_zone),
      to_jsonb(v_after)||jsonb_build_object('location_name',case when p_action='closed' then v_before_location
          else (select display_name from public.class_locations where id=v_after.location_id) end,
        'time_zone',coalesce(v_zone,v_before_zone))) returning id into v_event;
  insert into private.class_change_athletes(change_id,athlete_id,family_id,athlete_name,booking_kind)
    select v_event,(a->>'id')::uuid,(a->>'family_id')::uuid,a->>'name',a->>'booking_kind'
      from jsonb_array_elements(v_review->'athletes') a;
  -- Snapshot recipients before releasing seats or declining pending requests.
  insert into private.class_change_notification_outbox(change_id,parent_id,recipient_email)
    select distinct on (lower(u.email)) v_event,u.id,lower(u.email)
    from private.class_change_athletes a join public.family_guardians fg on fg.family_id=a.family_id
    join auth.users u on u.id=fg.user_id
    where a.change_id=v_event and u.email_confirmed_at is not null and nullif(u.email,'') is not null
    order by lower(u.email),u.id;
  get diagnostics v_queued = row_count;
  select count(*)::integer into v_missing from jsonb_array_elements(v_review->'athletes') a
    where not exists(select 1 from jsonb_array_elements(a->'parents') p
      where (p->>'verified')::boolean and nullif(p->>'email','') is not null);
  if p_action='closed' then
    update public.class_seats set cancelled_at=now(),cancelled_by=v_actor
      where occurrence_id=p_occurrence_id and cancelled_at is null;
    update public.drop_in_requests set status='declined',reviewed_by=v_actor,reviewed_at=now()
      where occurrence_id=p_occurrence_id and status='pending';
  end if;
  return jsonb_build_object('change_id',v_event,'action',p_action,'queued_emails',v_queued,
    'missing_contact_count',v_missing,'revision',v_after.schedule_revision);
end;
$$;
revoke all on function public.save_coach_class_change(uuid,text,text,text,uuid,timestamp,integer) from public,anon,authenticated;
grant execute on function public.save_coach_class_change(uuid,text,text,text,uuid,timestamp,integer) to authenticated;

-- A stale booking page cannot reopen a closed date. Updates that merely
-- cancel an existing seat are allowed. All entry paths share the same lock.
create function private.require_open_class_booking()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_closed timestamptz;
begin
  select closed_at into v_closed from public.class_occurrences where id=new.occurrence_id for update;
  if v_closed is not null then raise exception 'This class is closed' using errcode='55000'; end if;
  return new;
end;
$$;
revoke all on function private.require_open_class_booking() from public,anon,authenticated;
create trigger open_class_for_new_seat before insert on public.class_seats
  for each row execute function private.require_open_class_booking();
create trigger open_class_for_new_request before insert on public.drop_in_requests
  for each row execute function private.require_open_class_booking();

-- Prevent later date generation from colliding with an individually moved class.
create function private.protect_rescheduled_class_time()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(1568975,0);
  if new.closed_at is null and exists(select 1 from public.class_occurrences o where
    o.id<>new.id and o.closed_at is null and o.starts_at<new.ends_at and o.ends_at>new.starts_at
    and (new.schedule_revision>1 or o.schedule_revision>1)) then
    raise exception 'Another class overlaps a rescheduled class. Review the schedule first.' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.protect_rescheduled_class_time() from public,anon,authenticated;
create trigger protect_rescheduled_class_time before insert or update of starts_at,ends_at,closed_at
  on public.class_occurrences for each row execute function private.protect_rescheduled_class_time();

create function public.list_my_class_changes()
returns table(change_id uuid,action text,reason text,changed_at timestamptz,
  athlete_name text,booking_kind text,class_label text,before_details jsonb,after_details jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign-in required' using errcode='42501'; end if;
  return query select e.id,e.action,e.reason,e.changed_at,a.athlete_name,a.booking_kind,e.class_label,
    e.before_details-ARRAY['closed_by','standing_slot_id'],e.after_details-ARRAY['closed_by','standing_slot_id']
    from private.class_change_events e join private.class_change_athletes a on a.change_id=e.id
    join public.athletes current_athlete on current_athlete.id=a.athlete_id and current_athlete.family_id=a.family_id
    where exists(select 1 from public.family_guardians fg where fg.family_id=a.family_id and fg.user_id=(select auth.uid()))
    order by e.changed_at desc,e.id,a.athlete_id limit 201;
end;
$$;
create function public.list_coach_class_changes(p_occurrence_id uuid)
returns table(change_id uuid,action text,reason text,changed_at timestamptz,
  before_details jsonb,after_details jsonb,delivery_counts jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then raise exception 'Coach access required' using errcode='42501'; end if;
  return query select e.id,e.action,e.reason,e.changed_at,e.before_details,e.after_details,
    coalesce((select jsonb_object_agg(c.status,c.n) from (
      select q.status,count(*) as n from private.class_change_notification_outbox q
      where q.change_id=e.id group by q.status) c),'{}'::jsonb)
    from private.class_change_events e where e.occurrence_id=p_occurrence_id
    order by e.changed_at desc,e.id limit 201;
end;
$$;
revoke all on function public.list_my_class_changes(),public.list_coach_class_changes(uuid) from public,anon,authenticated;
grant execute on function public.list_my_class_changes(),public.list_coach_class_changes(uuid) to authenticated;

create function private.class_change_notification_current(p_change_id uuid,p_parent_id uuid,p_email text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.class_change_events e
    join public.class_occurrences o on o.id=e.occurrence_id and o.schedule_revision=e.revision
    join private.class_change_athletes a on a.change_id=e.id
    join public.athletes ca on ca.id=a.athlete_id and ca.family_id=a.family_id
    join public.family_guardians fg on fg.family_id=a.family_id and fg.user_id=p_parent_id
    join auth.users u on u.id=fg.user_id
    left join private.class_change_notification_outbox q on q.change_id=e.id and q.parent_id=p_parent_id
    where e.id=p_change_id and u.email_confirmed_at is not null and lower(u.email)=p_email
      and not exists(select 1 from jsonb_array_elements(q.delivery_payload->'athletes') captured
        where not exists(select 1 from private.class_change_athletes scoped
          join public.athletes live on live.id=scoped.athlete_id and live.family_id=scoped.family_id
          join public.family_guardians grant_row on grant_row.family_id=scoped.family_id and grant_row.user_id=p_parent_id
          where scoped.change_id=e.id and scoped.athlete_id=(captured->>'athleteId')::uuid)));
$$;
revoke all on function private.class_change_notification_current(uuid,uuid,text) from public,anon,authenticated;

create function public.claim_class_change_notification(p_portal_url text, p_from_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event private.class_change_notification_outbox%rowtype;
  v_payload jsonb;
  v_token uuid := gen_random_uuid();
begin
  -- Stop uncertain retries before the provider's 24-hour idempotency window expires.
  update private.class_change_notification_outbox set status = 'review',
    failure_code = 'retry_window_expired', lease_token = null, lease_until = null
    where status in ('sending', 'retry') and first_attempt_at < now() - interval '20 hours'
      and (lease_until is null or lease_until < now());
  select * into v_event from private.class_change_notification_outbox
    where (status in ('pending', 'retry') and next_attempt_at <= now())
      or (status = 'sending' and lease_until < now())
    order by queued_at, change_id, parent_id for update skip locked limit 1;
  if not found then return null; end if;
  if not private.class_change_notification_current(v_event.change_id, v_event.parent_id, v_event.recipient_email) then
    update private.class_change_notification_outbox set status = 'skipped', failure_code = 'no_longer_current',
      lease_token = null, lease_until = null
      where change_id = v_event.change_id and parent_id = v_event.parent_id;
    return jsonb_build_object('skipped', true);
  end if;
  v_payload := v_event.delivery_payload;
  if v_payload is null then
    select jsonb_build_object('changeId',e.id,'parentId',v_event.parent_id,
      'to',v_event.recipient_email,'from',p_from_email,'portalUrl',p_portal_url,
      'action',e.action,'reason',e.reason,'classLabel',e.class_label,
      'before',e.before_details,'after',e.after_details,
      'athletes',(select jsonb_agg(jsonb_build_object('athleteId',a.athlete_id,'name',a.athlete_name,'bookingKind',a.booking_kind)
        order by a.athlete_id) from private.class_change_athletes a
        join public.athletes ca on ca.id=a.athlete_id and ca.family_id=a.family_id
        where a.change_id=e.id and exists(select 1 from public.family_guardians fg
          where fg.family_id=a.family_id and fg.user_id=v_event.parent_id)))
      into v_payload from private.class_change_events e where e.id=v_event.change_id;
  end if;
  update private.class_change_notification_outbox set status = 'sending', attempts = attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, now()), lease_token = v_token,
    lease_until = now() + interval '5 minutes', delivery_payload = v_payload, failure_code = null
    where change_id = v_event.change_id and parent_id = v_event.parent_id;
  return jsonb_build_object('payload', v_payload, 'leaseToken', v_token);
end;
$$;

create function public.class_change_notification_current(p_change_id uuid, p_parent_id uuid, p_lease_token uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.class_change_notification_outbox q
    where q.change_id = p_change_id and q.parent_id = p_parent_id
      and q.status = 'sending' and q.lease_token = p_lease_token and q.lease_until > now()
      and private.class_change_notification_current(q.change_id, q.parent_id, q.recipient_email));
$$;

create function public.settle_class_change_notification(p_change_id uuid, p_parent_id uuid,
  p_lease_token uuid, p_sent boolean, p_provider_id text default null, p_failure_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event private.class_change_notification_outbox%rowtype;
begin
  select * into v_event from private.class_change_notification_outbox
    where change_id = p_change_id and parent_id = p_parent_id
      and status = 'sending' and lease_token = p_lease_token for update;
  if not found then raise exception 'Notification lease unavailable' using errcode = '22023'; end if;
  if p_sent then
    if p_provider_id is null or length(p_provider_id) not between 1 and 200 then
      raise exception 'Provider message ID required' using errcode = '22023';
    end if;
    update private.class_change_notification_outbox set status = 'sent', sent_at = now(),
      provider_message_id = p_provider_id, lease_token = null, lease_until = null, failure_code = null
      where change_id = p_change_id and parent_id = p_parent_id;
  else
    if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{3,64}$' then
      raise exception 'Safe failure code required' using errcode = '22023';
    end if;
    update private.class_change_notification_outbox set
      status = case when p_failure_code = 'no_longer_current' then 'skipped'
        when p_failure_code in ('temporary', 'rate_limited')
          and first_attempt_at >= now() - interval '20 hours' then 'retry' else 'review' end,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempts, 7)))::integer),
      lease_token = null, lease_until = null, failure_code = p_failure_code
      where change_id = p_change_id and parent_id = p_parent_id;
  end if;
end;
$$;
revoke all on function public.claim_class_change_notification(text, text),
  public.class_change_notification_current(uuid, uuid, uuid),
  public.settle_class_change_notification(uuid, uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_class_change_notification(text, text),
  public.class_change_notification_current(uuid, uuid, uuid),
  public.settle_class_change_notification(uuid, uuid, uuid, boolean, text, text)
  to service_role;

-- New regular assignments skip closed dates and retain their future weekly term.
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
    where standing_slot_id = p_slot_id and class_date >= p_starts_on and closed_at is null
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


create or replace function public.list_open_drop_in_classes()
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
    select o.id, (o.starts_at at time zone l.time_zone)::date, o.starts_at, o.ends_at,
      case when s.class_kind = 'intro' then 'Intro'::text else g.name end,
      l.display_name, l.time_zone,
      (o.capacity - (select count(*)::integer from public.class_seats b
        where b.occurrence_id = o.id and b.cancelled_at is null))::integer,
      s.group_id, s.class_kind
    from public.class_occurrences o
    join public.standing_class_slots s on s.id = o.standing_slot_id
    left join public.skill_groups g on g.id = s.group_id
    join public.class_locations l on l.id = o.location_id
    where o.closed_at is null and o.starts_at > now() and o.starts_at < now() + interval '60 days'
    order by o.starts_at, o.id limit 201;
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
  if not found or v_occ.closed_at is not null or v_occ.starts_at <= now() then
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


-- An approval frozen before a reschedule is superseded by the class-change email.
create or replace function public.drop_in_approval_notification_current(p_request_id uuid,p_parent_id uuid,p_lease_token uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.drop_in_approval_notification_outbox q
    join public.drop_in_requests r on r.id=q.request_id
    join public.class_occurrences o on o.id=r.occurrence_id
    where q.request_id=p_request_id and q.parent_id=p_parent_id and q.status='sending'
      and q.lease_token=p_lease_token and q.lease_until>now()
      and (q.delivery_payload->>'startsAt')::timestamptz=o.starts_at
      and q.delivery_payload->>'locationName'=(select display_name from public.class_locations where id=o.location_id)
      and o.closed_at is null
      and private.drop_in_approval_notification_current(q.request_id,q.parent_id,q.recipient_email));
$$;

-- Today follows the actual venue-local date, including moves across weeks.
create function public.list_coach_class_day(p_date date)
returns setof public.class_occurrences language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then raise exception 'Coach access required' using errcode='42501'; end if;
  return query select o.* from public.class_occurrences o join public.class_locations l on l.id=o.location_id
    where (o.starts_at at time zone l.time_zone)::date=p_date order by o.starts_at,o.id;
end;
$$;
revoke all on function public.list_coach_class_day(date) from public,anon,authenticated;
grant execute on function public.list_coach_class_day(date) to authenticated;
