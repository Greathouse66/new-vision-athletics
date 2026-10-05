# Coach Today roster

The coach-only `/coach/today.html` page defaults to today's calendar date in
Minot (`America/Chicago`) and can display another selected date. It reads
created dated classes, their actual saved venue, confirmed regular and drop-in
seats, and the athletes on those seats. It shows a class's saved seat count and
capacity. Cancelled seats are excluded from the visible roster.

The browser verifies coach access before requesting any athlete names.
Supabase row policies separately restrict these source tables to a coach.
The page includes no names in its static build and does not publish a public
link to the coach route.

This screen is read-only. It does not infer attendance from a confirmed seat,
mark an athlete absent or present, change a class venue, or contact a parent.
Attendance and audited corrections need their own checked database workflow.
Until a venue and open dates are saved and the coach assigns actual seats, the
page correctly shows an empty day.
