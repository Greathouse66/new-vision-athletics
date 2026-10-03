# Internal billing reconciliation export

`20261001180500_billing_export_snapshot.sql` returns a single database snapshot
for a coach-selected month. The `billing-export` Edge Function requires a
signed-in coach and uses the caller-scoped client; it does not use a service
key. The coach tuition page requests the snapshot once, then offers four
downloads generated on the server: `charges.csv`, `payments.csv`,
`allocations.csv`, and `manifest.json`. No files are stored in the repository
or at a public URL. Keep the four files together when reviewing a period.

This is internal format `nva-internal-billing-v1`, not the bookkeeper's final
import. The final columns and software still need confirmation. It uses IDs
instead of athlete names and does not include billing contact emails.
`charges.csv` includes one row per athlete tuition charge for the selected
service month, including all allocations to that charge and its current
balance. `payments.csv` includes each Venmo payment received during the
selected **UTC** month once, even when it pays for siblings or another
service month. `allocations.csv` shows which charges those received payments
covered; an allocation can point to a charge in another service month.
The manifest states both bases, the generation time, row counts, and separate
USD cent totals. Do not add tuition and received payment totals together.
Transfers from Venmo to a bank are not customer payments in this ledger.

The database rejects periods larger than 5,000 rows of any type. The server
validates IDs, safe integer amounts, charge balances and that each payment's
allocations sum to its amount. It escapes CSV text and prevents spreadsheet
formula execution from a typed Venmo reference. A failed or incomplete
snapshot returns no downloadable files. Refunds, fees and accounting mappings
are absent; obtain the bookkeeper's requirements before using this as a
production import. A real reconciliation against Venmo/bank statements is a
separate operational step.

Apply the migration before deploying the function and publishing the updated
coach page. Deploy with `npx.cmd supabase functions deploy billing-export --use-api`.
An unsigned request must be denied; a signed-in non-coach must receive 403.
Review a synthetic sibling payment: two charge rows, one payment row, two
allocations and matching manifest totals. No real family's data is needed
for this check. The edge code's CSV and total rules also have a Node test.
