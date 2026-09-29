# Architecture and data boundaries

## Confirmed requirements
- Existing static website on Netlify; main source repository is Greathouse66/new-vision-athletics.
- Coach works on a phone. Navigation: Today, Makeups, Families, Payments.
- Families can have multiple athletes across skill groups and multiple authorized guardians.
- Tuition is a fixed monthly price, usually prepaid. Scheduling and tuition are separate.
- Standing rosters are generated from group enrollment.
- Parents cancel a dated session; Emery is notified and reviews makeup eligibility.
- Financial records must be exportable for the external bookkeeper.

## Decisions still open
Auth email delivery, server runtime, timezone, actual class capacity,
notification channel, holiday rules, tuition amounts and full cancellation policy.
Do not infer the venue timezone from the developer's device.

Supabase Postgres/Auth is the proposed data/identity provider for the M2
foundation. SQL is drafted but not deployed; see `data-access-foundation.md`.

## Data model to implement
Identity users and roles; families; guardian-family grants; athletes; skill groups;
locations; recurring schedules; dated class occurrences; effective-dated enrollments;
bookings; attendance; cancellations; makeup credits; makeup reservations;
monthly invoices and lines; payments and allocations; refunds; audit events;
notification outbox/delivery attempts; bookkeeping export runs.

Use stable IDs. A parent account's family scope is resolved from verified identity,
not a family ID supplied by the browser. Unauthenticated public pages expose no family data.

## Access
Coach: manage authorized organization records.
Guardian: read own family's schedules and financial records, cancel eligible bookings,
reserve approved makeups; cannot edit roles, group assignments, tuition or credit awards.
Future bookkeeper role: financial read/export only; exclude unnecessary child details.
Every endpoint checks authorization. Client-side visibility is not an access control.

## Schedule and credit integrity
Create distinct dated class occurrences; retain historical enrollments/attendance.
Cancellation affects one booking, not recurring enrollment.
One reviewed cancellation can issue at most one applicable credit.
Reserve capacity and credit together in a database transaction. Reject duplicate standing
bookings and exhausted credits. Redeem a reservation only through the defined attendance
outcome. Record cancellation, restoration and waiver decisions with actor and reason.
Store timestamps consistently and compute local class times using the venue's IANA zone.

## Financial integrity
Store money in integer minor units with currency. Separate invoices, payment receipts,
allocations, refunds, fees and bank transfers. Invoice status follows allocations rather
than a freely editable paid flag. Use stable transaction IDs and audited corrections.
A makeup credit is not automatically a cash refund or a new invoice.

## Notifications
Commit the cancellation and its outbox event atomically. Deliver asynchronously with
deduplication, retries and failure visibility. Parents receive confirmation of recorded
cancellation even if email delivery is delayed. Reminder links identify a booking but
still require authorized access. Do not send child or financial details in URL parameters.

## Netlify deployment boundary
The current site has root-level public files. Adding directories does not make backend
code executable or private. Before implementation, define a public-only publish output
and a separate server runtime/function directory. Never place secrets, imports, exports,
database files or live records in the static publish tree. Git ignore rules do not prevent
static publishing. No deploy configuration is changed in this skeleton milestone.
