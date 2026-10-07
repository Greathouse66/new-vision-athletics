# Coach email when a parent cancels a session

On **Coach → Parent cancellations**, each coach can check **Email me parent
cancellations** and save. Alerts go to that coach's own verified sign-in email,
shown beside the setting. This preference is independent of drop-in request
alerts and starts off, including for coaches already subscribed to those alerts.

A new parent cancellation of a confirmed regular session or drop-in queues one
email per subscribed coach. The message includes the athlete, class, date and
time in the venue's time zone, venue, booking type, cancellation time, and a
protected link to `/coach/cancellations.html`. A regular weekly assignment remains
active. Makeup eligibility and payment decisions remain separate.

Earlier cancellations are not emailed retroactively. Repeating the same parent
cancellation does not queue another email. A coach cancelling a place directly
does not trigger this parent-cancellation alert.

## Deploy

The existing `drop-in-notification-worker` and its one-minute schedule handle all
three queues: parent approvals, coach drop-in request alerts, and coach parent
cancellation alerts. No additional cron job or secret is required.

In PowerShell:

```powershell
cd C:\Users\Will\new-vision-athletics
git fetch origin
git switch parent-cancel-coach-email
npm.cmd ci
npm.cmd run test:access
node --test tests/scheduling/parent-cancellation-email.test.mjs
npx.cmd supabase db push --dry-run
```

The dry run should list only
`20261007000000_parent_cancellation_coach_notifications.sql` on the current hosted
database. Review unexpected migrations before continuing.

```powershell
npx.cmd supabase db push
npx.cmd supabase functions deploy drop-in-notification-worker --project-ref mmxvfsuxvodcqhiksxzr
```

Apply the migration before redeploying the worker. Then merge the pull request
and publish through Netlify. In the coach's **Parent cancellations** page,
enable and save **Email me parent cancellations**. Confirm the displayed email
and **Email notifications are on for new cancellations.**

## Verify delivery

1. Use a linked test parent and athlete with a confirmed future class place.
   The class must be dated; a weekly schedule alone is not a confirmed place.
2. As the parent, open **Upcoming sessions** and cancel that place. Check it
   disappears from confirmed upcoming sessions and appears in cancellation history.
3. Check the coach's inbox and spam folder after a few minutes. Verify the athlete,
   class time, venue, cancellation time, and regular/drop-in description.
4. Open the email's link. It should show the coach's cancellation history or ask
   for coach sign-in. Resend should show a new accepted message.
5. Repeated cancellation of the same seat or a later worker tick must not create
   another email. A cancelled regular class must retain its weekly assignment.

Each coach controls their own setting. Turning it off stops new queue entries
and skips pending alerts when the worker rechecks. Current coach access, verified
email, preference, and the exact recorded cancellation are checked at claim and
again before sending. Revoked coach access or a changed/unconfirmed coach email
prevents sending to the captured address; no alternative recipient is chosen.

The cancellation remains a valid coach history event if parent access is later
revoked, the class starts, or someone books a replacement place. The alert reports
the original cancellation; it does not promise that a place is still available.
Its identity uses the original seat ID, so replacement bookings cannot become
the target of an old cancellation or retry.

## Operations

The shared worker processes one eligible item from each queue per invocation.
Queue attempts run independently, so one queue failure cannot block the others.
Each has its own leases and provider idempotency keys. Temporary failures retry
with a frozen message; uncertain sends older than 20 hours require manual review.

In Supabase SQL Editor:

```sql
select seat_id, coach_id, status, attempts, sent_at, failure_code
from private.parent_cancellation_notification_outbox
order by queued_at desc limit 20;

select jobid, jobname, schedule, active
from cron.job where jobname = 'nva_drop_in_notifications_1m';
```

HTTP results include `parent`, `coach`, and `cancellation` entries, for example
`{"parent":{"status":"idle"},"coach":{"status":"idle"},"cancellation":{"status":"sent"}}`.
HTTP 503 indicates a queue error. `sent` records provider acceptance and a message
ID, not proof of inbox delivery. Inspect provider outcomes before manually
resending any uncertain event. Private outboxes and sending RPCs remain unavailable
to browser accounts.

Local SQL permission and cancellation tests, provider-stub integration, retries,
multi-queue tests, and the site build verify this change. Hosted worker auth,
scheduler calls and real mailbox delivery require the deployment checks above.
