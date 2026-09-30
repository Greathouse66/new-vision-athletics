# Coach skill groups

The coach-only page at `/coach/groups.html` lists active and inactive skill groups.
It creates a group by name and allows a coach to mark it inactive or reactivate it.
It does not delete groups, add enrollments, or define schedules. No group records
are inserted by the build. Confirm actual group names with the program before adding them.

The page checks the signed-in identity against `coach_users` before showing controls.
Supabase row-level security independently limits group inserts and updates to
coach users; hiding the page is not the authorization boundary. Existing
enrollments still reference inactive groups, so past records remain intact.
The enrollment workflow must check group activity before assigning new athletes;
this page alone does not enforce that rule.

The page is included in the Deploy Preview build without a public website link.
Verify with a temporary authorized coach account that creation, inactive, and
reactivation work; verify an ordinary guardian cannot insert or update a group
through the Data API. Remove any temporary data or role afterward. No SMTP or
active custom domain is needed for these checks.
