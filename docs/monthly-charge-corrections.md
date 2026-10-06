# Correcting an unpaid monthly tuition amount

`20261001173500_monthly_charge_corrections.sql` adds a coach-only checked
function and correction history. The coach chooses a charge for the selected
month, enters the corrected USD amount and a reason of 10–500 characters,
and confirms the old and new amounts. The change and history entry commit
together. Parents see the corrected amount in their private billing summary
on the next request; the correction reason stays coach-only.

The function locks the charge row and refuses a correction if any payment
allocation exists. Payment confirmation locks that same row, so a concurrent
confirmation and correction cannot use different amounts. A charge with an
applied payment needs a separate reviewed adjustment or refund workflow;
the coach must not delete and recreate it. The original charge ID and
assignment details remain stable. Browser roles still have no direct write
privileges on charge or correction tables. Administrative database-owner
edits outside this function are not covered by this application audit.

Apply the migration before publishing the updated `/coach/billing.html`.
Verify with a disposable unpaid charge: correct it once, check the old/new
amounts, reason, actor and date in `monthly_charge_corrections`, and confirm
that the parent summary displays the new amount. A parent-only identity must
be denied the function and audit table. Once a payment allocation is present,
the function must reject further changes. Use a rollback-only SQL transaction
or remove only the synthetic data after testing; do not change real tuition
without Emery's reviewed amount.
