# Athlete waiver signing

## Parent workflow

Parents see an Athlete waivers reminder on their dashboard, plus a separate
status link on every athlete card. Open `/parent/waivers.html`, or use the link
for that athlete. Each athlete needs one signature for the current waiver
version. A guardian's signature for one child never completes a sibling's waiver.
Another linked guardian sees the same completed athlete waiver.

The participant name comes from the roster. The parent enters the date of birth,
parent/legal guardian name, emergency contact name and phone, reads the full
waiver, checks the acknowledgment and electronic-record consent boxes, and types
a signature matching the guardian name. Only a signed-in guardian with a verified
email and current access to the athlete's family can submit. Coaches do not sign
on a parent's behalf through the coach screen.

After signing, the parent can view the completed record and use **Print / Save
PDF** to retain a copy through the browser print dialog. This uses HTML printing,
not a fillable PDF upload or an external signature provider. The print action
rechecks current database access before showing the saved copy. Signed records
also appear in history. Dashboard statuses refresh on page load; there are no
email reminders in this change. Sessions, requests, payments and registration
retain their existing behavior; an unsigned waiver does not block these actions.

## Coach workflow

**Coach Dashboard → Athlete waivers** shows counts of completed waivers and those
needing a signature. The athlete roster also links to this page. At
`/coach/waivers.html`, filter by completion status, select an athlete, and open
current or historical signed records. The saved copy includes emergency contact
information and can be printed/saved through the same action. Coaches cannot edit,
forge, replace or delete a parent's signed record.

## Source and electronic record

The original company name, title, four liability clauses and acknowledgment
are transcribed from the supplied `Newvision_Liability_Waiver.pdf`. The body and
acknowledgment were checked against extracted PDF text after normalizing whitespace.
The separately labeled electronic consent is new UI/record content. The original
uploaded PDF is not modified. This feature records typed-name signatures; it does
not collect a drawn signature or claim to provide legal review of the source form.

The database captures the verified Auth user ID/email, roster participant name,
entered participant/contact details, typed signature, both accepted statements,
and server timestamp. The exact version text is copied into the signature record,
with a SHA-256 hash of the company, title, waiver body, acknowledgment and electronic
consent joined with newline separators. The hash describes the document text,
not a cryptographic signature of the signer. Each record has a permanent UUID.
No client-provided signing time, signer email, participant name or document text
is accepted by the signing RPC. Auth user IDs/emails are snapshots rather than
cascading references, so deleting an Auth identity cannot delete signed evidence.

`athlete_waiver_signatures` has authenticated SELECT only, with RLS for active
coaches or current linked guardians. No browser can insert/update/delete records
directly. A checked security-definer function accepts signing input, locks current
identity/access/version rows, validates consent and fields, and saves once per
athlete/version. An identical retry returns the original ID. Different data or
another guardian cannot overwrite a completed waiver. Version wording and signed
records have mutation guards; a new version is required for corrections.
Revoked family or coach access blocks future reads. Existing copies already
viewed, printed or saved cannot be recalled.

## Future revisions and corrections

There is no coach waiver editor or record-deletion control. An administrator must
review and publish a new `waiver_versions` row, switching `is_current` in the same
transaction. Do not edit existing wording or disable record guards. A new version
changes the affected dashboard status to Needs signing without altering old
signatures; signed history remains readable to authorized users. No automatic
annual expiry is assumed. Review errors/corrections through a new version before
asking a parent to sign again.

## Deployment

1. Fetch and switch to `athlete-waiver-signing`. Preserve existing local work.
2. Run `npm.cmd ci`, `npm.cmd run test:access`, and `npm.cmd run build` on Node 22.
3. Run `npx.cmd supabase db push --dry-run`. The new migration is
   `20261018210000_athlete_waivers.sql`. Review unrelated pending migrations separately.
4. Apply with `npx.cmd supabase db push` before publishing the website.
   The migration creates the version and empty signature tables; it does not sign
   waivers, message parents, or change existing athletes/schedules/payments.
5. Review the deploy preview after the migration, then merge/publish the reviewed
   PR. No Edge Function, Storage bucket, email worker, Auth setting, or secret is
   required. The preview uses the same database, so signatures made there are real
   records and remain immutable. Use an intentional test athlete and real authorized
   signer; do not submit a fabricated agreement for a real athlete.

If the page deploys before the migration, existing dashboards retain athlete,
session and tuition access while displaying waiver status as unavailable.
The waiver page itself fails closed until its database functions exist.

## Validation

Run the full related suite:

```powershell
node --test tests/access/*.test.mjs tests/scheduling/*.test.mjs tests/reports/*.test.mjs
```

`tests/access/athlete-waivers.test.mjs` runs real PostgreSQL functions/RLS in a
disposable PGlite database. It covers per-athlete completion, verified identities,
family isolation, direct-write denial, mandatory fields and consents, immutable
snapshots, retry behavior, revocation, current version checks and signed history.
Browser review uses mocked APIs for desktop/mobile signing, dashboard reminders,
coach read-only views, printing, stale-version errors and revoked read access.
No live agreements or emails are created by automated checks.

For live review, confirm two athletes initially show Needs signing. Have a linked
parent intentionally complete one test athlete's waiver. Check the guardian name,
emergency details, signature, verified email, signing time and text in both
portals; the sibling should still need signing. Retain a PDF using the browser
print dialog. Refresh the dashboard to verify counts and per-athlete links.
