# Coach attendance

The coach-only Today roster shows an attendance control for each active,
confirmed dated seat after its class begins. A coach may record **present** or
**absent**. A repeat of the same mark has no effect. A changed mark requires a
reason of 3–500 characters; the old value, new value, reason, coach, and time
are saved in an append-only audit table. The screen shows this history in
Minot time. A cancelled seat cannot receive a new mark. Its earlier history
remains in the database.

The `record_class_attendance` function checks the coach role, seat status,
class start, and correction reason. Direct browser table writes and anonymous
function calls are denied. Only coaches can read attendance and its history.
The migration creates no attendance rows.

Attendance is an observation. It does not create makeup credit, change billing,
cancel a seat, or send a parent notification. The coach must confirm a venue,
open dates, and actual athlete seats before there is a live roster to mark.

After applying the migration, run `tests/scheduling/class-attendance-gate.sql`
as a complete query in the Supabase SQL Editor. It uses synthetic records and
rolls them back. Its success notice verifies initial marks, idempotent retry,
correction history, and the cancelled-seat gate.
