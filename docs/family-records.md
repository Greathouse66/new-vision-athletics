# Coach family and athlete records

`/coach/records.html` is a coach-only preview screen for creating families and
athletes and correcting their display names. It lists athletes for one selected
family at a time. It does not create an Auth user, grant guardian access, send
an invitation, set a skill group, or assign a schedule. Those are distinct
operations. No sample or real family records are inserted by the build.

The page checks the signed-in account against `coach_users` before displaying
controls. Existing row-level security independently restricts family and
athlete inserts and updates to coaches. Neither the client nor this page may
assign itself a coach role. No new migration is needed for this screen.

Names are display labels, not unique identity keys. Coaches should review
possible duplicate family or athlete names before adding a record. Family
membership is stored by ID and cannot be changed from this screen. The page
does not delete a family or athlete, because links and past enrollments must
remain consistent. Avoid importing actual families until the review process
for duplicates and guardian authority is agreed. Name corrections do not yet
have their own audit history, so this page remains a preview workflow.

Test in the Deploy Preview with a disposable family and athlete, a temporary
coach role, and a guardian-only account. Confirm creation and both name
corrections as coach, then remove the coach role and confirm the page blocks
access. Verify direct guardian Data API inserts and updates remain denied by
RLS. Clean up disposable rows after confirming they have no guardian or
enrollment links. This screen does not require the custom domain or SMTP.
