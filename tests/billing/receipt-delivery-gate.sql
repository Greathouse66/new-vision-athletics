-- Paste the whole script into Supabase SQL Editor. It has no external calls,
-- creates only synthetic records, and rolls back the flag and test rows.
begin;
do $test$
declare
  v_actor uuid := 'a12fe76a-c6d6-4666-9ed3-8c49c6b44c49';
  v_family uuid;
  v_athlete uuid;
  v_charge uuid;
  v_contact uuid;
  v_request uuid := gen_random_uuid();
  v_payment uuid;
begin
  if (select enabled from private.billing_delivery_settings where singleton) then
    raise exception 'Delivery is already enabled; this test expects the safe default';
  end if;
  if has_function_privilege('authenticated',
       'public.claim_payment_receipt_delivery(text,text)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'public.settle_payment_receipt_delivery(uuid,uuid,boolean,text,text)', 'EXECUTE') then
    raise exception 'Browser role can invoke worker-only functions';
  end if;
  if not exists (select 1 from auth.users where id = v_actor) then
    raise exception 'Test Auth user not found';
  end if;
  insert into public.families(display_name) values ('Rollback receipt gate account')
    returning id into v_family;
  insert into public.athletes(family_id, display_name)
    values (v_family, 'Rollback receipt gate athlete') returning id into v_athlete;
  insert into public.coach_users(user_id) values (v_actor)
    on conflict (user_id) do nothing;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  v_contact := public.set_family_billing_contact(v_family, 'rollback@example.test');
  v_charge := public.assign_monthly_charge(v_athlete, date '2026-10-01', 10000, 'USD');

  begin
    perform public.confirm_venmo_payment(v_request, array[v_charge], 10000, now(), null);
    raise exception 'Disabled payment gate unexpectedly allowed confirmation';
  exception when object_not_in_prerequisite_state then null;
  end;
  if exists (select 1 from public.payment_receipts where request_id = v_request) then
    raise exception 'Disabled gate wrote a payment';
  end if;

  -- Enable only inside this transaction; no worker is called and rollback
  -- restores the disabled setting after the assertion.
  update private.billing_delivery_settings set enabled = true, enabled_at = now()
    where singleton;
  v_payment := public.confirm_venmo_payment(v_request, array[v_charge], 10000, now(), null);
  if not exists (select 1 from private.payment_receipt_outbox
                 where payment_id = v_payment and billing_contact_id = v_contact
                   and status = 'pending') then
    raise exception 'Payment did not queue receipt for approved contact';
  end if;
  update private.billing_delivery_settings set enabled = false, enabled_at = null
    where singleton;
  -- The same request ID must still resolve when delivery is paused. The
  -- original received_at is read back so the idempotency check matches.
  if public.confirm_venmo_payment(v_request, array[v_charge], 10000,
       (select received_at from public.payment_receipts where id = v_payment), null) <> v_payment then
    raise exception 'Identical payment retry failed';
  end if;
  raise notice 'PASS: disabled gate, approved contact, queued receipt and retry; rolled back';
end
$test$;
rollback;
