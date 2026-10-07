# Parent cancellation of a confirmed class place

Migration `20261006160000_parent_class_cancellations.sql` adds a guardian-only
cancellation of one future confirmed seat on `/parent/sessions.html`. A
confirmation dialog names the athlete and class. The database checks the
current guardian relationship, locks the dated class, records the server time
and actor on the seat and in `parent_class_cancellations`, and releases the
seat. A repeated call for the same seat by the same guardian returns the same
result. A stale browser cannot cancel a newer replacement seat because the
request uses the exact original seat ID.

The parent sees recent cancellations after refreshing the sessions page. The
coach sees parent cancellations at `/coach/cancellations.html`, including
the athlete, class, venue, seat type, and cancellation time. A regular weekly
assignment remains in force; only the selected dated seat is cancelled.
Approval of makeup eligibility, credits, fees and refunds remains separate
until Emery approves the policy. Coaches can enable email alerts for new parent
cancellations on this page; see [notification deployment](parent-cancellation-coach-email.md).
The email names the athlete and dated class and links to the protected cancellation
history. The coach still contacts the parent directly about makeup eligibility.
No parent cancellation email, SMS, receipt, credit, or refund is generated.

Raw cancellation rows have no browser table grants. Narrow RPCs check current
guardian or coach access. The rollback-only SQL gate covers cross-family
access, revocation, idempotency, capacity release, and regular assignment
preservation. It leaves no test athlete or venue in the database.
