# Parent sign-in foundation

This slice adds `/auth/sign-in.html`, `/auth/callback.html`, and `/parent/`.
Only the listed HTML, CSS, and bundled browser JS enter Netlify's `dist/`.
No database migration or server credential is needed. The family page lists
families and athletes only; sessions and balances do not exist in the schema yet.

## Configuration

1. In Supabase **Project Settings → API Keys**, copy the project's **publishable**
   key (`sb_publishable_…`). Do not use a secret or service-role key.
2. For a local PowerShell build, set
   `$env:NVA_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_…'` in that terminal,
   then run `npm.cmd install` and `npm.cmd run build`. For deployment, set
   `NVA_SUPABASE_PUBLISHABLE_KEY` in Netlify's build environment and redeploy.
   The key is deliberately embedded in browser JS; RLS enforces data access.
   Without a key, the public site still builds but portal sign-in is disabled.
3. In Supabase **Authentication → URL Configuration**, set **Site URL** to the
   site's actual production origin, and allow its exact callback URL, such as
   `https://newvision-athletics.com/auth/callback.html`. If testing a Netlify
   preview, add that preview's exact callback URL too. For local testing on port
   3001, allow `http://localhost:3001/auth/callback.html`. The local port must
   match the address serving `dist/`.
4. Supabase's standard Magic Link email template must use its usual
   `{{ .ConfirmationURL }}` link so the `emailRedirectTo` option reaches our
   callback. If the template was customized, inspect and correct its destination.
5. Supabase's default mailer sends only to project-team addresses. Configure
   custom SMTP and test delivery before giving parents this link.

## Granting access

The requested email must already be a Supabase Auth user. The sign-in
form uses `shouldCreateUser: false`; it never grants family access. An authorized
coach/admin must verify the guardian and insert their exact Auth user UUID and
family UUID into `family_guardians`. A signed-in user with no guardian link sees
an access-pending message. No public form can create guardian membership.

Do not add real family records just to test the screen. With an existing test
Auth user and no persistent family link, verify the access-pending state first.
Before onboarding, test a guardian with a reviewed family link, a second
unrelated guardian, and revocation in the browser in addition to the SQL RLS
checks already performed. The static HTML is public, but the family data is
requested only after authentication and filtered again by database RLS.
