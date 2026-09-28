# Bookkeeping export contract

Initial delivery: coach-authorized download for secure sharing with the bookkeeper.
No automatic email, integration or bookkeeper login is implemented.
Confirm final columns, reporting basis, period boundaries and file format with the bookkeeper.

## Proposed export tables
- invoices: invoice_id, family_account_id, service_month, issue_date, due_date,
  currency, billed_minor_units, paid_minor_units, outstanding_minor_units, status.
- transactions: transaction_id, transaction_type (payment/refund/fee/transfer),
  occurred_at, currency, amount_minor_units, method, provider_reference,
  related_transaction_id, reconciliation_status.
- allocations: allocation_id, transaction_id, invoice_id, amount_minor_units.
- expenses (when implemented): expense_id, incurred_on, category, currency,
  amount_minor_units, receipt_reference.

Include a manifest: export ID, generated timestamp, period, business timezone, currency,
schema version and control totals. Preserve invoice identifiers for matching.
Prefer family account IDs and billing names to unnecessary athlete data.

## Rules
Use explicit reporting windows and distinguish service month from money-received date.
Allocated totals must not double-count a payment split across invoices.
Do not count Venmo-to-bank transfers as new customer income.
Track gross payments, fees and refunds separately. Reconcile to provider/bank statements.
Prevent spreadsheet formula injection and quote/escape CSV cells properly.
Generate downloads server-side for authorized users; no public export URLs or repo files.
Re-exporting a period retains stable record IDs for deduplication by the recipient.
Approved makeup credits are operational records unless a separate financial adjustment occurs.
