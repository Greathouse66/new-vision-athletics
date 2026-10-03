-- Keep raw finance tables coach-only. Return only guardian-scoped fields
-- needed for the Parent Portal; hide coach IDs, internal request IDs and
-- Venmo reference text from the parent browser.
create function public.list_my_monthly_charges()
returns table (
  family_id uuid,
  athlete_id uuid,
  service_month date,
  currency text,
  amount_minor_units bigint,
  allocated_minor_units bigint
) language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  return query
    select c.family_id, c.athlete_id, c.service_month, c.currency,
           c.amount_minor_units,
           coalesce(sum(a.amount_minor_units), 0)::bigint
    from public.athlete_monthly_charges c
    left join public.payment_allocations a on a.charge_id = c.id
    where private.can_read_family(c.family_id)
    group by c.id, c.family_id, c.athlete_id, c.service_month,
             c.currency, c.amount_minor_units
    order by c.service_month desc, c.athlete_id;
end;
$$;

create function public.list_my_payment_history()
returns table (
  family_id uuid,
  payment_id uuid,
  currency text,
  amount_minor_units bigint,
  received_at timestamptz,
  method text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  return query
    select p.family_id, p.id, p.currency, p.amount_minor_units,
           p.received_at, p.method
    from public.payment_receipts p
    where private.can_read_family(p.family_id)
    order by p.received_at desc, p.id;
end;
$$;

revoke all on function public.list_my_monthly_charges(),
  public.list_my_payment_history() from public, anon, authenticated;
grant execute on function public.list_my_monthly_charges(),
  public.list_my_payment_history() to authenticated;
