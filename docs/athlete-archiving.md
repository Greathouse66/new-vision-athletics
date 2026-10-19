# Archive and reactivate athletes

Coach workspace → Athlete roster → **Archive** beside the athlete. Confirm the name and scheduling explanation. The roster defaults to **Active athletes**; use **Archived athletes** to find someone and choose **Reactivate**. The selected account also shows status controls for each sibling individually.

Archiving is reversible. It updates only athlete status and writes a private server audit of the coach, time, and before/after athlete record. It does not delete the account, revoke parent access, change sibling status, erase history, or send email. Parent sign-in stays available. Parents can select Archived athletes on their dashboard, open published reports and signed waiver copies, and pay outstanding balances as before. Active dashboard counts and unsigned-waiver reminders exclude archived athletes. History screens identify archived athletes.

## Scheduling behavior

- Archived athletes cannot receive new coach drop-in bookings, new regular assignments, parent drop-in requests, or approval of a pending request. The server enforces this even from a stale browser tab. Pending requests remain available for coach review/decline.
- Existing confirmed seats are **not cancelled**. Review **Coach → Class places** and cancel individual seats if the athlete will not attend. Parents retain the normal cancellation controls. Historical attendance remains available.
- Existing weekly assignments and their reserved regular capacity remain intact. Automatic seat creation skips archived athletes when new dated classes are generated; it does not prevent other athletes' classes from being created. Schedule edits can still carry those assignments to a successor weekly class.
- Reactivating allows new bookings and resumes regular seat creation for **newly generated class dates** covered by the saved assignments. It does **not** backfill classes generated during the archive or restore cancelled seats. Review the returning athlete's group and class places.
- Archiving does not automatically assign, remove or refund tuition. Recorded charges, receipts and allocations retain their original values. Coaches can still settle or correct existing billing records using the existing tools.

## Rollout

Branch: `athlete-archive-reactivate`. Apply only `20261019160000_athlete_archiving.sql` after checking the Supabase dry run. Installation archives nobody. No new secrets, Edge Functions or Auth redirect configuration are needed for production. An isolated Netlify preview still requires its own approved callback URL and a fresh preview sign-in.

The migration adds `athletes.archived_at` and `archive_revision`, a coach-only `set_athlete_archived` RPC with expected revision and exact athlete-name checks, private audit storage, and server booking guards. Athlete read policies remain unchanged so archived history follows the existing family access boundaries. Browser name corrections retain their existing audit; raw client writes to lifecycle fields are denied.

Test before merging:

1. With the retained **Test Athlete**, note its balance, receipt, signed waiver, report and any confirmed sessions.
2. Archive from the preview coach roster. Verify it disappears from Active and appears under Archived. Other athletes stay active.
3. Refresh the parent preview: find the athlete under Archived, verify its documents and balances, and confirm it is absent from new drop-in choices. An existing session should stay visible until explicitly cancelled.
4. Reactivate from the coach preview. Verify it returns to Active and new drop-in choices. Check group/class places before a real return.
5. If testing automatic regular seats, use intentionally created test class dates: new dates generated while archived should omit the athlete; dates generated after reactivation should include them. Dates already generated during archive remain unchanged.

Validation: `npm run test:access`, the scheduling/report Node test suites, and `npm run build`. Browser review uses synthetic accounts and mocked API responses at desktop/mobile widths; it never archives a live athlete or sends a request/email.
