-- Tuition and Venmo payments are USD-only. Keep the currency columns for
-- explicit bookkeeping and composite-family/currency integrity checks.
-- These constraints validate existing rows and fail if a non-USD record needs
-- manual review; do not silently rewrite financial history.
alter table public.athlete_monthly_charges
  add constraint athlete_monthly_charges_usd_only check (currency = 'USD');
alter table public.payment_receipts
  add constraint payment_receipts_usd_only check (currency = 'USD');
alter table public.payment_allocations
  add constraint payment_allocations_usd_only check (currency = 'USD');
