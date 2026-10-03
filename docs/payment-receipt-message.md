# Payment confirmation email template

`supabase/functions/_shared/payment-receipt.mjs` is a pure message renderer. It
builds plain text and escaped HTML for one coach-confirmed Venmo payment,
including the received UTC date, total USD amount, payment ID and each
athlete/month allocation. A sibling payment appears as one payment with two
lines. It validates that every allocation belongs to the same account and
that allocated cents sum to the payment amount.

The message links to the ordinary HTTPS `/auth/sign-in.html` page without a
token or personal data in its URL. The parent must request a fresh magic link
and already have an accepted guardian invitation to view account records.
Receipt contact approval remains separate from portal access.

The private worker under `supabase/functions/receipt-worker` uses this message
once its sender credentials and schedule are configured. It must load the
payment and allocations from the database, verify the outbox-captured billing
contact still belongs to the account and is current, select a configured
email provider, then record delivery outcomes and retries. It must not use an
email supplied by a browser request. The inactive domain cannot yet supply
a production portal link or verified sender. Until the business timezone is
confirmed, the template labels its received date as UTC. The wording does
not claim tax receipt or invoice status.

Run `node --test tests/billing/payment-receipt.test.mjs` to check sibling
allocation totals, HTML escaping and rejection of token-bearing links. Review
the wording with Emery before enabling real sends.
