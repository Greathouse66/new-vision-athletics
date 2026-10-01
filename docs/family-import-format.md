# Family import contract

Header/field specification only; no sample or real data is committed.

| Field | Requirement |
| --- | --- |
| family_reference | Stable source ID for linking siblings; review before generating new IDs |
| guardian_name | Required |
| guardian_email | Required for proposed email access |
| guardian_phone | Optional; store as text with country code |
| athlete_reference | Stable source ID where available |
| athlete_name | Required |
| group_reference | Must match an approved group |
| enrollment_start | ISO date, required before roster generation |
| enrollment_end | Optional ISO date |
| secondary_guardian_name/email | Optional, separately verified before access is granted |

Import flow: upload privately, preview mappings, validate groups and contact fields,
flag duplicates and ambiguous family matches, obtain coach review, then commit.
Do not merge households by surname alone or treat a shared email as automatic permission.
Use a source/import identifier to make repeat imports idempotent.

Payments and opening makeup balances require separate reviewed imports with dates,
source references and reconciliation status. Do not infer payment from enrollment.
Invitations are a separate authorized action after records have been reviewed.
Keep all source and exported files outside Git and static publish output.

## Private preflight check

Export the coach-provided spreadsheet as CSV and put it in the Git-ignored
`imports/` directory (create that folder if needed). From the
repository root, run `npm.cmd run validate:roster -- imports/roster.csv` on
Windows. Use these exact field names as CSV headers. The validator checks
required fields, basic email syntax, dates, the three confirmed group names,
repeated athlete references and repeated guardian/athlete name pairs. It
prints only line numbers and field names; it does not print names or emails,
connect to Supabase, create users, grant access or change any records.

An `ERROR` causes a nonzero exit status. A `REVIEW` flag means a coach must
resolve a possible duplicate or source inconsistency; it is not an automatic
merge. Email syntax alone does not verify ownership or guardian authority.
The future reviewed import will need stable source references and explicit
coach approval before any database writes or invitation delivery.
