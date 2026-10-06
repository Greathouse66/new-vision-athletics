# Parent drop-in requests

Guardians with accepted athlete access can request one open dated class for an
athlete already on their account at `/parent/drop-ins.html`. The class must
match the athlete's group enrollment on that date; Intro accepts any existing
athlete. The list covers the next 60 days and includes the class's saved venue.
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
