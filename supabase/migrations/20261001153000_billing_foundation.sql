-- Empty per-athlete billing ledger. The coach will enter each athlete's
-- monthly charge; no prices, due dates or customer records are inserted here.
-- No browser role can create or change financial records yet.

create table public.athlete_monthly_charges (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null,
  family_id uuid not null references public.families(id),
  service_month date not null check (extract(day from service_month) = 1),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor_units bigint not null check (amount_minor_units >= 0),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null default now(),
  unique (athlete_id, service_month),
  unique (id, family_id, currency),
  foreign key (athlete_id, family_id) references public.athletes(id, family_id)
);
create index athlete_monthly_charges_family_month_idx
  on public.athlete_monthly_charges(family_id, service_month desc);

-- A coach confirms a Venmo payment once, even when it covers siblings.
-- Moving money from Venmo to a bank account is not another customer payment.
create table public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor_units bigint not null check (amount_minor_units > 0),
  received_at timestamptz not null,
  method text not null default 'venmo' check (method = 'venmo'),
  provider_reference text check (
    provider_reference is null or length(btrim(provider_reference)) between 1 and 160
  ),
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  unique (id, family_id, currency)
);
create index payment_receipts_family_received_idx
  on public.payment_receipts(family_id, received_at desc);

-- Composite foreign keys prevent applying another family's payment or a
-- different currency to an athlete's monthly charge.
create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null,
  currency text not null,
  charge_id uuid not null,
  payment_id uuid not null,
  amount_minor_units bigint not null check (amount_minor_units > 0),
  created_at timestamptz not null default now(),
  unique (payment_id, charge_id),
  foreign key (charge_id, family_id, currency)
    references public.athlete_monthly_charges(id, family_id, currency),
  foreign key (payment_id, family_id, currency)
    references public.payment_receipts(id, family_id, currency)
);
create index payment_allocations_charge_id_idx on public.payment_allocations(charge_id);

alter table public.athlete_monthly_charges enable row level security;
alter table public.payment_receipts enable row level security;
alter table public.payment_allocations enable row level security;

-- This first slice is coach-readable only. Payment confirmation, allocation,
-- parent reads, receipts and exports need reviewed transactional workflows.
revoke all on public.athlete_monthly_charges, public.payment_receipts,
  public.payment_allocations from public, anon, authenticated;
grant select on public.athlete_monthly_charges, public.payment_receipts,
  public.payment_allocations to authenticated;

create policy athlete_monthly_charges_coach_read on public.athlete_monthly_charges
  for select to authenticated using ((select private.is_coach()));
create policy payment_receipts_coach_read on public.payment_receipts
  for select to authenticated using ((select private.is_coach()));
create policy payment_allocations_coach_read on public.payment_allocations
  for select to authenticated using ((select private.is_coach()));
