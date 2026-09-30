# Coach athlete roster and parent accounts

`/coach/records.html` is a coach-only preview screen centered on athletes.
Most athletes have their own account managed by a parent. The coach's
"Add individual athlete" action creates one `families` row and one `athletes`
row in a single database function call. The account starts with no parent
access; the coach approves that separately. For siblings, the coach creates
one shared account and adds each athlete to it. The page lists all athletes
and lets the coach correct display names. It does not create an Auth user,
send an invitation, set a skill group, or assign a schedule. No sample or
real records are inserted by the build.

The page checks the signed-in account against `coach_users` before displaying
controls. Existing row-level security independently restricts account and
athlete inserts and updates to coaches. The individual creation function is
`security invoker`, explicitly checks the coach role, and inherits the same
RLS checks. Neither the client nor this page may assign itself a coach role.
Apply the new migration before testing the individual athlete action.

Names are display labels, not unique identity keys. Coaches should review
possible duplicates and confirm the parent account before linking an athlete.
Membership is stored by ID and cannot be changed from this screen. Parents
who gain access to an account see every athlete in that account. Athletes do
not sign in themselves in this version. The page does not delete records,
because links and past enrollments must remain consistent. Changing an
individual athlete's name does not automatically rename the account label;
the coach can correct that separately. Name corrections do not yet have their
own audit history, so avoid importing actual families until the review process
for duplicates and guardian authority is agreed.

Test in the Deploy Preview with a disposable solo athlete and a shared
account with two disposable siblings, a temporary coach role, and a parent-only
account. Confirm both creation paths and name corrections as coach; verify
that the parent sees only approved athletes. Remove the coach role and confirm
the page blocks access. Verify direct parent Data API inserts and updates
remain denied by RLS. Clean up disposable rows after confirming they have no
guardian or enrollment links. This screen does not require the custom domain
or SMTP.
