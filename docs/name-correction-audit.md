# Name correction history

Apply `20261001032000_record_name_corrections.sql` before deploying the updated
athlete roster page. It creates `record_name_corrections` and two triggers that
record a changed parent-account or athlete `display_name` in the same database
transaction as the update. Existing names are not backfilled. The migration
inserts no family, athlete, or audit rows.

Each event stores the record type and ID, its parent account ID at the time,
old and new names, a timestamp, and `auth.uid()` when a signed-in coach made
the correction. Direct database-owner changes without a signed-in Auth user
have a null coach ID; the roster labels these as database actions. The coach
page shows the 30 most recent name corrections for the selected parent account
with UTC timestamps. The full history remains in the database.

Only a coach can read the audit table through the Data API. Neither parents
nor anonymous clients can read it, and no browser role can insert, update, or
delete events. The trigger function is in the unexposed `private` schema and
has a fixed empty search path. Database owners retain their administrative
privileges, so this is a reviewable application audit rather than tamper-proof
storage. It does not audit group transfers, initial record creation, guardian
grants (tracked separately), or changes to other columns.

For a disposable coach test, create a test athlete, correct its name once,
and verify one athlete event with the previous name, new name, signed-in coach
UID, and timestamp. Correct the account label separately and verify one parent
account event. A parent-only account should see no coach roster or audit rows.
Before deleting test data, remove its group enrollments, then the athlete and
account; delete the two disposable audit events administratively by the test
account ID after verifying their contents. Do not delete genuine audit history.
