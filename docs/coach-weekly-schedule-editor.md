# Weekly schedule editor

Open **Coach Dashboard → Classes & requests → Weekly schedule & venue →
Edit weekly schedule**. The page is `/coach/schedule.html`.

1. Select an existing weekly class or **Add a new weekly class**.
2. Choose the class level (including Intro), day, Minot local start time,
   duration, and capacity. The existing maximum remains 10 athletes.
3. Set **Changes begin on**. The earliest allowed date is shown below the
   fields. Dates before today or before the selected version begins are
   refused. Changes must also begin after the last class already created for
   the original weekly slot and the destination weekday.
4. Review the confirmation and save. Select the week containing the effective
   date to review its new rules. Before that date, the previous rules apply.
5. Save the week's venue, select confirmed open dates, then create dated
   classes. Saving a weekly rule alone creates no sessions or email messages.

The editor never changes saved dated classes, seats, attendance, balances,
drop-in requests, or athlete skill-group assignments. Existing regular weekly
rosters continue into the revised class from the effective date, including
future-starting assignments. An assignment added later follows any scheduled
versions automatically. Existing saved parent sessions retain their original
time, class label, and venue. Newly created dates use the new version.

Because each open day is generated as a complete set of classes, a new rule
cannot be inserted into an already-generated day. To change a saved dated
class itself, use a separate reviewed correction process. The editor also
does not delete weekly classes or notify parents of template changes.

A planned version with no dated classes can be corrected at its own start
date. Otherwise saving creates a successor version and closes the prior
version at the effective date (exclusive). Latest versions are offered for
editing; the selected week's preview includes the version effective on each
actual day. A private audit records the coach, server time, previous/new
rule, effective date, and number of assignments carried forward.

## Rollout

Review branch `coach-weekly-schedule-editor` before merging. The migration
adds fields, private audit/state tables, and coach-checked RPCs. Installation
does not revise existing rules or create dated classes. No Edge Function,
email configuration, or new environment variables are required.

Run `npx.cmd supabase db push --dry-run` from the updated branch. Expected
migration: `20261018220000_coach_weekly_schedule_editor.sql`. Review pending
migrations before applying with `npx.cmd supabase db push`.

Use the Netlify PR preview after the migration. Add its exact
`/auth/callback.html` URL to Supabase Auth redirect URLs, keep the production
Site URL, and request a fresh coach sign-in link from that preview.

Review the editor and week preview first. A preview uses the linked database:
saving a rule or creating dated classes there changes real scheduling data.
Use only an intentionally approved future rule/date for a manual write test.

Verify the effective week's preview, unchanged earlier dates, regular roster
carryover, and the parent session list. A second browser with stale data
must reload before saving a changed rule or generating classes. A parent
must not see the coach form or call its RPCs. Publish after review.

## Validation

`node --test tests/access/*.test.mjs tests/scheduling/*.test.mjs tests/reports/*.test.mjs`
checks access isolation and scheduling/report regressions. Schedule-specific
cases cover date cutoffs, historical booking preservation, roster/version
chains, atomic capacity failures, conflicting edits, weekend dates, and
Minot daylight-saving gaps/folds. These use isolated PGlite, not live data.

The build and mocked desktop/mobile browser review check editor interaction,
confirmation cancellation, effective-week rendering, venue save requirements,
weekend generation, stale errors, and parent denial. Real Supabase deployment
and concurrent multi-session behavior still require rollout verification.
