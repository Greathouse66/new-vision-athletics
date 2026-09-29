# Repository structure

The existing public website remains at the repository root. Netlify runs the build
script and publishes only `dist/`. The coach portal is planned. Parent sign-in
and a family summary are implemented. No real family data is stored in
the repository.

| Area | Status | Purpose |
| --- | --- | --- |
| `index.html`, `index.css`, `index.js`, `Pay-Now.html`, `Assets/` | Existing | Public website and assets; retain their exact filenames and capitalization |
| `package.json`, `package-lock.json` | Active | Website build command, Supabase browser client, bundler, and local CLI |
| `netlify.toml` | Active | Builds the site and publishes `dist/` |
| `scripts/build-site.mjs` | Active | Copies approved public files and bundles parent browser scripts into `dist/` |
| `coach/` | Planned | Today’s roster, groups, families, makeups, and payments |
| `parent/` | Partial | Private family and athlete summary; sessions, makeups, and payments later |
| `auth/` | Active | Guardian email link sign-in and callback pages |
| `styles/` | Partial | Shared mobile portal styling |
| `scripts/api.js`, `scripts/auth.js` | Planned | Portal API calls and session handling |
| `scripts/coach/` | Planned | Attendance, groups, families, makeups, and payments |
| `scripts/parent/` | Partial | RLS-scoped family summary; sessions, makeups, and payments later |
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
| `supabase/migrations/` | Active | Versioned family, athlete, guardian, group, and access-policy SQL |
| `tests/` | Planned | Automated access, scheduling, makeup, and billing tests |
| `docs/` | Active | Roadmap, requirements, setup, and data-access guidance |

The first two Supabase migrations have been applied to the linked project.
Row-level security was checked with temporary SQL transactions for family
isolation and blocked guardian writes. Those manual checks are not yet an
automated test suite.

Backend directories describe responsibilities; they are not executable
Netlify Functions. Email delivery, guardian provisioning, scheduling,
cancellations, notifications, and billing still need implementation. See
`parent-sign-in.md`. Future database changes
should go into new timestamped migration files rather than editing migrations
that have already been applied.
