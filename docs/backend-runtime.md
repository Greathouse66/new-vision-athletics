# Private backend runtime

Supabase Edge Functions host private HTTP operations. The first function,
`coach-gateway`, accepts a signed-in user's JWT and checks the existing
`coach_users` row under row-level security. It returns `{ "ok": true }` for a
coach, HTTP 403 for a signed-in non-coach, and an authentication error for a
request without a valid user JWT. It does not expose family records.
The deployed function returned 401 without a session, 403 for the signed-in
test account, and 200 after a temporary coach grant. That grant was removed
and its remaining row count was verified as zero.

Netlify publishes only `dist/`. Functions in `supabase/functions/` are deployed
separately to the linked Supabase project. The `backend/` folders are a
responsibility map, not executable functions. The public site can call future
functions through the signed-in Supabase client; the server must check the
caller's role and family scope on every operation. Keep concurrent changes to
capacity, credits and payments in atomic database functions, not multiple
browser requests. No service-role key belongs in the site bundle.

## Deploy this boundary

From the linked repository in PowerShell:

```powershell
npx.cmd supabase functions deploy coach-gateway --use-api
```

This is a function deployment, not a database migration or a Netlify deploy.
No new secret or business data is required for this route. The project must
already be linked with the Supabase CLI. If testing from a signed-in app page,
call `supabase.functions.invoke('coach-gateway', { body: {} })` using the
existing client instance. A coach should receive `{ "ok": true }`; the
currently non-coach test account should get HTTP 403. A request without a
user session must be rejected. Do not assign a lasting coach role just to
verify this endpoint; use a temporary role only if you want to test the
successful branch, then remove it as in earlier access checks.

New functions should declare an auth mode, use the RLS-scoped client for user
requests, return minimal errors, and keep external provider credentials in
Supabase function secrets. Local secrets in `supabase/functions/.env` are
ignored by Git. A local function runtime requires Docker or a compatible
runtime; the `--use-api` deployment does not.
