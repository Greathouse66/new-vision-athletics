-- The receipt sender starts disabled. Only the migration owner enables it
-- after domain, provider, schedule, and delivery checks are complete.
create table private.billing_delivery_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  enabled_at timestamptz
);
insert into private.billing_delivery_settings(singleton, enabled) values (true, false);
alter table private.billing_delivery_settings enable row level security;
revoke all on private.billing_delivery_settings from public, anon, authenticated;

create function public.billing_delivery_ready()
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  return (select enabled from private.billing_delivery_settings where singleton);
end;
$$;
revoke all on function public.billing_delivery_ready() from public, anon, authenticated;
grant execute on function public.billing_delivery_ready() to authenticated;

-- Preserve the checked, locking payment implementation in the unexposed
-- schema. The public wrapper adds delivery and recipient prerequisites.
alter function public.confirm_venmo_payment(uuid, uuid[], bigint, timestamptz, text)
  set schema private;
revoke all on function private.confirm_venmo_payment(uuid, uuid[], bigint, timestamptz, text)
  from public, anon, authenticated;

create function public.confirm_venmo_payment(
  p_request_id uuid, p_charge_ids uuid[], p_amount_minor_units bigint,
  p_received_at timestamptz, p_provider_reference text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  -- Allow an identical retry to resolve an ambiguous network result even if
  -- delivery was paused or its contact subsequently changed.
  if p_request_id is not null and exists (
    select 1 from public.payment_receipts where request_id = p_request_id
  ) then
    return private.confirm_venmo_payment(p_request_id, p_charge_ids,
      p_amount_minor_units, p_received_at, p_provider_reference);
  end if;
  if not coalesce((select enabled from private.billing_delivery_settings
                    where singleton), false) then
    raise exception 'Receipt delivery is not ready' using errcode = '55000';
  end if;
  if p_charge_ids is null or pg_catalog.cardinality(p_charge_ids) not between 1 and 20 then
    raise exception 'Select one account''s charges' using errcode = '22023';
  end if;
  select family_id into v_family_id from public.athlete_monthly_charges
    where id = any(p_charge_ids) limit 1;
  if v_family_id is null or exists (
    select 1 from public.athlete_monthly_charges
     where id = any(p_charge_ids) and family_id <> v_family_id
  ) then
    raise exception 'Select one account''s charges' using errcode = '22023';
  end if;
  -- Serialize contact changes with payment confirmation and its queue trigger.
  perform 1 from public.families where id = v_family_id for update;
  if not exists (select 1 from public.family_billing_contacts
                 where family_id = v_family_id and revoked_at is null) then
    raise exception 'Approve a receipt email before confirming payment'
      using errcode = '22023';
  end if;
  return private.confirm_venmo_payment(p_request_id, p_charge_ids,
    p_amount_minor_units, p_received_at, p_provider_reference);
end;
$$;
revoke all on function public.confirm_venmo_payment(uuid, uuid[], bigint, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.confirm_venmo_payment(uuid, uuid[], bigint, timestamptz, text)
  to authenticated;

alter table private.payment_receipt_outbox
  add column status text not null default 'pending'
    check (status in ('pending', 'sending', 'retry', 'sent', 'review')),
  add column attempts integer not null default 0 check (attempts >= 0),
  add column first_attempt_at timestamptz,
  add column next_attempt_at timestamptz not null default now(),
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column delivery_payload jsonb,
  add column provider_message_id text,
  add column sent_at timestamptz,
  add column failure_code text;
create index payment_receipt_outbox_work_idx
  on private.payment_receipt_outbox(status, next_attempt_at, queued_at);

-- Service-role-only RPCs let the worker claim and settle one queue item.
-- The outbox and sender settings remain outside exposed Data API schemas.
create function public.claim_payment_receipt_delivery(
  p_portal_url text, p_from_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event private.payment_receipt_outbox%rowtype;
  v_contact public.family_billing_contacts%rowtype;
  v_payment public.payment_receipts%rowtype;
  v_lines jsonb;
  v_sum bigint;
  v_payload jsonb;
  v_token uuid := gen_random_uuid();
begin
  if not coalesce((select enabled from private.billing_delivery_settings
                    where singleton), false) then return null; end if;
  -- A stale uncertain delivery past the provider's 24-hour idempotency
  -- window needs manual review instead of a fresh automatic send.
  update private.payment_receipt_outbox set status = 'review',
    failure_code = 'uncertain_delivery_expired', lease_token = null, lease_until = null
   where status = 'sending' and lease_until < now()
     and first_attempt_at < now() - interval '20 hours';
  select * into v_event from private.payment_receipt_outbox
   where (status in ('pending', 'retry') and next_attempt_at <= now())
      or (status = 'sending' and lease_until < now()
          and first_attempt_at >= now() - interval '20 hours')
   order by queued_at, payment_id for update skip locked limit 1;
  if not found then return null; end if;

  select * into v_payment from public.payment_receipts where id = v_event.payment_id;
  select * into v_contact from public.family_billing_contacts
    where id = v_event.billing_contact_id and family_id = v_payment.family_id
      and revoked_at is null;
  if not found then
    update private.payment_receipt_outbox set status = 'review',
      failure_code = 'contact_missing_or_revoked' where payment_id = v_event.payment_id;
    return jsonb_build_object('review', true);
  end if;
  if v_event.first_attempt_at is not null
     and v_event.first_attempt_at < now() - interval '20 hours' then
    update private.payment_receipt_outbox set status = 'review',
      failure_code = 'retry_window_expired' where payment_id = v_event.payment_id;
    return jsonb_build_object('review', true);
  end if;

  if v_event.delivery_payload is null then
    select jsonb_agg(jsonb_build_object(
      'familyId', a.family_id, 'chargeId', a.charge_id,
      'athleteName', t.display_name, 'serviceMonth', c.service_month,
      'amountMinorUnits', a.amount_minor_units) order by a.id),
      coalesce(sum(a.amount_minor_units), 0)
      into v_lines, v_sum
      from public.payment_allocations a
      join public.athlete_monthly_charges c on c.id = a.charge_id
      join public.athletes t on t.id = c.athlete_id
     where a.payment_id = v_payment.id;
    if v_lines is null or v_sum <> v_payment.amount_minor_units then
      update private.payment_receipt_outbox set status = 'review',
        failure_code = 'allocation_mismatch' where payment_id = v_event.payment_id;
      return jsonb_build_object('review', true);
    end if;
    v_payload := jsonb_build_object(
      'paymentId', v_payment.id, 'familyId', v_payment.family_id,
      'amountMinorUnits', v_payment.amount_minor_units,
      'receivedAt', v_payment.received_at, 'allocations', v_lines,
      'portalSignInUrl', p_portal_url, 'from', p_from_email,
      'to', v_contact.email, 'contactId', v_contact.id
    );
  else
    v_payload := v_event.delivery_payload;
    if v_payload->>'to' <> v_contact.email
       or v_payload->>'contactId' <> v_contact.id::text then
      update private.payment_receipt_outbox set status = 'review',
        failure_code = 'contact_changed' where payment_id = v_event.payment_id;
      return jsonb_build_object('review', true);
    end if;
  end if;
  update private.payment_receipt_outbox
    set status = 'sending', attempts = attempts + 1,
        first_attempt_at = coalesce(first_attempt_at, now()),
        lease_token = v_token, lease_until = now() + interval '5 minutes',
        delivery_payload = v_payload, failure_code = null
    where payment_id = v_event.payment_id;
  return jsonb_build_object('leaseToken', v_token, 'payload', v_payload);
end;
$$;

create function public.settle_payment_receipt_delivery(
  p_payment_id uuid, p_lease_token uuid, p_sent boolean,
  p_provider_message_id text default null, p_failure_code text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event private.payment_receipt_outbox%rowtype;
begin
  select * into v_event from private.payment_receipt_outbox
   where payment_id = p_payment_id and status = 'sending'
     and lease_token = p_lease_token for update;
  if not found then
    raise exception 'Receipt lease unavailable' using errcode = '22023';
  end if;
  if p_sent then
    if p_provider_message_id is null or length(p_provider_message_id) not between 1 and 200 then
      raise exception 'Provider message ID required' using errcode = '22023';
    end if;
    update private.payment_receipt_outbox set status = 'sent',
      provider_message_id = p_provider_message_id, sent_at = now(),
      lease_token = null, lease_until = null, failure_code = null
      where payment_id = p_payment_id;
  else
    if p_failure_code is null or p_failure_code !~ '^[a-z0-9_]{3,64}$' then
      raise exception 'Safe failure code required' using errcode = '22023';
    end if;
    update private.payment_receipt_outbox
      set status = case when p_failure_code in ('temporary', 'rate_limited')
                   and first_attempt_at >= now() - interval '20 hours'
                   then 'retry' else 'review' end,
          next_attempt_at = now() + make_interval(secs =>
            least(3600, 30 * power(2, least(attempts, 7)))::integer),
          lease_token = null, lease_until = null, failure_code = p_failure_code
      where payment_id = p_payment_id;
  end if;
end;
$$;

create function public.receipt_contact_current(
  p_payment_id uuid, p_contact_id uuid, p_lease_token uuid
) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.payment_receipt_outbox o
    join public.payment_receipts p on p.id = o.payment_id
    join public.family_billing_contacts c on c.id = o.billing_contact_id
    where o.payment_id = p_payment_id and o.billing_contact_id = p_contact_id
      and o.lease_token = p_lease_token and o.status = 'sending'
      and (select enabled from private.billing_delivery_settings where singleton)
      and c.family_id = p.family_id and c.revoked_at is null
      and o.delivery_payload->>'to' = c.email
  );
$$;

revoke all on function public.claim_payment_receipt_delivery(text, text),
  public.settle_payment_receipt_delivery(uuid, uuid, boolean, text, text),
  public.receipt_contact_current(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_payment_receipt_delivery(text, text),
  public.settle_payment_receipt_delivery(uuid, uuid, boolean, text, text),
  public.receipt_contact_current(uuid, uuid, uuid)
  to service_role;

create function public.list_receipt_delivery_status(p_month date)
returns table (
  payment_id uuid, family_id uuid, received_at timestamptz,
  amount_minor_units bigint, delivery_status text, sent_at timestamptz
) language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_month is null or pg_catalog.date_part('day', p_month) <> 1 then
    raise exception 'First day of month required' using errcode = '22023';
  end if;
  return query
    select p.id, p.family_id, p.received_at, p.amount_minor_units,
           o.status, o.sent_at
      from public.payment_receipts p
      join private.payment_receipt_outbox o on o.payment_id = p.id
     where p.received_at >= (p_month::timestamp at time zone 'UTC')
       and p.received_at < ((p_month + interval '1 month')::timestamp at time zone 'UTC')
     order by p.received_at desc, p.id
     limit 200;
end;
$$;
revoke all on function public.list_receipt_delivery_status(date)
  from public, anon, authenticated;
grant execute on function public.list_receipt_delivery_status(date)
  to authenticated;
