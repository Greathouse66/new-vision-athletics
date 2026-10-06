# Coach class places screen

The coach-only `/coach/classes.html` screen shows the eight standing classes,
their regular assignments, and dated classes with used/total seats. A coach
can assign an existing athlete to a weekly class with effective dates, confirm
one drop-in seat for an existing athlete in a dated class, and cancel one dated
seat. The screen asks for confirmation before any of these actions.

The browser verifies coach access before loading athlete names. Supabase row
policies and the three checked database functions enforce authorization again.
All names are read from the private roster at runtime; none are bundled into
the website build. There is no public link to this screen.

Regular assignment reserves seats on matching dated classes already created
and on future ones when the coach creates their dates. A cancelled single seat
remains in the database history, while the weekly assignment continues. The
screen does not end a weekly assignment or edit a dated class's venue/time.

No parent self-service drop-in request, guardian identity check, email, or
payment is attached to this coach screen. A coach should communicate a manual
drop-in or cancellation directly to the family until those flows are ready.
The venue and open class dates still must be confirmed on `/coach/schedule.html`
before dated seats can exist.
