# Repository structure

The existing public website remains at the repository root. Netlify runs the build
script and publishes only `dist/`. Coach workspace, parent access, athlete roster and skill group screens, plus parent sign-in
and family summary are implemented. No real family data is stored in
the repository.

| Area | Status | Purpose |
| --- | --- | --- |
| `index.html`, `index.css`, `index.js`, `Pay-Now.html`, `Assets/` | Existing | Public website and assets; retain their exact filenames and capitalization |
| `package.json`, `package-lock.json` | Active | Website build command, Supabase browser client, bundler, and local CLI |
| `netlify.toml` | Active | Builds the site and publishes `dist/` |
| `scripts/build-site.mjs` | Active | Copies approved public files and bundles portal browser scripts into `dist/` |
| `scripts/validate-roster.mjs` | Active | Offline preflight for private roster CSVs in Git-ignored `imports/`; no database writes |
| `coach/` | Partial | Coach workspace, athlete and parent account records, guardian access, receipt contacts, skill groups, and monthly tuition view; attendance and payment confirmation later |
| `parent/` | Partial | Private family, athlete, and read-only tuition summary; sessions and makeups later |
| `auth/` | Active | Guardian email link sign-in and callback pages |
| `styles/` | Partial | Shared mobile portal styling |
| `scripts/api.js`, `scripts/auth.js` | Planned | Portal API calls and session handling |
| `scripts/coach/` | Partial | Coach workspace, athlete roster, guardian access, group list, and tuition UI; attendance, makeups, and payment confirmation later |
| `scripts/parent/` | Partial | Guardian-scoped family and tuition summaries; sessions and makeups later |
| `backend/auth/` | Planned | Identity verification, roles, and guardian invitations |
| `backend/families/` | Planned | Family and athlete management and reviewed imports |
| `backend/scheduling/` | Planned | Standing schedules, dated classes, enrollment, and capacity |
| `backend/attendance/` | Planned | Attendance and audited corrections |
| `backend/cancellations/` | Planned | Dated cancellations and coach review |
| `backend/makeups/` | Planned | Credits, reservations, redemption, and restoration |
| `backend/billing/` | Planned | Monthly invoices, payments, refunds, and receipts |
| `backend/notifications/` | Planned | Invitations, reminders, and cancellation notices |
| `backend/bookkeeping/` | Planned | Authorized financial exports |
| `supabase/config.toml` | Active | Supabase CLI project configuration |
| `supabase/migrations/` | Active | Versioned access, roster, scheduling, audit, per-athlete billing, private receipt events, and approved receipt contacts |
| `supabase/functions/coach-gateway/` | Active | Deployed signed-in coach access check for the private HTTP runtime |
| `tests/` | Planned | Automated access, scheduling, makeup, and billing tests |
| `docs/` | Active | Roadmap, requirements, setup, and data-access guidance |

The family, guardian, athlete, and group migrations through
`20260930230000_athlete_group_assignments.sql` have been applied to the linked
project. The empty scheduling schema is also applied; name-correction auditing
is pending. Row-level security was checked with temporary SQL transactions for
family isolation and blocked guardian writes. An invitation, acceptance, and revocation were also
tested in the hosted preview with temporary records, then cleaned up. Those
manual checks are not yet an automated test suite. A temporary athlete's group
transfer and history were also verified in the hosted preview and cleaned up.

Backend directories describe responsibilities; they are not executable
Netlify Functions. Email delivery, Auth account creation, scheduling,
cancellations, notifications, payment confirmation UI, and bookkeeping export still need implementation. See
`backend-runtime.md`, `parent-sign-in.md` and `guardian-access.md`. Future database changes
should go into new timestamped migration files rather than editing migrations
that have already been applied.
