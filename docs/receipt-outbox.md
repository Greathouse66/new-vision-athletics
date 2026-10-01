# Payment receipt queue

`20261001162500_payment_receipt_outbox.sql` creates a private event row for each
new payment receipt. A database trigger writes it in the payment transaction:
either the payment, allocations and event all commit, or none do. Repeating
the same confirmation request returns the existing receipt without a second
event. There is no email sender yet.

The queue stores only `payment_id` and `queued_at`. It does not copy an email
address or expose financial records to browser roles. The migration refuses to
run if existing payment receipts need review; it must not silently send old
receipts to a newly configured email provider.

The delivery worker still needs a coach-reviewed billing contact email on
file, independently of whether a parent has ever signed in to the portal.
Before sending, it must verify that the contact is still authorized for that
account. A missing contact or revoked authorization requires coach review;
do not infer a recipient from an athlete's name. The worker will need a
delivery log, idempotent provider calls, retry/backoff, and monitoring. An
outbox row is evidence that a receipt needs delivery, not that it was sent.

After applying the migration, `private.payment_receipt_outbox` should have
zero rows while there are zero payment receipts. Existing public table grants
stay unchanged. Keep this schema out of Supabase exposed Data API schemas.
