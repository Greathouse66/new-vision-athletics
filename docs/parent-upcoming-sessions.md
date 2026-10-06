# Parent upcoming sessions

The read-only `/parent/sessions.html` page shows a signed-in guardian the
athlete, class, Minot-local date and time, and saved venue for each confirmed
future seat. It links from `/parent/index.html`. It does not treat a skill-group
assignment as a booking. Cancelled seats and past classes are omitted.

Migration `20261003222000_parent_upcoming_sessions.sql` creates
`list_my_upcoming_sessions()`. That function checks the current guardian link
for every athlete's family before returning any row. It returns no coach IDs,
other athlete names, roster details, or internal request data. Raw booking and
class tables remain coach-readable only through the Data API. Removing a
guardian's access hides the family's upcoming sessions on the next request.

Times use each dated venue's `America/Chicago` IANA zone. The page shows at
most 200 upcoming sessions and labels that limit. A coach's confirmed manual
drop-in and a regular reservation appear the same way for the parent.

The page links to a checked drop-in request flow. A pending request does not
appear as a confirmed session until a coach approves it. The page cannot
cancel a place, change the venue, or send a message. A parent without accepted
athlete access is directed back to the
invitation list on My athletes. The SQL rollback test covers two families and
immediate revocation without retaining synthetic records.
