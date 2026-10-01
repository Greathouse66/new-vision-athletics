# Checked coach billing actions

`20261001162000_billing_actions.sql` adds two authenticated, coach-only database
functions. There is no payment UI or email sender in this slice. A parent never
needs to sign in to pay Emery through Venmo.

| Function | Action |
| --- | --- |
| `assign_monthly_charge(athlete_id, service_month, amount_minor_units, currency)` | Creates one charge for an athlete and month. Repeating the same values returns the same charge ID; a different amount needs a reviewed correction. |
| `confirm_venmo_payment(request_id, charge_ids, amount_minor_units, received_at, provider_reference)` | Records one verified Venmo payment and allocates all of it to the selected outstanding charges. Returns the receipt ID. |

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
**do not send email**. The operational coach screen must wait for a delivery
worker and verified billing contacts, plus a
confirmation step that shows the correct account, athlete, month, currency,
amount, and optional reference. Do not use these functions to record real
payments until that workflow is complete. Email to an authorized guardian on
file must not be assumed merely because a database receipt exists.

Apply the migration with `npx.cmd supabase db push --dry-run`, followed by
`npx.cmd supabase db push`. The old foundation migration is already applied;
do not edit it. A subsequent test should temporarily authorize a coach,
create test charges, confirm one test Venmo payment for a sibling account,
retry the exact request, reject duplicate payment and cross-account charge
sets, and remove all test data and the temporary role. No live records are
required to apply this schema change.
