-- Coach-only, atomic billing actions. Browser roles retain read-only table
-- access; these functions are the only authenticated write boundary.

alter table public.payment_receipts
  add column request_id uuid not null unique;

create function public.assign_monthly_charge(
  p_athlete_id uuid, p_service_month date, p_amount_minor_units bigint,
  p_currency text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.athlete_monthly_charges%rowtype;
  v_family_id uuid;
  v_id uuid;
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_athlete_id is null or p_service_month is null
     or pg_catalog.date_part('day', p_service_month) <> 1
     or p_amount_minor_units is null or p_amount_minor_units < 0
     or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Provide an athlete, first day of month, nonnegative amount and currency'
      using errcode = '22023';
  end if;

  -- Lock the athlete so two coaches assigning the same month serialize.
  select family_id into v_family_id from public.athletes
    where id = p_athlete_id for update;
  if not found then
    raise exception 'Athlete not found' using errcode = '22023';
  end if;
  select * into v_existing from public.athlete_monthly_charges
    where athlete_id = p_athlete_id and service_month = p_service_month;
  if found then
    if v_existing.family_id = v_family_id
       and v_existing.amount_minor_units = p_amount_minor_units
       and v_existing.currency = p_currency then
      return v_existing.id;
    end if;
    raise exception 'Monthly charge already exists; corrections need review'
      using errcode = '22023';
  end if;

  insert into public.athlete_monthly_charges
    (athlete_id, family_id, service_month, amount_minor_units, currency, assigned_by)
    values (p_athlete_id, v_family_id, p_service_month, p_amount_minor_units,
            p_currency, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

create function public.confirm_venmo_payment(
  p_request_id uuid, p_charge_ids uuid[], p_amount_minor_units bigint,
  p_received_at timestamptz, p_provider_reference text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_charge public.athlete_monthly_charges%rowtype;
  v_family_id uuid;
  v_currency text;
  v_amount bigint := 0;
  v_outstanding bigint;
  v_count integer := 0;
  v_selected uuid[];
  v_prior_ids uuid[];
  v_prior public.payment_receipts%rowtype;
  v_reference text := nullif(pg_catalog.btrim(p_provider_reference), '');
  v_payment_id uuid;
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_request_id is null or p_charge_ids is null
     or pg_catalog.cardinality(p_charge_ids) not between 1 and 20
     or p_amount_minor_units is null or p_amount_minor_units <= 0
     or p_received_at is null or p_received_at > pg_catalog.now()
     or pg_catalog.length(v_reference) > 160 then
    raise exception 'Valid request, charges, amount, received time and reference required'
      using errcode = '22023';
  end if;
  select pg_catalog.array_agg(s.id order by s.id) into v_selected
    from pg_catalog.unnest(p_charge_ids) as s(id);
  if pg_catalog.cardinality(v_selected) <> (
    select pg_catalog.count(distinct s.id) from pg_catalog.unnest(p_charge_ids) as s(id)
  ) then
    raise exception 'Select each charge once' using errcode = '22023';
  end if;

  -- Order row locks consistently so simultaneous sibling payments cannot
  -- each spend the same outstanding charge. All reads below use held locks.
  for v_charge in
    select * from public.athlete_monthly_charges
    where id = any(p_charge_ids) order by id for update
  loop
    v_count := v_count + 1;
    if v_family_id is null then
      v_family_id := v_charge.family_id;
      v_currency := v_charge.currency;
    elsif v_charge.family_id <> v_family_id or v_charge.currency <> v_currency then
      raise exception 'Charges must share one account and currency'
        using errcode = '22023';
    end if;
  end loop;
  if v_count <> pg_catalog.cardinality(v_selected) then
    raise exception 'Charge not found' using errcode = '22023';
  end if;

  -- A repeated request returns the same receipt. Reusing its ID for a
  -- different confirmation is an error, even when the first one was paid.
  select * into v_prior from public.payment_receipts
    where request_id = p_request_id;
  if found then
    select pg_catalog.array_agg(a.charge_id order by a.charge_id) into v_prior_ids
      from public.payment_allocations a where a.payment_id = v_prior.id;
    if v_prior.family_id = v_family_id and v_prior.currency = v_currency
       and v_prior.amount_minor_units = p_amount_minor_units
       and v_prior.received_at = p_received_at
       and v_prior.provider_reference is not distinct from v_reference
       and v_prior_ids = v_selected then
      return v_prior.id;
    end if;
    raise exception 'Request ID has already been used for another confirmation'
      using errcode = '22023';
  end if;

  for v_charge in
    select * from public.athlete_monthly_charges
    where id = any(p_charge_ids) order by id
  loop
    select v_charge.amount_minor_units - coalesce(sum(a.amount_minor_units), 0)
      into v_outstanding from public.payment_allocations a
      where a.charge_id = v_charge.id;
    if v_outstanding <= 0 then
      raise exception 'A selected charge is already paid or needs review'
        using errcode = '22023';
    end if;
    v_amount := v_amount + v_outstanding;
  end loop;
  if v_amount <> p_amount_minor_units then
    raise exception 'Payment amount must equal the selected outstanding balances'
      using errcode = '22023';
  end if;

  insert into public.payment_receipts
    (request_id, family_id, currency, amount_minor_units, received_at,
     provider_reference, confirmed_by)
    values (p_request_id, v_family_id, v_currency, p_amount_minor_units,
            p_received_at, v_reference, auth.uid()) returning id into v_payment_id;

  for v_charge in
    select * from public.athlete_monthly_charges
    where id = any(p_charge_ids) order by id
  loop
    select v_charge.amount_minor_units - coalesce(sum(a.amount_minor_units), 0)
      into v_outstanding from public.payment_allocations a
      where a.charge_id = v_charge.id;
    insert into public.payment_allocations
      (family_id, currency, charge_id, payment_id, amount_minor_units)
      values (v_family_id, v_currency, v_charge.id, v_payment_id, v_outstanding);
  end loop;
  return v_payment_id;
end;
$$;

revoke all on function public.assign_monthly_charge(uuid, date, bigint, text),
  public.confirm_venmo_payment(uuid, uuid[], bigint, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.assign_monthly_charge(uuid, date, bigint, text),
  public.confirm_venmo_payment(uuid, uuid[], bigint, timestamptz, text)
  to authenticated;
