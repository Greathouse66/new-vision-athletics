-- One statement snapshot for a coach's internal monthly reconciliation export.
-- Charges use service month; payments and their allocations use received UTC month.
create function public.billing_export_snapshot(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_charges jsonb;
  v_payments jsonb;
  v_allocations jsonb;
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_month is null or pg_catalog.date_part('day', p_month) <> 1 then
    raise exception 'First day of reporting month required' using errcode = '22023';
  end if;
  v_start := p_month::timestamp at time zone 'UTC';
  v_end := (p_month + interval '1 month')::timestamp at time zone 'UTC';

  if (select count(*) from public.athlete_monthly_charges
      where service_month = p_month) > 5000
     or (select count(*) from public.payment_receipts
         where received_at >= v_start and received_at < v_end) > 5000
     or (select count(*) from public.payment_allocations a
         join public.payment_receipts p on p.id = a.payment_id
         where p.received_at >= v_start and p.received_at < v_end) > 5000 then
    raise exception 'Reporting month exceeds export limit' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.athlete_id, c.id), '[]'::jsonb)
    into v_charges from (
      select c.id, c.family_id, c.athlete_id, c.service_month, c.currency,
             c.amount_minor_units,
             coalesce(sum(a.amount_minor_units), 0)::bigint as allocated_minor_units
        from public.athlete_monthly_charges c
        left join public.payment_allocations a on a.charge_id = c.id
       where c.service_month = p_month
       group by c.id
    ) c;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.received_at, p.id), '[]'::jsonb)
    into v_payments from (
      select id, family_id, received_at, currency, amount_minor_units,
             method, provider_reference
        from public.payment_receipts
       where received_at >= v_start and received_at < v_end
    ) p;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.payment_id, a.id), '[]'::jsonb)
    into v_allocations from (
      select a.id, a.payment_id, a.charge_id, a.amount_minor_units
        from public.payment_allocations a
        join public.payment_receipts p on p.id = a.payment_id
       where p.received_at >= v_start and p.received_at < v_end
    ) a;
  return jsonb_build_object(
    'format', 'nva-internal-billing-v1', 'month', to_char(p_month, 'YYYY-MM'),
    'payment_timezone', 'UTC', 'generated_at', now(), 'currency', 'USD',
    'charges', v_charges, 'payments', v_payments, 'allocations', v_allocations
  );
end;
$$;
revoke all on function public.billing_export_snapshot(date)
  from public, anon, authenticated;
grant execute on function public.billing_export_snapshot(date) to authenticated;
