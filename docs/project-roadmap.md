# Project roadmap

## M1 — Repository foundation (this change)
- [x] Inspect transferred repository and preserve existing website files.
- [x] Add portal, backend, database and test directory skeletons.
- [x] Document business rules, import/export contracts and delivery gates.
- [x] Exclude private operational data and secrets from Git.
- [ ] Review and merge foundation pull request.

## M2 — Confirm requirements and hosting boundaries
- [x] Confirm skill groups: Foundational, Post-Bigs, Advanced.
- [ ] Obtain schedules, location, capacity and confirm America/Chicago timezone.
- [x] Confirm tuition varies by athlete and the coach assigns the monthly amount.
- [x] Confirm parents pay via Venmo; Emery verifies payment and uses Mark paid
      in the coach roster. The action must also record the Venmo payment.
- [ ] Confirm due dates, discounts and partial-month handling.
- [ ] Approve cancellation/makeup rules and how families acknowledge them.
- [ ] Obtain bookkeeper's required format and software.
- [x] Select Supabase Postgres/Auth for the proposed data and identity foundation;
      transactional email service remains to be selected.
- [x] Select Supabase Edge Functions for private HTTP operations; keep Netlify
      restricted to the public `dist/` build.
- [x] Deploy and test the initial authenticated coach function (401 unsigned,
      403 signed-in non-coach, 200 temporary coach; role removed afterward).
- [ ] Configure email delivery secrets when a notification provider is chosen.
Acceptance: written decisions; no invented pricing, policy or credentials.

## M3 — Data and secure access
- [ ] Implement migrations, roles, guardian-family links and audit records.
- [x] Apply family/athlete/group migrations and guardian/coach read boundaries;
      initial family isolation and denied writes were checked manually.
- [x] Deploy and verify coach-approved guardian invitation, acceptance, and
      revocation with one test identity; delivery to real parents needs SMTP.
- [ ] Apply and verify coach name-correction audit events.
- [ ] Enforce family isolation server-side; coach role assigned administratively.
- [ ] Support revoking access and a second authorized guardian.
Acceptance: unauthorized and cross-family reads/writes fail at the API/database layer.

## M4 — Groups, enrollment and mobile attendance
- [ ] Review/import family records; resolve ambiguous matches.
- [x] Add an offline private CSV preflight for roster field and duplicate review;
      it does not write records or grant parent access.
- [x] Apply and verify the empty location, weekly slot, and dated class schema.
- [ ] Generate dated classes from standing schedules with holiday exceptions.
- [x] Implement one active group per athlete on any date and dated coach transfers.
- [ ] Define class enrollment after schedules and capacity are confirmed.
- [ ] Build Today roster with accessible Present/Absent controls and Undo.
Acceptance: past rosters remain accurate; extra calendar occurrences are not silently billed.

## M5 — Parent cancellation and coach notification
- [ ] Show family-only upcoming sessions.
- [ ] Confirm cancellation of one occurrence; timestamp server-side.
- [ ] Queue parent confirmation and coach notification.
- [ ] Show pending makeup review; no automatic fee while policy is unset.
Acceptance: repeated taps create one cancellation; failed email does not lose the cancellation.

## M6 — Makeup credits and booking
- [ ] Coach approves credits linked to original cancellations.
- [ ] Parents see only eligible skill-level slots with available capacity.
- [ ] Atomically reserve slot and credit, preventing duplicate use.
- [ ] Handle attendance redemption, coach cancellation and approved restoration.
Acceptance: simultaneous requests cannot overbook; existing standing bookings cannot be duplicated.

## M7 — Monthly billing and bookkeeping
- [x] Apply and verify the empty athlete monthly charge, receipt, and allocation schema.
- [ ] Apply and verify checked coach charge assignment and Venmo confirmation
      functions; database migration prepared, live test pending.
- [ ] Let the coach set each athlete's monthly tuition and generate dated charges.
- [ ] Add coach roster Mark paid action that records a verified Venmo payment,
      allocates it to athlete charges, and derives paid status.
- [ ] Queue a receipt email to the authorized guardian when payment is approved.
- [ ] Allocate payments; support corrections/refunds with an audit trail.
- [ ] Show receipts and balances to the correct family.
- [ ] Export financial records in the agreed bookkeeper format.
- [ ] Reconcile against payment-provider/bank statements without counting transfers twice.
Acceptance: paid tuition is not billed again for an approved makeup; export totals match records.

## M8 — Pilot and launch
- [ ] Confirm policy acknowledgment, recovery/backups and notification monitoring.
- [ ] Verify mobile layout, accessibility, authentication and access rules.
- [ ] Pilot with Emery and two or three consenting families.
- [ ] Resolve issues before importing all families and adding public portal links.
Acceptance: cancellations, notifications, attendance, makeups and billing work end-to-end.

## Later, after the pilot
SMS with opt-in; automated payment collection; bookkeeper read-only finance access;
accounting integration; automated report delivery to an explicitly authorized recipient.
No recurring sends or third-party data transfers are enabled by this foundation.
