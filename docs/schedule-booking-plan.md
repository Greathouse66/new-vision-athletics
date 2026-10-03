# Weekly classes and drop-in booking plan

Status: schedule agreed; venue selection, regular rosters, and parent request
flow are not yet loaded or published. No athlete data belongs in this file.

| Day | Local time | Class | Capacity |
| --- | --- | --- | ---: |
| Monday | 6–7 pm | Post-Bigs | 10 |
| Monday | 7–8 pm | Advanced | 10 |
| Tuesday | 6–7 pm | Foundational | 10 |
| Wednesday | 6–7 pm | Post-Bigs | 10 |
| Wednesday | 7–8 pm | Advanced | 10 |
| Thursday | 6–7 pm | Foundational | 10 |
| Friday | 6–7 pm | Intro | 10 |
| Friday | 7–8 pm | Advanced | 10 |

Target first week: Monday, October 5, 2026. Times are in
`America/Chicago`, which handles the change between CDT and CST. The coach
will choose Minot Armory or Minot YMCA for each week. Each dated class must
store its actual venue, so a later week can use the other facility. Intro is
a class type; the three skill groups remain Foundational, Post-Bigs, and
Advanced. An athlete has one assigned skill group at a time but can have
approved class bookings at another level.

`20261003211000_weekly_class_venue.sql` adds the weekly venue choice, an
explicit dated-class venue, the Intro class type, and a database cap of 10.
It creates no venues, standing slots, dated classes, athlete bookings, or
email messages. A coach can choose a week's venue only after the two
`class_locations` records have been reviewed and created. The venue default
cannot be changed through the coach function after dated classes exist;
changing a published venue needs an audited correction and notification path.

Next booking implementation:

1. Coach identifies which athletes have a regular place in each weekly slot.
   Others may request a specific dated class as a drop-in. A regular roster
   is separate from skill-group assignment; cross-level attendance is allowed.
2. Generate dated classes only for open days after holiday and closure review.
   Copy the week's chosen venue to each dated class and save its exact local
   start/end instants using the venue's named time zone. Coach may need a
   checked per-class venue correction if facilities change midweek.
3. Parents request one dated drop-in through a simple form, including families
   without portal access. Verify the parent contact by secure emailed link
   before the coach sees a request as verified. A request does not reserve a
   seat. Keep the public endpoint disabled until sender/domain, throttling,
   and abuse controls are tested.
4. Coach approves a verified request. In one transaction, lock the dated class,
   count confirmed regular and drop-in places, and confirm only when fewer than
   10 are occupied. Full classes remain pending or waitlisted. Cancellation
   releases only that dated seat and preserves an audit trail.
5. Show a family's confirmed upcoming sessions in its parent portal. A secure
   action link can handle a simple cancellation without requiring a portal
   sign-in on every interaction.

The handwritten photos contain athlete names and tentative class lists, but
no verified guardian contacts or regular-versus-drop-in decisions. Keep the
private review roster in the ignored `imports/` folder, not Git or `dist/`.
