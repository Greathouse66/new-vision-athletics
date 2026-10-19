# Removing accidental athletes and accounts

Open **Coach Dashboard → Athletes → Review account**, or select an account
under **Review parent account** on `/coach/records.html`.

- **Delete athlete** reviews only that athlete. The family account, siblings,
  and parent access remain in place. An empty account is kept until the coach
  explicitly reviews and deletes it separately.
- **Delete account** reviews the account and every athlete it contains. It
  works for unused solo/shared accounts and empty accounts. All affected
  athlete names are listed before confirmation.

Review the listed names and group assignment count. Type the exact selected
athlete/account name, then select **Permanently delete**. Cancel writes nothing.
This cannot be undone from the portal. Supabase Auth users are never deleted;
this action does not send email or change another account.

Any monthly charge (including zero/corrected charges), regular assignment
(including ended terms), seat (including cancellations/attendance), drop-in
request (including declined requests), report (including drafts), or signed
waiver blocks removal of that athlete and its whole account. These records
must remain intact. The form lists the blockers and offers no force override.

Whole-account deletion is also blocked by current parent membership, any
invitation (even expired/revoked), parent access history, billing contact
history, or payment receipts. Athlete-only cleanup can still remove an unused
accidental sibling while preserving the linked family and its history.

The database rechecks coach membership, the exact name, selected IDs, and a
review fingerprint inside the deletion transaction. Changes since review
require a fresh review. Family/athlete row locks protect the dependency check;
foreign keys remain a final guard. Unexpected dependencies roll back the
entire operation, including group cleanup and the audit insert. Browser roles
retain no direct DELETE privileges on families, athletes, or enrollments.

Only the reviewed athletes and their group enrollments are removed, plus
the account itself when explicitly selected. A private audit retains the
coach ID, server timestamp, original account/athlete rows and group enrollment
snapshot. Existing name-correction audit records remain. These snapshots are
not included in the website build or exposed through a browser audit API.

## Rollout and review

Branch: `coach-delete-unused-account`. Run the linked project's database dry
run from that branch. Expected migration:
`20261018230000_coach_delete_unused_accounts.sql`. Apply only reviewed pending
migrations. Installation creates support functions/audit tables and deletes
no records. No Edge Function deployment or new environment variables are needed.

Use the Netlify PR preview after applying the migration. Allow that preview's
exact `/auth/callback.html` URL in Supabase Auth Redirect URLs, retain the
production Site URL, and request a fresh coach sign-in email from the preview.

The preview uses the real linked database. Review blockers on real accounts
without deleting them. For a manual deletion test, use only an intentionally
created disposable athlete/account with no parent links or operational history.
Verify athlete-only deletion keeps siblings, then separately review account
cleanup. Confirm a linked/used account shows blockers and no delete form.
Approve the preview before merging to production.

Validation: `node --test tests/access/*.test.mjs tests/scheduling/*.test.mjs tests/reports/*.test.mjs`
includes isolated PostgreSQL-compatible deletion tests, access checks and
existing feature regressions. Mocked browser checks cover desktop/mobile
confirmations, cancellation, blocked/stale/failed review, busy controls,
sibling preservation, successful refresh, and parent denial. They do not
delete live data or prove multi-connection database concurrency.
