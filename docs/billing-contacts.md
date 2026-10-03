# Parent account receipt contact

The coach approves one current receipt email for each parent account on the
existing coach/families.html page. Most accounts represent one athlete;
siblings can share an account. The address is lowercased and recorded with
the approving coach and time. Replacing or removing it retains the previous
record and the coach who revoked it. No browser role can write the contact
table directly; coach-only functions serialize account changes.

This address is separate from a guardian's Parent Portal membership. It can
receive a receipt even if the parent has never signed in. Approving an email
for receipts does **not** invite it to the portal. Parent Portal access still
requires the reviewed guardian invitation, sign-in with that email, and
acceptance. The recipient for a future receipt can be the same email, but the
two permissions remain separate.

The receipt queue captures the contact ID that was current when a Venmo
payment was confirmed. A later email worker must check that this contact
still belongs to the same account and has not been revoked before sending.
If no contact was approved at payment time, the event needs coach review;
do not send an old receipt automatically to a newly approved email.
Selecting a contact does not verify mailbox ownership or send anything.

Future receipt emails may include a standard link to the Parent Portal
sign-in page. That link is navigation, not a reusable sign-in token. A
parent can request a fresh magic link and, after authentication, see only
accounts for which guardian access was accepted. Upcoming sessions and
cancellations will use the account's dated schedule records once those
features are built. A receipt alone never unlocks session management.

Apply 20261001170000_family_billing_contacts.sql after the receipt outbox
migration. The new table and functions start empty. The coach page needs
this migration before its receipt contact section can load. The email
sender, delivery history, verified contact process, and Parent Portal
sessions are still pending.
