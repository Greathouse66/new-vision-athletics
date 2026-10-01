# Coach Venmo confirmation

On the monthly tuition page, Emery chooses a month and a parent account,
then selects one or more unpaid charges for that account. The total is the
sum of their full outstanding balances; partial payments are not yet
supported. Emery checks Venmo outside the portal, enters the actual local
received date and time and optional reference, and confirms the athlete
amounts and current approved receipt email in a final review prompt.

The browser sends one request UUID to `confirm_venmo_payment`. The checked
database function locks the selected charges, verifies one account and the
exact total, writes one receipt plus allocations atomically, and queues a
private receipt event. A sibling payment is one receipt with multiple
allocations. On success the page reloads balances and says **queued**, not
emailed. Retrying the same details uses the same request ID during that page
session. If a result is unclear, refresh the ledger before retrying; never
create a second payment just because an email is delayed.

The database's new ready flag starts false, so this form stays hidden until
receipt delivery is configured and verified. It also requires a current
coach-approved billing contact; having a receipt address does not grant
Parent Portal access. A revoked address prevents a new payment confirmation.
Refunds, partial payments, paid-charge corrections, provider reconciliation
and receipt resend review remain separate workflows.
The page shows queued, retry, sent-to-provider, and needs-review states for
payments received in the selected UTC month. It does not claim inbox
delivery merely because the provider accepted an email.
