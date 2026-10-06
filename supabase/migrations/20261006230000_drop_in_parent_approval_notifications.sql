-- One confirmation to the verified parent who requested an approved drop-in.
-- Applying this migration does not email historical approvals.
create table private.drop_in_approval_notification_outbox (
  request_id uuid not null references public.drop_in_requests(id) on delete cascade,
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
  primary key(request_id, parent_id)
);
alter table private.drop_in_approval_notification_outbox enable row level security;
revoke all on private.drop_in_approval_notification_outbox from public, anon, authenticated;
create index drop_in_approval_notification_work_idx
  on private.drop_in_approval_notification_outbox(status, next_attempt_at, queued_at);

create function private.queue_drop_in_parent_approval_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status = 'approved' and new.seat_id is not null then
    insert into private.drop_in_approval_notification_outbox(request_id, parent_id, recipient_email)
      select new.id, u.id, lower(u.email)
      from auth.users u
      join public.athletes a on a.id = new.athlete_id
      join public.family_guardians g on g.family_id = a.family_id and g.user_id = u.id
      where u.id = new.requested_by and u.email_confirmed_at is not null and u.email is not null
      on conflict (request_id, parent_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_drop_in_parent_approval_email() from public, anon, authenticated;
create trigger queue_drop_in_parent_approval_email after update of status on public.drop_in_requests
  for each row execute function private.queue_drop_in_parent_approval_email();

create function private.drop_in_approval_notification_current(p_request_id uuid, p_parent_id uuid, p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.drop_in_requests r
    join public.athletes a on a.id = r.athlete_id
    join public.family_guardians g on g.family_id = a.family_id and g.user_id = r.requested_by
    join auth.users u on u.id = g.user_id and u.email_confirmed_at is not null
    join public.class_occurrences o on o.id = r.occurrence_id
    join public.class_seats b on b.id = r.seat_id and b.athlete_id = r.athlete_id
      and b.occurrence_id = r.occurrence_id and b.cancelled_at is null
    where r.id = p_request_id and r.requested_by = p_parent_id
      and r.status = 'approved' and o.starts_at > now() and lower(u.email) = p_email
  );
$$;
revoke all on function private.drop_in_approval_notification_current(uuid, uuid, text)
  from public, anon, authenticated;

create function public.claim_drop_in_approval_notification(p_portal_url text, p_from_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event private.drop_in_approval_notification_outbox%rowtype;
  v_payload jsonb;
  v_token uuid := gen_random_uuid();
begin
  -- Stop uncertain retries before the provider's 24-hour idempotency window expires.
  update private.drop_in_approval_notification_outbox set status = 'review',
    failure_code = 'retry_window_expired', lease_token = null, lease_until = null
    where status in ('sending', 'retry') and first_attempt_at < now() - interval '20 hours'
      and (lease_until is null or lease_until < now());
  select * into v_event from private.drop_in_approval_notification_outbox
    where (status in ('pending', 'retry') and next_attempt_at <= now())
      or (status = 'sending' and lease_until < now())
    order by queued_at, request_id, parent_id for update skip locked limit 1;
  if not found then return null; end if;
  if not private.drop_in_approval_notification_current(v_event.request_id, v_event.parent_id, v_event.recipient_email) then
    update private.drop_in_approval_notification_outbox set status = 'skipped', failure_code = 'no_longer_current',
      lease_token = null, lease_until = null
      where request_id = v_event.request_id and parent_id = v_event.parent_id;
    return jsonb_build_object('skipped', true);
  end if;
  v_payload := v_event.delivery_payload;
  if v_payload is null then
    select jsonb_build_object('requestId', r.id, 'parentId', v_event.parent_id,
      'to', v_event.recipient_email, 'from', p_from_email, 'portalUrl', p_portal_url,
      'seatId', r.seat_id, 'athleteName', a.display_name, 'startsAt', o.starts_at, 'timeZone', l.time_zone,
      'classLabel', case when s.class_kind = 'intro' then 'Intro' else t.name end,
      'locationName', l.display_name)
      into v_payload
      from public.drop_in_requests r
      join public.athletes a on a.id = r.athlete_id
      join public.class_occurrences o on o.id = r.occurrence_id
      join public.standing_class_slots s on s.id = o.standing_slot_id
      left join public.skill_groups t on t.id = s.group_id
      join public.class_locations l on l.id = o.location_id
      where r.id = v_event.request_id;
  end if;
  update private.drop_in_approval_notification_outbox set status = 'sending', attempts = attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, now()), lease_token = v_token,
    lease_until = now() + interval '5 minutes', delivery_payload = v_payload, failure_code = null
    where request_id = v_event.request_id and parent_id = v_event.parent_id;
  return jsonb_build_object('payload', v_payload, 'leaseToken', v_token);
end;
$$;

create function public.drop_in_approval_notification_current(p_request_id uuid, p_parent_id uuid, p_lease_token uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.drop_in_approval_notification_outbox q
    where q.request_id = p_request_id and q.parent_id = p_parent_id
      and q.status = 'sending' and q.lease_token = p_lease_token and q.lease_until > now()
      and private.drop_in_approval_notification_current(q.request_id, q.parent_id, q.recipient_email));
$$;

create function public.settle_drop_in_approval_notification(p_request_id uuid, p_parent_id uuid,
  p_lease_token uuid, p_sent boolean, p_provider_id text default null, p_failure_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event private.drop_in_approval_notification_outbox%rowtype;
begin
  select * into v_event from private.drop_in_approval_notification_outbox
    where request_id = p_request_id and parent_id = p_parent_id
      and status = 'sending' and lease_token = p_lease_token for update;
  if not found then raise exception 'Notification lease unavailable' using errcode = '22023'; end if;
  if p_sent then
    if p_provider_id is null or length(p_provider_id) not between 1 and 200 then
      raise exception 'Provider message ID required' using errcode = '22023';
    end if;
    update private.drop_in_approval_notification_outbox set status = 'sent', sent_at = now(),
      provider_message_id = p_provider_id, lease_token = null, lease_until = null, failure_code = null
      where request_id = p_request_id and parent_id = p_parent_id;
  else
    if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{3,64}$' then
      raise exception 'Safe failure code required' using errcode = '22023';
    end if;
    update private.drop_in_approval_notification_outbox set
      status = case when p_failure_code = 'no_longer_current' then 'skipped'
        when p_failure_code in ('temporary', 'rate_limited')
          and first_attempt_at >= now() - interval '20 hours' then 'retry' else 'review' end,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempts, 7)))::integer),
      lease_token = null, lease_until = null, failure_code = p_failure_code
      where request_id = p_request_id and parent_id = p_parent_id;
  end if;
end;
$$;
revoke all on function public.claim_drop_in_approval_notification(text, text),
  public.drop_in_approval_notification_current(uuid, uuid, uuid),
  public.settle_drop_in_approval_notification(uuid, uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_drop_in_approval_notification(text, text),
  public.drop_in_approval_notification_current(uuid, uuid, uuid),
  public.settle_drop_in_approval_notification(uuid, uuid, uuid, boolean, text, text)
  to service_role;
