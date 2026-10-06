# Regular places and dated class seats

Status: database foundation. No athlete has been assigned a regular class or
given a dated seat by this migration. No parent drop-in request is live.

`20261003220000_class_seats_foundation.sql` adds two coach-readable tables:

| Table | Purpose |
| --- | --- |
| `regular_class_assignments` | One athlete's scheduled place in one standing class, within an effective date range |
| `class_seats` | One athlete's confirmed place in one dated class, including its regular or drop-in source and cancellation history |

The regular class roster is separate from the athlete's skill-group assignment.
An athlete can attend a class at another level when the coach assigns or
confirms that class. A class holds no more than its saved capacity of 10. An
athlete cannot hold two active seats in the same dated class. The `class_seats`
table keeps cancelled confirmations for review.

The coach-only `add_regular_class_athlete` function checks the slot, athlete,
effective dates and available regular places. It reserves seats on any dated
classes already created within the assignment's range. When the coach creates
a new dated class, a trigger reserves its regular athletes in the same
transaction. A full class stops the operation; no partial assignment or
partial week's class creation is saved. Overlapping terms for the same athlete
and standing class are refused.

`confirm_coach_drop_in` reserves a single dated seat for an existing athlete
through the same locked capacity check. `cancel_coach_class_seat` releases a
single dated seat and records the coach and time. Cancelling one seat does not
end a regular weekly assignment, notify a parent, or change billing.

Only authenticated coaches may invoke those functions. Browser roles have no
direct insert, update or delete rights on either table. Parents and unsigned
visitors cannot see these rows through the Data API. A later reviewed parent
summary will expose only the family's own sessions.

Before the coach uses these functions with real athletes, Emery must identify
which of the handwritten roster entries attend regularly and on which days.
The athlete roster and guardian contacts need review; names and emails stay
out of Git. A public drop-in form will require a verified guardian contact,
throttling, a coach decision and an email sender. An unverified request must
never reserve one of the 10 seats. Regular assignment ending and schedule
correction controls need a separate reviewed coach workflow.
