# Checked coach billing actions

`20261001162000_billing_actions.sql` adds two authenticated, coach-only database
functions. A parent never needs to sign in to pay Emery through Venmo. The
later receipt delivery migration adds a disabled-by-default readiness gate,
coach review form and prepared worker; see `receipt-delivery-worker.md`.

| Function | Action |
| --- | --- |
| `assign_monthly_charge(athlete_id, service_month, amount_minor_units, currency)` | Creates one charge for an athlete and month. Repeating the same values returns the same charge ID; a different amount needs a reviewed correction. |
| `confirm_venmo_payment(request_id, charge_ids, amount_minor_units, received_at, provider_reference)` | Records one verified Venmo payment and allocates all of it to the selected outstanding charges. Returns the receipt ID. |

After `20261001164000_usd_only_billing.sql`, the database accepts USD charges,
receipts and allocations only. The coach UI supplies USD automatically; its
currency input has been removed. The currency parameter stays in the checked
function and ledger for explicit bookkeeping and account consistency.

The browser supplies a fresh UUID as `request_id` for one coach confirmation,
then keeps that UUID unchanged during network retries. Repeating the same
request returns the existing receipt. Reusing it for different details fails.
Charge IDs must be unique, belong to one account and currency, and have a
positive outstanding balance. The confirmed amount must equal their combined
outstanding balances. This supports one payment for siblings without counting
it twice. `received_at` is the actual Venmo received timestamp, no later than
the present time. The reference is optional and limited to 160 characters.
This action does not support partial payments, correction, refund, or a
zero-dollar receipt.

Charge rows are locked during confirmation. Simultaneous confirmations for the
same athlete cannot both allocate the charge. The database writes the receipt
and its allocations in the same transaction or writes neither. Browser roles
still have no direct insert, update, or delete privileges on the ledger tables.
The paid state is calculated by comparing the charge to its allocations; no
independent paid switch is stored.

After `20261001162500_payment_receipt_outbox.sql`, a trigger queues a private
receipt event in the same transaction as each new payment. The functions
**do not send email**. The coach form shows the account, athletes, amount,
received time, optional reference and approved contact before committing.
The prepared worker handles delivery later. The readiness gate stays false
until its sender, schedule and actual mailbox receipt are verified. An outbox
row does not prove that an email reached a mailbox.

Apply the migration with `npx.cmd supabase db push --dry-run`, followed by
`npx.cmd supabase db push`. The old foundation migration is already applied;
do not edit it. A subsequent test should temporarily authorize a coach,
create test charges, confirm one test Venmo payment for a sibling account,
retry the exact request, reject duplicate payment and cross-account charge
sets, and remove all test data and the temporary role. No live records are
required to apply this schema change.
