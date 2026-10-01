# Empty per-athlete billing foundation

`20261001153000_billing_foundation.sql` adds three empty tables. It does not
set a price, send an email, create a charge or payment, or give parents financial
access. The class schedule does not determine tuition.

| Table | Purpose |
| --- | --- |
| `athlete_monthly_charges` | A coach-entered tuition amount for one athlete and month, with the coach's identity |
| `payment_receipts` | An actual payment, method, received date and coach confirmation |
| `payment_allocations` | A portion of a payment applied to an athlete's monthly charge |

There is one charge per athlete per month. The coach will enter each month's
amount; this schema does not carry a price forward or assume equal tuition.
Parents pay through Venmo outside the Parent Portal. Emery checks Venmo, then
uses **Mark paid** on the coach roster. The confirmation should show the athlete,
month and amount, with the actual received date and optional Venmo reference.
One action records a confirmed Venmo payment and its allocation, making the
athlete's status paid. The coach can see unpaid and paid athletes at a glance.
If one Venmo payment covers siblings, record it once and allocate it across
both athlete charges so the export does not double-count it. The private Parent
Portal can later display balances and receipts; it is not needed to pay Venmo.

`20261001162000_billing_actions.sql` adds coach-only functions to assign a
monthly charge and confirm one full Venmo payment against one or more charges.
The latter records its amount, received date, actor and allocations in one
transaction. A later change must enqueue the receipt notification in the same
transaction. An email worker then sends to an authorized
guardian email on file, retrying failures without losing the payment. The
database ledger is the source of truth; a coach-authorized spreadsheet export
is generated from it on demand. Do not maintain a separate editable spreadsheet
copy. The export should show one athlete per month plus a distinct payments
sheet so a payment covering siblings is counted only once.

The foundation migration enforces valid month starts, account/athlete linkage, positive
payment and allocation amounts, and matching account/currency via composite
foreign keys. It accepts Venmo as the payment method. Direct privileged SQL
writes still lack allocation-total enforcement and correction audits. The
checked functions enforce full outstanding balances and idempotent confirmation
for authenticated coach calls. Refund rules, verified email delivery and
parent-specific reads are still pending. A makeup credit is not a payment or
cash refund.

All three tables have RLS and coach-only select access. Browser roles cannot
insert, update, or delete. Do not enter real payments through the SQL Editor
or use the function for live confirmations before receipt delivery and the
coach confirmation UI are ready. Confirm currency, partial-payment handling,
refunds, due dates, and bookkeeper columns before enabling the working coach UI.

After `supabase db push --dry-run` and `supabase db push`, verify that the
three tables exist and are empty, RLS is enabled, `authenticated` has select
but no write privileges, and `anon` has no grants. The development workspace
could not run the migration against the linked project.
