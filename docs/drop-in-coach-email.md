# Coach drop-in email notifications

On **Coach → Drop-in Requests**, each coach can check **Email me new drop-in
requests** and save. Notifications go to that coach's current verified sign-in
email, shown beside the setting. Multiple coaches can subscribe independently.
Notifications start with newly submitted requests after subscribing; earlier
requests remain visible in the dashboard but are not emailed retroactively.

The email shows the athlete, group, class date and time in the venue's time zone,
venue, and a link to `/coach/drop-ins.html`. The link requires coach sign-in.
The request remains pending and does not reserve a place until approved. The
coach still contacts the parent directly after approving or declining.

## Deploy in this order

1. In PowerShell, download the branch and run checks:

   ```powershell
   cd C:\Users\Will\new-vision-athletics
   git fetch origin
   git switch drop-in-coach-email
   npm.cmd ci
   npm.cmd run test:access
   node --test tests/scheduling/drop-in-email.test.mjs
   npm.cmd run build
   npx.cmd supabase db push --dry-run
   ```

   The dry run should list only
   `20261006220000_drop_in_coach_notifications.sql` on the current hosted database.
   If it lists unexpected migrations, review those before continuing.

2. Apply the migration and deploy the worker:

   ```powershell
   npx.cmd supabase db push
   npx.cmd supabase functions deploy drop-in-notification-worker --project-ref mmxvfsuxvodcqhiksxzr
   ```

   The worker reuses the existing Supabase secrets `RESEND_API_KEY`,
   `NVA_RECEIPT_FROM`, and `NVA_PUBLIC_ORIGIN`. No new secret is required for this
   project. An optional `NVA_NOTIFICATION_FROM` can override the receipt sender
   using another verified address. The worker accepts only the existing named
   worker secret `receipt_worker_test`; browser users cannot invoke it.

3. Open this project's **Supabase → SQL Editor**. Paste and run the complete
   [scheduler SQL](schedule-drop-in-notifications.sql). It reads the existing
   `nva_receipt_worker_key` from Vault and creates a notification job every minute.
   It returns a job row with `active = true`. Rerunning updates that job rather
   than creating another one. It does not change the receipt schedule.

4. Merge the pull request into `main`. In Netlify, trigger a production deploy
   if one does not start automatically. Wait for it to publish.

5. Sign in as the coach, open **Drop-in Requests**, check **Email me new drop-in
   requests**, and click **Save email preference**. Confirm the displayed address
   and the message **Email notifications are on for new requests.**

## Check one real delivery

Use a test athlete and parent email you control. If you revoked that parent's
access earlier, invite them again and have them accept before testing.

1. Create an upcoming dated class with a venue and an available place. A weekly
   schedule template alone will not appear in the parent's picker.
2. As the linked parent, submit a **new** eligible drop-in request.
3. Leave it pending while checking the coach's inbox and spam folder. The worker
   handles one queued recipient per minute, so allow several minutes if there
   are other queued messages. Resend should show a new message.
4. Confirm the athlete, class time, venue, and link. Open the link and verify it
   leads to the coach's pending requests (or asks for coach sign-in first).
5. Approve or decline from the dashboard. Repeated submissions of the same
   pending request reuse the request and do not create another notification.

To turn notifications off, clear the checkbox and save. Each coach manages
their own setting. Coach access, confirmed email, subscription, parent access,
pending request, and future class are rechecked before sending. Requests already
reviewed, past classes, changed emails, or revoked access are skipped.

## Delivery operations

The private queue cannot be read or edited by browser accounts. The worker
claims with a five-minute lease, freezes its payload, and uses one provider
idempotency key per request and coach. Temporary failures retry with backoff.
Uncertain attempts older than 20 hours stop in `review` rather than automatically
resending outside the provider's idempotency window. Do not reset such events
without checking the provider's existing message outcome.

Inspect queue status in Supabase SQL Editor without exposing addresses or keys:

```sql
select request_id, coach_id, status, attempts, sent_at, failure_code
from private.drop_in_notification_outbox
order by queued_at desc limit 20;

select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname = 'nva_drop_in_notifications_1m'
order by d.start_time desc limit 5;

select id, status_code, content, error_msg
from net._http_response
order by id desc limit 5;
```

`sent` means Resend accepted the message and returned an ID; it does not prove
inbox delivery. A successful cron run only queues HTTP, so also check the worker's
HTTP response and Resend delivery status. Responses may include the receipt
worker as both jobs use `pg_net`. The new migration and email tests run locally;
the hosted scheduler, named worker key, and real mailbox require the checks above.
