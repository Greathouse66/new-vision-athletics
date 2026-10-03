-- Queue a receipt event in the same transaction as the payment. Delivery,
-- recipient selection and retries will be added after billing contacts and
-- an email provider are configured.

-- Existing receipts would need a separate, reviewed backfill. Never silently
-- send old receipts if this migration is applied after real payments begin.
do $$
begin
  if exists (select 1 from public.payment_receipts) then
    raise exception 'Existing payment receipts require outbox backfill review';
  end if;
end;
$$;

create table private.payment_receipt_outbox (
  payment_id uuid primary key references public.payment_receipts(id) on delete restrict,
  queued_at timestamptz not null default now()
);

alter table private.payment_receipt_outbox enable row level security;
revoke all on private.payment_receipt_outbox from public, anon, authenticated;

create function private.enqueue_payment_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.payment_receipt_outbox (payment_id) values (new.id);
  return new;
end;
$$;
revoke all on function private.enqueue_payment_receipt() from public, anon, authenticated;

create trigger payment_receipt_queued
  after insert on public.payment_receipts
  for each row execute function private.enqueue_payment_receipt();
