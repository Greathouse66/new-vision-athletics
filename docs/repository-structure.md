# Repository structure

The existing public website remains at the repository root. Netlify runs the build
script and publishes only `dist/`. The coach and parent portal directories are
planned routes; they are not working pages yet. No real family data is stored in
the repository.

| Area | Status | Purpose |
| --- | --- | --- |
| `index.html`, `index.css`, `index.js`, `Pay-Now.html`, `Assets/` | Existing | Public website and assets; retain their exact filenames and capitalization |
| `package.json`, `package-lock.json` | Active | Website build command and local Supabase CLI dependency |
| `netlify.toml` | Active | Builds the site and publishes `dist/` |
| `scripts/build-site.mjs` | Active | Copies approved public files into `dist/` |
| `coach/` | Planned | Today’s roster, groups, families, makeups, and payments |
| `parent/` | Planned | Family sessions, makeups, and payment history |
| `auth/` | Planned | Parent sign-in and authentication callback pages |
| `styles/` | Planned | Shared mobile portal, coach, and parent styles |
| `scripts/api.js`, `scripts/auth.js` | Planned | Portal API calls and session handling |
| `scripts/coach/` | Planned | Attendance, groups, families, makeups, and payments |
| `scripts/parent/` | Planned | Sessions, makeups, and payments |
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
Netlify Functions. Parent sign-in, invitations, scheduling, cancellations,
notifications, and billing still need implementation. Future database changes
should go into new timestamped migration files rather than editing migrations
that have already been applied.