# Coach weekly venue choice

The coach-only `/coach/schedule.html` page lists the two currently proposed
Minot venues and saves one location for a Monday-starting week. The browser
checks coach access and the database function `set_class_week_venue` checks it
again. A guardian or signed-out visitor cannot read the weekly venue table or
set it through the Data API.

Migration `20261003212000_minot_venue_choices.sql` adds the labels Minot Armory
and Minot YMCA with `America/Chicago` if absent. Verify which actual facility
is booked before saving a week. The page defaults to the current or next Monday
in Minot local time, including across daylight saving changes. The coach can
choose any reviewed class location from the database.

Saving a weekly venue does not create a dated session or reserve any of the 10
places. `class_occurrences.location_id` stores the actual venue on each dated
class when it is created. The coach function refuses to change the week's
default after dated classes exist, so an already published venue cannot change
silently. A future checked correction must notify affected families if the
venue changes after sessions are published.

Migration `20261003214000_weekly_slots_and_dated_classes.sql` adds the eight
confirmed weekly class times starting October 5, 2026. The coach can then
select one to five open dates from Monday through Friday on this page. The
`create_dated_classes` function checks coach access, the saved weekly venue,
duplicate dates, and the named venue time zone, then creates every class on
each selected date in one transaction. Unchecked days create nothing. Dates
already created cannot be selected again. The page displays the number of
classes created per date. The migration creates no dated classes by itself.

Before selecting the first live week, Emery must confirm the actual venue and
which days are open. If a created class must move venue, time, or date, use a
separate reviewed correction and family notification flow; this page has no
such edit control. The dated class table remains coach-readable only.

The parent drop-in request and regular class booking flows remain separate.
They require a dated class, capacity checks, verified parent contact, and a
coach decision before a seat can be confirmed. No public parent request form
is enabled by this page.
