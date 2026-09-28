# New Vision Athletics

Public basketball-training website and planned mobile coach/parent portals.

## Current status

The public site is static HTML, CSS and JavaScript, hosted on the existing Netlify project. The portals are **structure only**: this change adds directories and planning documents, not authentication, APIs, a database, notifications or payment processing. No sample or real family records are included.

## Existing website

- `index.html`: public homepage.
- `Pay-Now.html`: existing Venmo payment page.
- `Assets/Images/`: existing media; filename capitalization is significant.
- `index.css`, `index.js`: existing styles and script.

## Planned application

| Directory | Responsibility |
| --- | --- |
| `coach/` | Phone-first class rosters, groups, families, makeups and billing |
| `parent/` | Family sessions, cancellations, makeups and receipts |
| `auth/` | Invitation and email-link sign-in screens |
| `styles/` | Shared portal styles and role-specific styles |
| `scripts/` | Browser-side API and interface code |
| `backend/` | Authorized business operations and integrations |
| `database/` | Schema migrations and access policies |
| `tests/` | Access, scheduling, makeup and billing checks |
| `docs/` | Roadmap, requirements, contracts and setup |

Empty implementation directories use `.gitkeep` so Git retains them. Planned files are listed in [the repository structure](docs/repository-structure.md); they are not implemented yet.

Start with [the roadmap](docs/project-roadmap.md), [architecture](docs/architecture.md), and [setup](docs/setup.md).

## Business model

Fixed monthly tuition, typically paid upfront; standing classes by skill level. Attendance, cancellation review and makeup credits are separate from monthly invoices. Do not assume a fixed eight-session cap or per-session billing. Emery must confirm treatment of holidays, extra occurrences and carryover before implementation.

## Development

Serve the existing site locally from the repository root:

```sh
python -m http.server 8000
```

Open http://localhost:8000. There is currently no package installation or build step. No automated application test suite exists yet.

Use feature branches and pull requests. Preserve the public website's file paths. Keep family imports, exports, credentials and payment records out of Git. This repository is public.
