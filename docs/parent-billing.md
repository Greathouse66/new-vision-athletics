# Private parent tuition and payment history

The Parent Portal links to parent/payments.html only after a signed-in
guardian has an accepted family membership. The page shows an athlete's
monthly tuition, allocated amount, derived balance, and the account's
confirmed Venmo payments. It is read-only and does not collect money or
claim that an email receipt was sent.

The browser calls list_my_monthly_charges and list_my_payment_history.
These security-definer functions require a signed-in user and check the
current guardian link for each parent account. They return only the fields
needed on the page. Direct SELECT policies on the financial ledger tables
remain coach-only, so a parent cannot query internal coach IDs, request IDs,
or provider reference text. Revoking a guardian link removes access on the
next request. An approved receipt email without guardian membership cannot
read the Parent Portal.

The page shows at most 200 recent charges and 200 recent payments; it
labels the list when that limit is reached. Payment times are displayed in
UTC until the venue's business timezone is finalized. No session list,
cancellation, or makeup booking is inferred from skill group membership.
Those features need dated classes and confirmed schedules first.

Apply 20261001171500_parent_billing_summary.sql before deploying the page.
Test with two unrelated synthetic parent accounts: one guardian sees only
their account, a second guardian sees only theirs, a shared guardian sees
both, and revocation immediately hides the removed account. Signed-out
users must not execute the functions. Keep the fixtures out of Git.
