# Reviewed guardian access

Coach → Families → Invite parent sends a one-time sign-in link for the selected
athlete's family account. New addresses are provisioned through Supabase Auth;
existing confirmed accounts receive a magic link. The parent explicitly accepts
the email-bound family invitation before accessing athletes, sessions or balances.
The public sign-in form continues to use `shouldCreateUser: false`.

## Deploy order

Follow [parent-invitations-deployment.md](parent-invitations-deployment.md).
Apply the delivery migration, deploy `coach-invite-parent` with JWT verification
enabled, then publish the frontend. SMTP and the canonical callback URL must
already be configured. No additional email provider key is needed by this flow.

## Coach workflow

1. Select the athlete's family account; the dropdown includes linked athlete
   names. Verify the parent's exact email and choose **Invite parent**.
2. The server checks the current coach role, saves or reuses the pending family
   approval, and sends the Auth email through the configured SMTP service.
   The family approval expires after seven days. The one-time Auth link has its
   own shorter expiry; **Resend email** provides a fresh link without extending
   the family approval. Use the latest email's link.
3. The parent opens the email link and chooses **Accept access** on `/parent/`.
   The database checks the current confirmed Auth email and atomically creates
   the family membership. A coach role routes to `/coach/` after sign-in;
   an account with both roles may open `/parent/` to accept a family invitation.
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

## Hosted test (2026-09-30)

The guardian migration and the follow-up email return-type fix were applied to
the linked project. A read-only SQL check returned true for eight access gates,
including RLS, revoked direct membership writes, RPC grants, and the audit
trigger. With a temporary coach role and dummy family, the coach screen created
an invitation for the existing test identity. After removing the coach role,
that identity accepted the invitation and saw the family on the hosted parent
page. Coach revocation removed access; the temporary coach role was removed
again. The dummy family's invitation, audit rows, and family record were deleted;
post-cleanup counts for those three tables were all zero. The pre-cleanup audit
event counts were not recorded, so event contents still need a direct check.

This historical hosted test predates automatic email delivery. The delivery
implementation has automated PostgreSQL permission tests and server email-flow
tests; run `npm.cmd run test:access`. A hosted browser test with a new parent,
an existing parent, and an unrelated family remains part of deployment.
