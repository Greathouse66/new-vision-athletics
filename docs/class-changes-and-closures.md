# Class changes and closures

Coach Dashboard → Class places & changes → choose the **original roster week** → Change / close class.

Reschedule a future dated class (local date/time, duration, venue), or cancel/close it with a reason shared with parents. Review lists confirmed athletes and pending drop-in requests, the verified-parent email count, and athletes requiring direct contact. Confirm saves the change and queues notifications in one transaction. Conflicting edits, changed rosters/contacts, started classes, DST gaps/folds and overlapping class times are rejected.

Rescheduling retains occurrence and seat IDs, capacity, regular assignments and pending requests. class_date deliberately stays the original roster date so it cannot be regenerated accidentally. Actual starts_at/ends_at and venue determine the new time; Today follows the actual venue-local date. Manage the class from its original week in Class places.

Closing releases active seats (retaining cancellation history) and declines pending requests, without generating parent-cancellation records, makeup credits or refunds. Closed dates cannot be booked or regenerated. New regular assignments skip closed dates; future weekly terms remain. Reopening is intentionally not included.

Parents see a family-scoped Class changes & closures list on Upcoming sessions. Notifications go once per verified parent email, combining affected siblings in that parent's accounts. Pending requests are labelled explicitly. Families without guardian access/verified emails require direct contact; billing contact addresses and unaccepted invitations are not authorization to receive private session details.

## Database and worker deployment

1. Switch to class-changes-and-closures, pull, run npx.cmd supabase db push --dry-run.
2. Expected new migration: 20261020210000_class_changes_and_closures.sql. Earlier pending migrations must be reviewed separately.
3. Apply with npx.cmd supabase db push only after reviewing that output.
4. Deploy the updated existing worker:
   npx.cmd supabase functions deploy drop-in-notification-worker --use-api
   No new sender, DNS, secrets or scheduler are required; existing settings and schedule are reused.

Migration installation changes no class and queues no email. Preview writes and emails use the real database. Deploy the worker before testing a real save. Do not merge until review is complete.

## Delivery and security

Private change-event and affected-athlete snapshots retain history. A review token covers the current occurrence, active seats, pending requests and parent contacts; saving takes the shared schedule lock and occurrence row lock. All browser writes use checked coach RPCs. Browser roles cannot read private event/queue tables or claim/settle messages. Parent history rechecks current athlete and guardian access.

The queue uses the existing leasing, retry and provider idempotency protocol. A current guardian grant, verified unchanged email and latest event revision are rechecked before sending. Superseded, revoked or changed recipients are skipped. Transient failures retry inside 20 hours; uncertain old attempts go to review. Payload bytes remain frozen for retries. An in-flight provider request can complete after a subsequent change, so an already sent email cannot be recalled; parents should check the portal for the latest details. Previously frozen approval emails are skipped if their saved class time/venue no longer matches.

Open the class again and refresh delivery status: pending/sending/retry are not delivery confirmation; sent means accepted by the provider, while review/skipped may require follow-up. No actual parent messages are sent by automated tests.
