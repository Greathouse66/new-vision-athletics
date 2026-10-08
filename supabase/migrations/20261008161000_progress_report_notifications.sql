-- One portal notification to each currently linked, verified parent for a new report publication.
-- Applying this migration does not send historical reports.
create table private.progress_report_notification_outbox (
  report_id uuid not null references public.progress_reports(id) on delete cascade,
  publication integer not null,
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
  primary key(report_id, publication, parent_id)
);
alter table private.progress_report_notification_outbox enable row level security;
revoke all on private.progress_report_notification_outbox from public, anon, authenticated;
create index progress_report_notification_work_idx
  on private.progress_report_notification_outbox(status, next_attempt_at, queued_at);

create function private.queue_progress_report_emails()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'published' and (old.status <> 'published' or old.publication <> new.publication) then
    insert into private.progress_report_notification_outbox(report_id, publication, parent_id, recipient_email)
      select new.id, new.publication, u.id, lower(u.email)
      from public.athletes a join public.family_guardians g on g.family_id = a.family_id
      join auth.users u on u.id = g.user_id
      where a.id = new.athlete_id and u.email_confirmed_at is not null and u.email is not null
      on conflict (report_id, publication, parent_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.queue_progress_report_emails() from public, anon, authenticated;
create trigger queue_progress_report_emails after update of status on public.progress_reports
  for each row execute function private.queue_progress_report_emails();

create function private.progress_report_notification_current(p_report_id uuid, p_publication integer, p_parent_id uuid, p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.progress_reports r join public.athletes a on a.id = r.athlete_id
    join public.family_guardians g on g.family_id = a.family_id and g.user_id = p_parent_id
    join auth.users u on u.id = g.user_id
    where r.id = p_report_id and r.publication = p_publication and r.status = 'published'
      and u.email_confirmed_at is not null and lower(u.email) = p_email
      and private.progress_pdf_exists(r.current_file_id)
  );
$$;
revoke all on function private.progress_report_notification_current(uuid, integer, uuid, text)
  from public, anon, authenticated;

create function public.claim_progress_report_notification(p_portal_url text, p_from_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event private.progress_report_notification_outbox%rowtype;
  v_payload jsonb;
  v_token uuid := gen_random_uuid();
begin
  -- Stop uncertain retries before the provider's 24-hour idempotency window expires.
  update private.progress_report_notification_outbox set status = 'review',
    failure_code = 'retry_window_expired', lease_token = null, lease_until = null
    where status in ('sending', 'retry') and first_attempt_at < now() - interval '20 hours'
      and (lease_until is null or lease_until < now());
  select * into v_event from private.progress_report_notification_outbox
    where (status in ('pending', 'retry') and next_attempt_at <= now())
      or (status = 'sending' and lease_until < now())
    order by queued_at, report_id, parent_id for update skip locked limit 1;
  if not found then return null; end if;
  if not private.progress_report_notification_current(v_event.report_id, v_event.publication, v_event.parent_id, v_event.recipient_email) then
    update private.progress_report_notification_outbox set status = 'skipped', failure_code = 'no_longer_current',
      lease_token = null, lease_until = null
      where report_id = v_event.report_id and publication = v_event.publication and parent_id = v_event.parent_id;
    return jsonb_build_object('skipped', true);
  end if;
  v_payload := v_event.delivery_payload;
  if v_payload is null then
    v_payload := jsonb_build_object('reportId', v_event.report_id, 'publication', v_event.publication,
      'parentId', v_event.parent_id, 'to', v_event.recipient_email, 'from', p_from_email,
      'portalUrl', p_portal_url);
  end if;
  update private.progress_report_notification_outbox set status = 'sending', attempts = attempts + 1,
    first_attempt_at = coalesce(first_attempt_at, now()), lease_token = v_token,
    lease_until = now() + interval '5 minutes', delivery_payload = v_payload, failure_code = null
    where report_id = v_event.report_id and publication = v_event.publication and parent_id = v_event.parent_id;
  return jsonb_build_object('payload', v_payload, 'leaseToken', v_token);
end;
$$;

create function public.progress_report_notification_current(p_report_id uuid, p_publication integer, p_parent_id uuid, p_lease_token uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.progress_report_notification_outbox q
    where q.report_id = p_report_id and q.publication = p_publication and q.parent_id = p_parent_id
      and q.status = 'sending' and q.lease_token = p_lease_token and q.lease_until > now()
      and private.progress_report_notification_current(q.report_id, q.publication, q.parent_id, q.recipient_email));
$$;

create function public.settle_progress_report_notification(p_report_id uuid, p_publication integer, p_parent_id uuid,
  p_lease_token uuid, p_sent boolean, p_provider_id text default null, p_failure_code text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event private.progress_report_notification_outbox%rowtype;
begin
  select * into v_event from private.progress_report_notification_outbox
    where report_id = p_report_id and publication = p_publication and parent_id = p_parent_id
      and status = 'sending' and lease_token = p_lease_token for update;
  if not found then raise exception 'Notification lease unavailable' using errcode = '22023'; end if;
  if p_sent then
    if p_provider_id is null or length(p_provider_id) not between 1 and 200 then
      raise exception 'Provider message ID required' using errcode = '22023';
    end if;
    update private.progress_report_notification_outbox set status = 'sent', sent_at = now(),
      provider_message_id = p_provider_id, lease_token = null, lease_until = null, failure_code = null
      where report_id = p_report_id and publication = p_publication and parent_id = p_parent_id;
  else
    if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{3,64}$' then
      raise exception 'Safe failure code required' using errcode = '22023';
    end if;
    update private.progress_report_notification_outbox set
      status = case when p_failure_code = 'no_longer_current' then 'skipped'
        when p_failure_code in ('temporary', 'rate_limited')
          and first_attempt_at >= now() - interval '20 hours' then 'retry' else 'review' end,
      next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, least(attempts, 7)))::integer),
      lease_token = null, lease_until = null, failure_code = p_failure_code
      where report_id = p_report_id and publication = p_publication and parent_id = p_parent_id;
  end if;
end;
$$;
revoke all on function public.claim_progress_report_notification(text, text),
  public.progress_report_notification_current(uuid, integer, uuid, uuid),
  public.settle_progress_report_notification(uuid, integer, uuid, uuid, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_progress_report_notification(text, text),
  public.progress_report_notification_current(uuid, integer, uuid, uuid),
  public.settle_progress_report_notification(uuid, integer, uuid, uuid, boolean, text, text)
  to service_role;
