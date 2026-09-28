# Repository structure

Status: skeleton only. Existing root website files and Assets retain their exact names.
Directories exist through .gitkeep; the following HTML/JS/CSS files are a planned implementation map, not working routes.

| Area | Planned files / modules |
| --- | --- |
| coach | index.html (Today), groups.html, families.html, makeups.html, payments.html |
| parent | index.html (sessions), makeups.html, payments.html |
| auth | sign-in.html, callback.html |
| styles | portal.css, coach.css, parent.css |
| scripts | api.js, auth.js |
| scripts/coach | attendance.js, groups.js, families.js, makeups.js, payments.js |
| scripts/parent | sessions.js, makeups.js, payments.js |
| backend/auth | Identity verification, role checks, guardian invitations |
| backend/families | Family/athlete records, guardian relationships, import review |
| backend/scheduling | Standing schedules, dated classes, enrollment, capacity |
| backend/attendance | Presence, absence and audited corrections |
| backend/cancellations | Timestamped cancellation and review decisions |
| backend/makeups | Credit issue, reservation, redemption and restoration |
| backend/billing | Monthly invoices, payment allocations, refunds and receipts |
| backend/notifications | Invitation/reminder/cancellation delivery and retries |
| backend/bookkeeping | Authorized finance exports and later integrations |
| database/migrations | Versioned database schema, when provider is selected |
| database/access-policies | Server/database authorization rules |
| tests/access | Cross-family isolation, roles, invitation/token handling |
| tests/scheduling | Occurrences, holidays, daylight saving and capacity |
| tests/makeups | Duplicate prevention, reservations and cancellations |
| tests/billing | Payment allocation, refunds and export totals |

Backend directories describe responsibilities. They are not Netlify Functions automatically. Choose the backend runtime and publish boundary before adding executable server code. No netlify.toml or redirects are changed in this milestone.
