# Parent drop-in requests

Guardians with accepted athlete access can request one open dated class for an
athlete already on their account at `/parent/drop-ins.html`. After selecting an
athlete, parents can request any class level, including Intro, regardless of the
athlete's assigned skill group. The class level remains visible in the dropdown;
the coach decides whether it is suitable before approving. Requesting or approving
a drop-in does not change group enrollment or a regular weekly assignment.
The list covers the next 60 days and includes the class's saved venue.
An athlete with an active seat cannot request the same class. A repeated
pending request returns the existing request. A declined request cannot be
resubmitted for the same athlete and class; the coach can arrange a place
manually if circumstances change. A request **does not reserve a place**;
capacity is checked again at approval.

Coaches see pending requests at `/coach/drop-ins.html`. Approval uses the same
serialized `private.confirm_class_seat` helper as manual bookings, then records
the reserved seat on the request. Declining changes only the request. Approval
requires the class to remain in the future, the requesting guardian still to
have athlete access, and a free seat. A coach's separate cancellation keeps
the request history and shows the parent `cancelled` on their request list.
Coaches can enable email notifications for new requests using their own verified
sign-in email. See [deployment and testing](drop-in-coach-email.md). Notifications
link to the protected review page; they do not approve requests or take payment.
Approving now queues a confirmation to the requesting parent's verified email
after reserving the seat. See [approval email deployment](drop-in-parent-email.md).
Declines still require direct parent contact. A person without athlete access
still needs the invitation or enrollment path; this is not a public form.

The request table has no direct browser grants. Narrow checked functions expose
class availability, a guardian's own request history, and a coach's pending
queue. `tests/scheduling/drop-in-requests-gate.sql` inserts synthetic records
inside a transaction and rolls them back after checking family isolation,
revocation, duplicate requests, approval, and capacity.

## Allowing all skill levels

The later migration `20261018201500_drop_in_any_skill_level.sql` removes only
skill-group matching from `request_drop_in`. The parent page also stops filtering
classes by enrollment and explains that the coach reviews suitability. Existing
coach approval, seat limits, duplicate checks, family access and notification
triggers remain in place. No Edge Function deployment is needed.

Roll out the database migration before publishing the updated parent page:

```powershell
npx.cmd supabase db push --dry-run
npx.cmd supabase db push
```

Review the dry-run list before pushing. The expected new migration for this change
is `20261018201500_drop_in_any_skill_level.sql`; review any unrelated pending
migrations separately. Deploy the website from the reviewed PR after the migration
succeeds. Until the website deploys, the previous page continues to show only
matching classes; deploying the new page before the migration can expose options
that the old database function rejects.

Run `npm.cmd run test:access` and `npm.cmd run build` on Node 22. In the preview,
select an Advanced athlete and confirm a future Foundational class with space is
listed with its level. Submit an intentional request, confirm it is pending and
reserves no place, then approve as coach. Verify the reserved session and existing
emails, and confirm the athlete's group stays Advanced. A full class and another
family's athlete must remain unavailable. Use coach tools to cancel any test seat.
