# Family, athlete and group foundation

This is a proposed Supabase Postgres schema and access policy. It does not create
a Supabase project, send invitations, connect Netlify to a database or publish
family records. Apply the numbered SQL files in order through a reviewed database
migration as the database owner, first in a separate development project:

1. `supabase/migrations/20260929151300_family_group_foundation.sql`
2. `supabase/migrations/20260929151400_family_group_access.sql`

Do not run these files against production before the access tests below pass.
The `private` schema must not be exposed by the Supabase Data API. The security
definer functions must remain owned by the migration role (`postgres` in a hosted
Supabase project), with a fixed empty search path.

## Records

| Table | Meaning |
| --- | --- |
| `auth.users` | Supabase verified sign-in identities; never created by a browser insert into an application table |
| `coach_users` | Accounts authorized as coaches; provision or revoke administratively |
| `families` | Household record, with no billing or contact fields yet |
| `family_guardians` | An authorized account's membership in a family; multiple guardians per family are supported |
| `athletes` | Child linked to exactly one family for this first version |
| `skill_groups` | Coach-managed skill levels, named after Emery confirms his actual groups |
| `group_enrollments` | Dated athlete-to-group assignments; end date is exclusive |

An invitation is not a guardian grant. Confirm the intended recipient and their
authority before a coach links the verified identity to the family. Never infer
membership from a shared surname or an email typed into a public form. Changing
an athlete's level should close the old enrollment and create a new one; overlap
prevention, transfer transactions and audit events are required before live use.

## Access matrix

| Record | Signed out | Guardian | Coach |
| --- | --- | --- | --- |
| Families and athletes | None | Read linked family only | Read/create/update |
| Guardian memberships | None | Read own links only | Read/create/update/revoke |
| Skill groups | None | Read groups with a linked athlete enrollment | Read/create/update |
| Group enrollments | None | Read linked athletes' rows | Read/create/update |
| Coach role assignments | None | Read own role only, if any | Read roles; changes require administration |

No parent-facing writes are enabled yet. Session cancellation and makeup actions
will receive separate, narrowly scoped policies and server checks later. Public
registration may accept submissions through a validated server endpoint, but
it must not give anonymous clients direct table access. A direct payment link
does not expose invoices or private family records.

## Verification before connecting a portal

Run these cases against a disposable database with two unrelated families and
verified test identities. Keep fixtures and credentials outside the repository.

- Signed-out/`anon`: no read or write access to any foundation table.
- Guardian A: sees their family, athletes, enrollments, applicable groups and
  their own membership; sees no rows from family B or B's guardians.
- Guardian A: cannot insert, update or delete family, athlete, group, enrollment,
  membership or coach-role records, including by changing a `family_id` in a request.
- Guardian B: has the symmetric access restrictions.
- A second authorized guardian sees the same family's children but not the
  first guardian's membership row or another family's records.
- Coach: can manage families, memberships, athletes, groups and enrollments;
  cannot self-create a coach role through the client API.
- Revoking a guardian link immediately removes that family's visibility;
  removing a coach role immediately removes coach access.
- Confirm `private` functions cannot be called as public API routes and that
  no server secret appears in `dist/`.

Never put a Supabase secret/service key into browser code or Netlify's static
publish directory. The browser may eventually use a publishable key with RLS.
Real contact fields, schedules, billing, audit events and cancellation tokens
require their own reviewed migrations and policies.
