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

The roster does not infer attendance from a confirmed seat. Once a class starts,
a coach can mark an active seat present or absent through the checked database
function. Corrections require a reason and remain visible in the history.
See `docs/coach-attendance.md` for the attendance rules.
The page does not change a venue or contact a parent.
Until a venue and open dates are saved and the coach assigns actual seats, the
page correctly shows an empty day.
