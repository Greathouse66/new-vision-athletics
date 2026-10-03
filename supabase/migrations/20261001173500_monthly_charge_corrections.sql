-- Correct a coach-entered monthly amount before any payment is allocated.
-- Keep the charge ID stable for account history and record each correction.
create table public.monthly_charge_corrections (
  id bigint generated always as identity primary key,
  charge_id uuid not null references public.athlete_monthly_charges(id) on delete restrict,
  athlete_id uuid not null,
  family_id uuid not null,
  service_month date not null,
  old_amount_minor_units bigint not null check (old_amount_minor_units >= 0),
  new_amount_minor_units bigint not null check (new_amount_minor_units >= 0),
  reason text not null check (length(reason) between 10 and 500),
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  check (old_amount_minor_units <> new_amount_minor_units)
);
create index monthly_charge_corrections_month_idx
  on public.monthly_charge_corrections(service_month, changed_at desc, id desc);

alter table public.monthly_charge_corrections enable row level security;
revoke all on public.monthly_charge_corrections from public, anon, authenticated;
grant select on public.monthly_charge_corrections to authenticated;
create policy monthly_charge_corrections_coach_read
  on public.monthly_charge_corrections for select to authenticated
  using ((select private.is_coach()));

create function public.correct_monthly_charge(
  p_charge_id uuid, p_amount_minor_units bigint, p_reason text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_charge public.athlete_monthly_charges%rowtype;
  v_reason text := pg_catalog.btrim(p_reason);
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_charge_id is null or p_amount_minor_units is null
     or p_amount_minor_units < 0 or v_reason is null
     or pg_catalog.length(v_reason) not between 10 and 500 then
    raise exception 'Charge, nonnegative USD amount and correction reason required'
      using errcode = '22023';
  end if;

  -- Payment confirmation locks this same charge row before allocating it.
  select * into v_charge from public.athlete_monthly_charges
    where id = p_charge_id for update;
  if not found then
    raise exception 'Charge not found' using errcode = '22023';
  end if;
  if v_charge.currency <> 'USD' then
    raise exception 'Unexpected billing currency' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_allocations where charge_id = p_charge_id) then
    raise exception 'A payment is already applied; use a reviewed adjustment workflow'
      using errcode = '22023';
  end if;
  if v_charge.amount_minor_units = p_amount_minor_units then
    raise exception 'New amount must differ from the current amount' using errcode = '22023';
  end if;

  update public.athlete_monthly_charges set amount_minor_units = p_amount_minor_units
    where id = p_charge_id;
  insert into public.monthly_charge_corrections
    (charge_id, athlete_id, family_id, service_month, old_amount_minor_units,
     new_amount_minor_units, reason, changed_by)
  values (p_charge_id, v_charge.athlete_id, v_charge.family_id,
          v_charge.service_month, v_charge.amount_minor_units,
          p_amount_minor_units, v_reason, auth.uid());
  return p_charge_id;
end;
$$;

revoke all on function public.correct_monthly_charge(uuid, bigint, text)
  from public, anon, authenticated;
grant execute on function public.correct_monthly_charge(uuid, bigint, text)
  to authenticated;
