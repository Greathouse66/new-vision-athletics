# Reviewed guardian access

This slice prepares a guardian invitation for an existing family. It adds a
coach-only family access screen, an email-bound invitation record, an explicit
acceptance step on the parent portal, a coach revocation action, and an audit
record for membership changes. It does **not** send email or create an Auth user.

## Deploy order

1. Review and apply `supabase/migrations/20260929213200_guardian_invitations.sql`
   after the two existing migrations. Run `npx.cmd supabase db push --dry-run`
   before `npx.cmd supabase db push` on Windows. The migration creates no family
   data or invitations. Apply it before using the new coach screen.
2. Build/publish the site with the existing Supabase publishable key. The new
   coach URL is `/coach/families.html`; it is not linked from the public site.
3. Sign in with a coach account already provisioned in `coach_users`. The
   browser checks that role for navigation, while database functions check it
   again on every privileged call.

## Coach workflow

1. Review the family's records and verify the guardian's authority and exact
   email through an appropriate private channel. Select the family on the
   coach screen and approve that email. Approval expires after seven days.
2. For a new email, an authorized administrator must create/invite that user
   through Supabase Auth. The public sign-in form does not create users.
   Configure custom SMTP and test delivery before onboarding parents outside
   the Supabase project team. No message is sent by the coach screen.
3. The guardian opens the normal sign-in page with that email, then explicitly
   accepts the family invitation on `/parent/`. The database checks the current
   confirmed Auth email and atomically creates the family membership.
4. A coach can cancel a pending invitation or revoke an accepted membership.
   A revoked membership cannot be restored by its already-accepted invitation;
   a new approval is required. A coach may review membership changes in
   `guardian_access_events` using an authorized database session.

The invitation identifier is not a bearer credential. Possession of a URL or
another family's ID does not grant access. Only the matching signed-in,
confirmed email can view and accept its unexpired invitation. All table writes
and Auth email lookups run in narrowly scoped functions. Direct authenticated
writes to `family_guardians` are removed. Keep the `private` schema unexposed
and the security-definer functions owned by the migration role.

## Verification before real onboarding

Use only temporary test families and accounts; remove them afterward.

- A signed-out request and an unrelated guardian cannot read invitation rows,
  call coach functions, or modify guardian memberships directly.
- Guardian A sees only an invitation to A's confirmed email. Another signed-in
  email cannot list or accept it, including when given its exact UUID.
- Guardian A accepts once and sees only the approved family. A second guardian
  can be approved separately; each sees the family but not the other's link.
- Cancelled and expired invitations cannot be accepted. Duplicate pending
  approvals are refused, including under concurrent requests.
- Revoking a membership removes the family's records on refresh, even while
  the guardian remains signed in. The old invitation cannot restore access.
- The audit table records each grant and revocation with family, account,
  action, time, and actor when a signed-in actor exists. Administrative SQL
  changes can have a null actor. Neither parent nor anonymous API access can
  read it.
- Confirm no secret key, Auth user list, or private database table appears in
  the generated `dist/` files.

Automatic invitation email, Auth account creation, custom SMTP, and a complete
second-guardian browser test remain before real parent rollout.
