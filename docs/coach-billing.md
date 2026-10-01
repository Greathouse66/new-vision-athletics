# Coach monthly tuition view

`/coach/billing.html` is linked from the private coach workspace. It loads the
athlete roster and the chosen month's charges with the signed-in user's
Supabase client. The existing RLS policies restrict reads to coaches. A parent
or another signed-in account cannot see the page's billing data.

Emery chooses the month, athlete and USD tuition amount. The page converts
decimal dollars to exact cents
before calling `assign_monthly_charge`. It displays each athlete's charge,
amount allocated, and derived remaining balance. After the correction migration
is applied, a coach can correct an unpaid amount with a recorded reason and
review its recent correction history. A charge with any allocated payment
cannot be changed by that action; see `monthly-charge-corrections.md`.

There is no operational **Mark paid** control on this page yet. Emery verifies
Venmo separately, but a live confirmation should wait for reviewed billing
contact emails, delivery worker, and coach confirmation UI. The private
outbox stores payment events but does not send messages. No tuition is inferred
from group or class scheduling.

The local build includes the page. Test the no-coach-access state using the
existing test login. For a temporary coach test, create only synthetic athlete
records and a test charge, then remove the records and role; do not assign
tuition to real athletes until Emery confirms the amount. The
page requires the billing action migration already applied to the project and
the new USD-only billing migration.

An internal export section is prepared after the export snapshot migration and
function deployment. It offers separate charge, payment and allocation CSVs
plus a control-total manifest for a selected month; see
`internal-billing-export.md`. It does not send records to a bookkeeper.
