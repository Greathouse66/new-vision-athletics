# Parent confirmation after drop-in approval

Approving a pending parent drop-in request reserves a place and queues one
confirmation to the **verified email of the parent who submitted the request**.
Other guardians on the athlete's account are not copied. Declined requests,
failed approvals, manual coach bookings, and previous approvals do not generate
this message. Coach notification subscriptions do not affect parent confirmations.

The email includes the athlete, class, venue, date and time in the venue's time
zone, and a protected link to `/parent/sessions.html`. The link asks for parent
sign-in when needed. The message confirms a reserved place and makes no payment
or balance claim.

## Deploy

The existing `drop-in-notification-worker` and its one-minute job now handle both
coach request alerts and parent approval confirmations. No new scheduler job or
secret is needed on this project.

In PowerShell:

```powershell
cd C:\Users\Will\new-vision-athletics
git fetch origin
git switch drop-in-parent-email
npm.cmd ci
npm.cmd run test:access
node --test tests/scheduling/drop-in-email.test.mjs tests/scheduling/drop-in-approval-email.test.mjs
npx.cmd supabase db push --dry-run
```

The dry run should list only
`20261006230000_drop_in_parent_approval_notifications.sql` on the current hosted
database. If it lists unexpected migrations, review those before continuing.

```powershell
npx.cmd supabase db push
npx.cmd supabase functions deploy drop-in-notification-worker --project-ref mmxvfsuxvodcqhiksxzr
```

Apply the migration before redeploying the worker. Then merge the pull request
into `main` and publish through Netlify to update the coach's confirmation text.
The existing job `nva_drop_in_notifications_1m` continues to use the existing
Vault key and Resend settings. Do not create another scheduled job.

## Test delivery

1. Use an athlete and accepted parent account you control. As the parent, submit
   a **new** request for an upcoming dated class with an available place.
2. As the coach, approve that request. Confirm it is approved and the place is
   reserved. Leave the reservation active while testing the email.
3. Check the requesting parent's inbox and spam folder after a few minutes.
   Verify the athlete, class time, venue, and the message that a place is reserved.
4. Open the email's sessions link. It should lead to the linked parent's upcoming
   sessions or ask them to sign in first. Verify the confirmed class is listed.
5. Check Resend for the new message. A second worker tick or repeated approval
   must not generate another confirmation for that request.

Parent confirmations are automatic; the parent does not need to enable a setting.
Delivery checks their confirmed email, current athlete access, approved request,
active reserved seat, and future class at claim and again immediately before
sending. Revoked access, changed or unconfirmed email, a cancelled place, and a
past class skip queued confirmations. An approved booking remains valid when
email delivery fails; email is not part of the seat transaction.

## Check delivery status

In the hosted SQL Editor:

```sql
select request_id, parent_id, status, attempts, sent_at, failure_code
from private.drop_in_approval_notification_outbox
order by queued_at desc limit 20;

select jobid, jobname, schedule, active
from cron.job where jobname = 'nva_drop_in_notifications_1m';
```

The worker HTTP response now has separate `parent` and `coach` results, for
example `{"parent":{"status":"sent"},"coach":{"status":"idle"}}`.
It attempts both queues each tick, even if one queue is unavailable, and returns
HTTP 503 for a queue error. Existing coach alerts keep their provider idempotency
keys; parent confirmations use a separate key namespace.

Temporary delivery failures retry with a frozen message, a five-minute lease,
and the same provider key. Uncertain attempts older than 20 hours move to `review`;
inspect the provider outcome before taking any manual resend action. `sent` means
the provider accepted the message and returned its ID, not proof of inbox delivery.
The queue and sending functions remain inaccessible to browser roles.

Local database, renderer, provider-retry, queue isolation, and site-build checks
cover this change. Hosted function authentication, scheduler invocations, and the
real mailbox still require the deployment and delivery test above.
