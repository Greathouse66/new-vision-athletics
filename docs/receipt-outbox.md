# Payment receipt queue

`20261001162500_payment_receipt_outbox.sql` creates a private event row for each
new payment receipt. A database trigger writes it in the payment transaction:
either the payment, allocations and event all commit, or none do. Repeating
the same confirmation request returns the existing receipt without a second
event. There is no email sender yet.

The provider-neutral payment confirmation message is prepared in
`payment-receipt-message.md`. Its Parent Portal URL is a normal sign-in page,
not a login token. Preparing that message does not change queue or delivery
behavior.

The initial queue stores only `payment_id` and `queued_at`.
The billing contact migration adds a nullable approved contact ID captured
when the payment is confirmed. Neither migration copies an email address
into the queue or exposes financial records to browser roles. The initial
migration refuses to run if existing payment receipts need review; it must not silently send old
receipts to a newly configured email provider.

The prepared worker and delivery gate are described in
`receipt-delivery-worker.md`. They check the captured contact at claim and
send time, preserve a stable payload for retries, and use a provider
idempotency key. A missing or revoked contact requires coach review; do not
infer a recipient from an athlete's name or send an older receipt to a newly
entered contact. An outbox row is evidence that a receipt needs delivery,
not that it was sent. Live delivery still needs a verified sender, secret,
schedule and end-to-end test.

After applying the migration, `private.payment_receipt_outbox` should have
zero rows while there are zero payment receipts. Existing public table grants
stay unchanged. Keep this schema out of Supabase exposed Data API schemas.
