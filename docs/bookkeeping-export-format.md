# Bookkeeping export contract

Initial delivery: coach-authorized download for secure sharing with the bookkeeper.
No automatic email, integration or bookkeeper login is implemented.
Confirm final columns, reporting basis, period boundaries and file format with the bookkeeper.

## Proposed export tables
- athlete_monthly_charges: charge_id, family_account_id, athlete_id,
  service_month, currency, amount_minor_units, allocated_minor_units,
  outstanding_minor_units, status.
- transactions: transaction_id, transaction_type (payment/refund/fee/transfer),
  occurred_at, currency, amount_minor_units, method, provider_reference,
  related_transaction_id, reconciliation_status.
- allocations: allocation_id, transaction_id, charge_id, amount_minor_units.
- expenses (when implemented): expense_id, incurred_on, category, currency,
  amount_minor_units, receipt_reference.

Include a manifest: export ID, generated timestamp, period, business timezone, currency,
schema version and control totals. Preserve charge identifiers for matching.
Prefer family account IDs and billing names to unnecessary athlete data.
The coach's roster export needs one row per athlete and month with tuition
amount, allocated payment total, remaining balance, and paid/partial/unpaid
status. Keep payment transactions in a separate sheet or file so a payment
covering siblings is not counted twice. Confirm with the bookkeeper whether
athlete names are needed; use stable athlete IDs when names are unnecessary.

## Rules
Use explicit reporting windows and distinguish service month from money-received date.
Allocated totals must not double-count a payment split across athlete charges.
Do not count Venmo-to-bank transfers as new customer income.
Track gross payments, fees and refunds separately. Reconcile to provider/bank statements.
Prevent spreadsheet formula injection and quote/escape CSV cells properly.
Generate downloads server-side for authorized users; no public export URLs or repo files.
Re-exporting a period retains stable record IDs for deduplication by the recipient.
Approved makeup credits are operational records unless a separate financial adjustment occurs.
