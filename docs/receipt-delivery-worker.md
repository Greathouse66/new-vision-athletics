# Receipt worker and live payment gate

`20261001183000_receipt_delivery_gate.sql` starts with delivery **disabled**.
It moves the original checked Venmo function to the private schema and puts
a public coach-only wrapper in front of it. New payment confirmations require
the owner-controlled ready flag and a current coach-approved billing contact
for the account. Identical retries of an already recorded request still work.
The coach page shows the payment form only when that flag is enabled; the
database enforces the same rule even for direct RPC calls. No payment or email
is created by applying this migration.

The private outbox gains delivery status, attempts, a five-minute lease,
the first-attempt time, a stable payload, provider message ID, and a safe
failure code. A service-role-only claim RPC checks the contact captured at
payment time, the account, current approval, and allocation totals. Missing
or changed contacts go to `review`, with no automatic reassignment to a new
email. The receipt worker checks the contact again just before its API call.
The renderer handles sibling allocations as one payment email. A provider
response marks the event `sent`; temporary failures retry with backoff.
Uncertain attempts older than 20 hours require manual review, since Resend's
idempotency protection expires after 24 hours. An outbox row or `retry`
status is **not** evidence of delivery. The provider may accept a message
while a network response is lost; a sent status means its API returned an ID,
not that the recipient opened it.
The monthly coach billing page lists each payment's queue status. `review`
requires a person to inspect the contact and provider outcome; the page does
not offer an automatic resend button.

## Safe setup order

1. Apply the migration and verify the ready flag is false. Build the coach
   page; it should explain that payment recording is paused. Do not set
   real tuition or confirm a real Venmo payment just to test it.
   Run the rollback-only `tests/billing/receipt-delivery-gate.sql` in SQL Editor
   to verify the disabled gate, approved contact, queued receipt and exact retry
   without an external email.
2. Renew or replace the public domain and select a verified sender domain.
   Set `RESEND_API_KEY`, `NVA_RECEIPT_FROM` and `NVA_PUBLIC_ORIGIN` as
   **Supabase Edge Function secrets**, not as Netlify build variables or Git
   files. The public origin must be a clean HTTPS origin. Set Supabase Auth's
   custom SMTP separately so parents can receive magic links.
   Resend's development sender can be used only for limited own-address
   tests before a domain is verified; it is not a production parent sender.
3. Deploy `receipt-worker` with `npx.cmd supabase functions deploy receipt-worker --use-api`.
   Its `verify_jwt = false` setting is required for secret-key calls; the
   `withSupabase({ auth: 'secret' })` wrapper still rejects unsigned requests.
   Never call it from browser code or embed the Supabase secret key in `dist/`.
4. Schedule a five-minute secret-key invocation using Supabase Vault,
   `pg_cron`, and `pg_net` after the sender is configured. Keep that secret
   out of SQL query history, source files and browser code. Monitor the job
   and `private.payment_receipt_outbox` for `review` and `retry` rows.
5. With a synthetic coach-approved account and your own verified mailbox,
   temporarily enable delivery as database owner, confirm one test Venmo
   payment, run the worker, verify the actual email and `sent` provider ID,
   then clean up only that synthetic data. Repeat a worker call and ensure
   there is no duplicate email. Revoke/replace the test contact and verify
   a queued event goes to review. Do not roll back a transaction that sends
   an external email and assume the email was rolled back.
6. Only after the verified sender, schedule, mailbox test and monitoring
   work, enable live payment confirmation with an owner-run SQL change to
   `private.billing_delivery_settings`. The ready flag can be set false to
   pause new confirmations and worker claims without deleting ledger rows.

This setup has not been completed while the domain is inactive. The worker
is prepared for Resend's HTTP API; no provider account, keys, scheduled job,
or real email is created by this code. Automatic retries cannot guarantee
exactly-once email delivery after the provider's idempotency window. Keep
older uncertain events for human review instead of automatically resending.
