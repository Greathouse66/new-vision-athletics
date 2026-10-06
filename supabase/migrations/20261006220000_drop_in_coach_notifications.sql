-- Coaches subscribe using their own verified Auth email. No mail is sent by SQL.
create table private.coach_drop_in_email_preferences (
  user_id uuid primary key references public.coach_users(user_id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
create table private.drop_in_notification_outbox (
  request_id uuid not null references public.drop_in_requests(id) on delete cascade,
  coach_id uuid not null references public.coach_users(user_id) on delete cascade,
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
  primary key(request_id, coach_id)
);
alter table private.coach_drop_in_email_preferences enable row level security;
alter table private.drop_in_notification_outbox enable row level security;
revoke all on private.coach_drop_in_email_preferences, private.drop_in_notification_outbox
  from public, anon, authenticated;
create index drop_in_notification_work_idx
  on private.drop_in_notification_outbox(status, next_attempt_at, queued_at);

create function public.my_drop_in_email_preference()
returns table(enabled boolean, email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  return query select coalesce(p.enabled, false), u.email::text
    from auth.users u left join private.coach_drop_in_email_preferences p on p.user_id = u.id
    where u.id = auth.uid() and u.email_confirmed_at is not null;
end;
$$;

create function public.set_my_drop_in_email_preference(p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_enabled is null or not exists (select 1 from auth.users u
      where u.id = auth.uid() and u.email_confirmed_at is not null and u.email is not null) then
    raise exception 'Verified coach email required' using errcode = '22023';
  end if;
  insert into private.coach_drop_in_email_preferences(user_id, enabled)
    values (auth.uid(), p_enabled) on conflict (user_id) do update
      set enabled = excluded.enabled, updated_at = now();
end;
$$;
revoke all on function public.my_drop_in_email_preference(), public.set_my_drop_in_email_preference(boolean)
  from public, anon;
grant execute on function public.my_drop_in_email_preference(), public.set_my_drop_in_email_preference(boolean)
  to authenticated;

create function private.queue_drop_in_coach_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending' then
    insert into private.drop_in_notification_outbox(request_id, coach_id, recipient_email)
      select new.id, c.user_id, lower(u.email)
      from public.coach_users c
      join auth.users u on u.id = c.user_id
      join private.coach_drop_in_email_preferences p on p.user_id = c.user_id and p.enabled
      where u.email_confirmed_at is not null and u.email is not null
      on conflict (request_id, coach_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_drop_in_coach_email() from public, anon, authenticated;
create trigger queue_drop_in_coach_email after insert on public.drop_in_requests
  for each row execute function private.queue_drop_in_coach_email();

-- The same authorization is checked at claim and immediately before sending.
create function private.drop_in_notification_current(p_request_id uuid, p_coach_id uuid, p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.drop_in_requests r
    join public.athletes a on a.id = r.athlete_id
    join public.family_guardians g on g.family_id = a.family_id and g.user_id = r.requested_by
    join public.class_occurrences o on o.id = r.occurrence_id
    join public.coach_users c on c.user_id = p_coach_id
    join auth.users u on u.id = c.user_id and u.email_confirmed_at is not null
    join private.coach_drop_in_email_preferences p on p.user_id = c.user_id and p.enabled
    where r.id = p_request_id and r.status = 'pending' and o.starts_at > now()
      and lower(u.email) = p_email
  );
$$;
revoke all on function private.drop_in_notification_current(uuid, uuid, text)
  from public, anon, authenticated;

create function public.claim_drop_in_notification(p_review_url text, p_from_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event private.drop_in_notification_outbox%rowtype;
  v_payload jsonb;
  v_token uuid := gen_random_uuid();
begin
  -- Stop uncertain retries before the provider's 24-hour idempotency window expires.
  update private.drop_in_notification_outbox set status = 'review',
    failure_code = 'retry_window_expired', lease_token = null, lease_until = null
    where status in ('sending', 'retry') and first_attempt_at < now() - interval '20 hours'
      and (lease_until is null or lease_until < now());
  select * into v_event from private.drop_in_notification_outbox
    where (status in ('pending', 'retry') and next_attempt_at <= now())
      or (status = 'sending' and lease_until < now())
    order by queued_at, request_id, coach_id for update skip locked limit 1;
  if not found then return null; end if;
  if not private.drop_in_notification_current(v_event.request_id, v_event.coach_id, v_event.recipient_email) then
    update private.drop_in_notification_outbox set status = 'skipped', failure_code = 'no_longer_current',
      lease_token = null, lease_until = null
      where request_id = v_event.request_id and coach_id = v_event.coach_id;
    return jsonb_build_object('skipped', true);
  end if;
  v_payload := v_event.delivery_payload;
  if v_payload is null then
    select jsonb_build_object('requestId', r.id, 'coachId', v_event.coach_id,
      'to', v_event.recipient_email, 'from', p_from_email, 'reviewUrl', p_review_url,
      'athleteName', a.display_name, 'startsAt', o.starts_at, 'timeZone', l.time_zone,
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
  update private.drop_in_notification_outbox set status = 'sending', attempts = attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, now()), lease_token = v_token,
    lease_until = now() + interval '5 minutes', delivery_payload = v_payload, failure_code = null
    where request_id = v_event.request_id and coach_id = v_event.coach_id;
  return jsonb_build_object('payload', v_payload, 'leaseToken', v_token);
end;
$$;

create function public.drop_in_notification_current(p_request_id uuid, p_coach_id uuid, p_lease_token uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.drop_in_notification_outbox q
    where q.request_id = p_request_id and q.coach_id = p_coach_id
      and q.status = 'sending' and q.lease_token = p_lease_token and q.lease_until > now()
      and private.drop_in_notification_current(q.request_id, q.coach_id, q.recipient_email));
$$;

create function public.settle_drop_in_notification(p_request_id uuid, p_coach_id uuid,
  p_lease_token uuid, p_sent boolean, p_provider_id text default null, p_failure_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event private.drop_in_notification_outbox%rowtype;
begin
  select * into v_event from private.drop_in_notification_outbox
    where request_id = p_request_id and coach_id = p_coach_id
      and status = 'sending' and lease_token = p_lease_token for update;
  if not found then raise exception 'Notification lease unavailable' using errcode = '22023'; end if;
  if p_sent then
    if p_provider_id is null or length(p_provider_id) not between 1 and 200 then
      raise exception 'Provider message ID required' using errcode = '22023';
    end if;
    update private.drop_in_notification_outbox set status = 'sent', sent_at = now(),
      provider_message_id = p_provider_id, lease_token = null, lease_until = null, failure_code = null
      where request_id = p_request_id and coach_id = p_coach_id;
  else
    if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{3,64}$' then
      raise exception 'Safe failure code required' using errcode = '22023';
    end if;
    update private.drop_in_notification_outbox set
      status = case when p_failure_code = 'no_longer_current' then 'skipped'
        when p_failure_code in ('temporary', 'rate_limited')
          and first_attempt_at >= now() - interval '20 hours' then 'retry' else 'review' end,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempts, 7)))::integer),
      lease_token = null, lease_until = null, failure_code = p_failure_code
      where request_id = p_request_id and coach_id = p_coach_id;
  end if;
end;
$$;
revoke all on function public.claim_drop_in_notification(text, text),
  public.drop_in_notification_current(uuid, uuid, uuid),
  public.settle_drop_in_notification(uuid, uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_drop_in_notification(text, text),
  public.drop_in_notification_current(uuid, uuid, uuid),
  public.settle_drop_in_notification(uuid, uuid, uuid, boolean, text, text)
  to service_role;
