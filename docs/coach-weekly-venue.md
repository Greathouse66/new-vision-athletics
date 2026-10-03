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

The parent drop-in request and regular class booking flows remain separate.
They require a dated class, capacity checks, verified parent contact, and a
coach decision before a seat can be confirmed. No public parent request form
is enabled by this page.
