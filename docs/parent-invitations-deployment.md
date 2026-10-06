# Parent invitations and coach sign-in routing

This change builds on the existing guardian invitation/acceptance migrations.
It adds automatic Auth account invitations, emailed sign-in links, resend,
server-side throttling, and routing by the saved `coach_users` membership.

## Windows deployment

Fetch and check out the `coach-parent-invitations` branch from GitHub in
`C:\Users\Will\new-vision-athletics`. Check `git status --short` first; keep
any local edits rather than resetting them.

```powershell
git fetch origin
git switch coach-parent-invitations
npm.cmd ci
npm.cmd run test:access
npm.cmd run build
npx.cmd supabase db push --dry-run
```

The new migration is `20261006210000_guardian_invitation_delivery.sql`. Review
the dry-run output before applying; older pending migrations require their own
review. With the project linked to `mmxvfsuxvodcqhiksxzr`:

```powershell
npx.cmd supabase db push
npx.cmd supabase functions deploy coach-invite-parent --project-ref mmxvfsuxvodcqhiksxzr
```

Keep JWT verification enabled. The function also verifies the current coach
role using the caller's authenticated client before any administrative Auth call.
It uses Supabase-provided server credentials; never add a secret key to Netlify
frontend variables or browser code.

The project already uses `NVA_PUBLIC_ORIGIN` for receipt email. Its value for this
deployment must be `https://newvision-athletics.com`. If it has not been set:

```powershell
npx.cmd supabase secrets set NVA_PUBLIC_ORIGIN=https://newvision-athletics.com --project-ref mmxvfsuxvodcqhiksxzr
```

Supabase Auth must use the working custom SMTP configuration and allow
`https://newvision-athletics.com/auth/callback.html` as a redirect. Keep
`{{ .ConfirmationURL }}` in both the Invite user and Magic Link email templates.
The function does not change these settings. SMTP/provider limits may require
waiting before retrying a failed delivery.

After the database and function are deployed, merge the pull request to `main`
so the existing Netlify production build publishes the frontend. Confirm that
the production build uses `NVA_SUPABASE_PUBLISHABLE_KEY` as before.

## Hosted acceptance test

1. Request a new sign-in link for the saved coach account
   `fuselab.designs@gmail.com`. The callback should open the Coach Dashboard.
2. Open **Families**, select a temporary athlete's account, and invite a parent
   address that is not already in Auth. Confirm that an email arrives and the
   Auth account is created without a manual administrator step.
3. Open that email in a separate browser profile. The Parent Portal should show
   the invitation and **Accept access**, with no family records beforehand.
4. Accept access. Confirm that the athlete, sessions and balance belong to that
   family and that an unrelated test family is absent.
5. Invite a second, already-confirmed parent address. It should receive a new
   sign-in link, then accept independently. This does not replace the first parent.
6. Test **Resend email** after two minutes. A send still in progress reserves the
   address for up to five minutes; repeated clicks should not produce duplicate
   pending family approvals. Use the newest email link.
7. Cancel a pending invitation and revoke an accepted guardian. A cancelled,
   expired or previously accepted invitation cannot restore revoked access.
   Refresh the parent portal and confirm its athletes, sessions and balances
   disappear after revocation. Remove only the temporary test data afterward.

An SMTP acceptance response means the email was sent to the provider; use the
existing Resend delivery log to confirm inbox delivery. A failed send retains
the family approval and offers a retry through **Resend email**. Membership
changes require explicit acceptance, even if an email arrives after cancellation.

## Automated verification

```powershell
npm.cmd run test:access
node --test tests/billing/*.test.mjs tests/scheduling/*.test.mjs tests/import/*.test.mjs
npm.cmd run build
```

The access suite uses disposable PGlite PostgreSQL to apply the existing schema
and the new migration, with Supabase Auth ID/email/confirmation fixtures.
It exercises real database roles, RLS, RPC permissions, expiry, revocation,
delivery reservations, and isolation of athletes, balances and booked sessions.
The unrelated hosted scheduler's `pg_net`/`pg_cron` extension migration is omitted.
Server tests use controlled Auth responses for new/existing accounts and SMTP
failure; they do not send real email or validate production credentials.
