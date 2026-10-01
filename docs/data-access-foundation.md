# Family, athlete and group foundation

These versioned Supabase Postgres migrations define the data and access
foundation. They do not send invitations, publish family records, or create
real athlete data. The first two files were the initial foundation, followed
by dated migrations for invitations, athletes, groups, and scheduling:

1. `supabase/migrations/20260929151300_family_group_foundation.sql`
2. `supabase/migrations/20260929151400_family_group_access.sql`

Review new migrations and their access tests before live use.
The `private` schema must not be exposed by the Supabase Data API. The security
definer functions must remain owned by the migration role (`postgres` in a hosted
Supabase project), with a fixed empty search path.

## Records

| Table | Meaning |
| --- | --- |
| `auth.users` | Supabase verified sign-in identities; never created by a browser insert into an application table |
| `coach_users` | Accounts authorized as coaches; provision or revoke administratively |
| `families` | Parent account: one athlete for most accounts, siblings together for a few households; separate billing and contact tables link by account ID |
| `family_guardians` | An authorized account's membership in a family; multiple guardians per family are supported |
| `athletes` | Child linked to exactly one parent account for this first version; parents manage access |
| `skill_groups` | Coach-managed skill levels: Foundational, Post-Bigs, Advanced |
| `group_enrollments` | Dated athlete-to-group assignments; end date is exclusive |
| `record_name_corrections` | Coach-readable history of parent account and athlete name changes |
| `monthly_charge_corrections` | Coach-readable reasons and amounts for unpaid tuition corrections |

An invitation is not a guardian grant. Confirm the intended recipient and their
authority before a coach links the verified identity to the family. Never infer
membership from a shared surname or an email typed into a public form. A group
transfer closes the previous row and creates a new dated row in one transaction.
The exclusion constraint rejects overlaps. Import review and audit events are
still needed before adding real families.

## Access matrix

| Record | Signed out | Guardian | Coach |
| --- | --- | --- | --- |
| Families and athletes | None | Read linked family only | Read/create/update |
| Guardian memberships | None | Read own links only | Read/create/update/revoke |
| Skill groups | None | Read groups with a linked athlete enrollment | Read/create/update |
| Group enrollments | None | Read linked athletes' rows | Read; create/transfer through checked functions |
| Name corrections | None | None | Read; database triggers write events |
| Monthly tuition and payments | None | Read own account through limited summary functions | Read raw ledger; checked write functions |
| Tuition correction reasons | None | None | Read; correct unpaid charges through a checked function |
| Receipt contact emails | None | None | Read and change through checked functions |
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
- Coach: can manage families, memberships, athletes and groups; creates
  athletes with a group and changes group history through checked functions;
  cannot self-create a coach role through the client API.
- Revoking a guardian link immediately removes that family's visibility;
  removing a coach role immediately removes coach access.
- Confirm `private` functions cannot be called as public API routes and that
  no server secret appears in `dist/`.

Never put a Supabase secret/service key into browser code or Netlify's static
publish directory. The browser may eventually use a publishable key with RLS.
Attendance, parent session controls, paid-charge adjustments, receipt delivery
and cancellation tokens still require reviewed migrations and policies.
