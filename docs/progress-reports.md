# Athlete progress reports

Coach Emery uploads an existing PDF for an existing athlete at `/coach/reports.html`. Linked parents view published reports at `/parent/reports.html`, available from their dashboard and portal navigation. This feature does not create or edit the report content.

## Coach workflow

1. Select the athlete and enter a title, reporting date, and optional message.
2. Upload a PDF up to 10 MiB and save the private draft.
3. Preview the PDF and confirm the athlete, date, and title before publishing.
4. Publishing makes the report available to that athlete's linked parents and queues a generic email with a portal link. Saving a draft sends no email.
5. To correct a published report, unpublish it, edit the draft or upload a replacement, preview, and publish again. Republishing creates a new notification. Repeating Publish on an already published report does not.

Parents see a dated report history with View report and Download PDF. PDF preview support depends on the device; the download button is the fallback. After signing in from an email, parents can open Progress reports from their dashboard; existing authentication routing is unchanged.

## Deployment order

Apply both migrations before updating the existing notification worker or releasing the frontend. No new email secret, scheduled job, or Edge Function is required: report emails use the existing drop-in notification worker, Resend configuration, and scheduler.

From PowerShell in the existing repository, first check that `git status --short` is empty. If it shows changes, preserve and commit that work before switching branches; do not reset or overwrite it.

```powershell
git status --short
git fetch origin
git switch athlete-progress-reports
npm.cmd ci
npm.cmd run test:access
node --test tests/reports/*.test.mjs tests/scheduling/*email.test.mjs
npm.cmd run build
npx.cmd supabase db push --dry-run
```

The expected new migrations are:

- `20261008160000_athlete_progress_reports.sql`
- `20261008161000_progress_report_notifications.sql`

If the dry run lists other pending migrations, review those separately before proceeding. After confirming the expected list:

```powershell
npx.cmd supabase db push
npx.cmd supabase functions deploy drop-in-notification-worker --project-ref mmxvfsuxvodcqhiksxzr
```

Then test the pull request's Netlify Deploy Preview using the configured project and permitted preview sign-in URLs. The preview requires the database migrations. After the hosted checks below pass, merge the reviewed pull request through the normal GitHub/Netlify release workflow.

## Hosted checks before release

Use a test athlete and parent with existing linked access, plus a different family account:

1. Upload a real PDF, save a draft, preview it, and download it as the coach. The parent must not see the draft or receive an email.
2. Publish it. The linked parent should see the title, reporting date, optional message, and correct PDF; the other family must not see or download it.
3. Confirm the existing worker sends the parent notification. It contains a private portal link, with no PDF attachment, athlete name, title, or coaching notes.
4. Unpublish it and confirm parent metadata and new PDF fetches are blocked. Replace the PDF and publish again; the parent should get the replacement and a new notification.
5. Revoke one parent's family access and confirm both report access and new PDF fetches stop. A second linked parent should retain access.
6. Check the original drop-in request, approval, and cancellation notification flows still work.

Local tests exercise real migrations and PostgreSQL RLS in PGlite with a minimal Storage schema. Browser checks use mocked authentication, API responses, uploads, and email delivery. They do not prove a live Supabase Storage HTTP upload or a real Resend delivery; those require the hosted checks above.

## Access and storage

The `athlete-progress-reports` bucket is private, PDF-only, and limited to 10 MiB. Coaches can upload only to a server-reserved path on a draft. Client overwrites and deletions are denied. Each replacement gets a new immutable file path.

Parents can read only published reports for currently linked athletes, and only each report's current PDF. Downloads use the authenticated Storage endpoint with a fresh access check, not public or reusable signed URLs. The Storage SELECT policy checks the documented authenticated-download operation; if a hosted Storage version does not provide it, access fails closed and the hosted check must resolve that compatibility before release. Other buckets' policies are unchanged.

Revocation or unpublishing prevents future downloads. A copy a parent has already downloaded or opened locally cannot be withdrawn. PDF preview object URLs are cleared when the preview closes or the account signs out.

Unattached uploads and replaced files remain private for recovery and audit. This version does not delete report files. Future cleanup must use the Storage API after checking that a file is no longer current; deleting only SQL object metadata does not safely remove stored bytes.

## Notification monitoring

The private outbox rechecks current publication, PDF metadata, family membership, and confirmed recipient email before sending. It uses leases, frozen retry payloads, and provider idempotency keys, following the existing notification worker. Reports cannot supply arbitrary recipients through the browser. Old reports do not generate a historical email when a parent is newly linked.

To inspect delivery state in the Supabase SQL Editor without listing email addresses or private report contents:

```sql
select report_id, publication, parent_id, status, attempts,
       sent_at, failure_code
from private.progress_report_notification_outbox
order by queued_at desc
limit 20;
```

`review` means automatic retries stopped after an uncertain delivery window; inspect the provider record before attempting another delivery. Do not delete outbox records to force a resend.
