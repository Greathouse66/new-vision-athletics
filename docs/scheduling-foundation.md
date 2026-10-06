# Class scheduling foundation

`20261001030000_class_schedule_foundation.sql` adds three empty tables. It does
not publish class times, create dated sessions, change tuition, or populate a
parent calendar. Apply it after the group-assignment migration.

| Table | Purpose |
| --- | --- |
| `class_locations` | Venue label and its named time zone, entered after venue confirmation |
| `standing_class_slots` | One recurring weekday, local start time, duration, group, location, capacity, and effective date range |
| `class_occurrences` | One dated class linked to a standing slot, with saved start/end instants and capacity |

The slot's weekday uses ISO numbering (Monday 1, Sunday 7), and `active_until`
is exclusive. One group may eventually have more than one weekly slot. A slot
does not enroll an athlete into a particular class or charge tuition. The
existing `group_enrollments` table holds the athlete's skill group by date;
bookings and attendance need separate records and authorization later.

The venue's time zone must be a named zone recognized by PostgreSQL. Confirm
the actual venue before using `America/Chicago`; a fixed `GMT-5` offset would
be wrong when the clocks change. `class_occurrences` stores exact `timestamptz`
instants for historical accuracy. The future generator must check local dates,
daylight-saving gaps/repeated times, holidays, and any one-off changes before
inserting a dated class. It must also check that the saved instants and date
match the linked venue and standing slot. The schema alone does not perform
that cross-table validation.

For now, signed-in coaches can read these tables through the Data API. They
have no client insert, update, or delete grants or policies; guardians and
signed-out users cannot read them. A later reviewed workflow will add narrow
coach writes and family-specific session reads. The migration inserts no
locations, slots, or occurrences. Keep direct database-owner writes for
reviewed administrative work only.

Before adding live schedule rows, confirm each group's day(s), local start
time and duration, venue and its IANA zone, capacity, first date, holiday
calendar, and whether a missed date is skipped, moved, or made up. Define how
changes to a standing slot retain previous dated sessions. No recurring
generation or parent access should be enabled until those decisions are made.

After applying the migration, verify all three tables exist and contain zero
rows, and inspect `pg_policies` to confirm only the three coach read policies.
Test that an ordinary authenticated parent gets no rows and cannot insert a
slot through the Data API. No real families or class schedules are needed for
that access check.
