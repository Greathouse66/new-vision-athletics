# Coach skill groups

The coach-only page at `/coach/groups.html` lists active and inactive skill groups.
It creates a group by name and allows a coach to mark it inactive or reactivate it.
It does not delete groups or define schedules. The confirmed group names are
Foundational, Post-Bigs, and Advanced; they were added manually in Supabase.
No group records are inserted by the build.

The page checks the signed-in identity against `coach_users` before showing controls.
Supabase row-level security independently limits group inserts and updates to
coach users; hiding the page is not the authorization boundary. Existing
enrollments still reference inactive groups, so past records remain intact.
The roster at `/coach/records.html` requires one active group and a start date
when creating an athlete. A coach can move an athlete to a different active group
with an effective date after the previous start date. The old row ends on that
date and remains visible in the history. The migration
`20260930230000_athlete_group_assignments.sql` prevents overlapping group dates
at the database layer, rejects inactive groups in the assignment function, and
removes direct client writes to group enrollments. Existing athletes with no
assignment can receive their first group on the roster. Neither page defines
class days, times, or capacity; those details are still to be confirmed.

The page is included in the Deploy Preview build without a public website link.
Verify with a temporary authorized coach account that creation, inactive, and
reactivation work; verify an ordinary guardian cannot insert or update a group
or call the assignment function successfully. Remove any temporary data or role
afterward. No SMTP or active custom domain is needed for these checks.
