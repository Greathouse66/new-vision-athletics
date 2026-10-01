# Coach workspace

`/coach/index.html` is the private starting page for the existing roster, skill
group, and parent access tools. It displays exact counts of athletes, parent
accounts, active skill groups, and dated classes. Each count comes from the
signed-in coach's Supabase session and existing row-level security policies;
the page never embeds a server key or lists family details in public HTML.

The browser checks `coach_users` before displaying the links or querying
counts. Database permissions remain the access boundary for every linked page.
An ordinary signed-in parent sees the no-coach-access message. The page is in
the Deploy Preview build and has no public website navigation link.

This page does not create class schedules or show a Today roster. With the
current empty scheduling tables, the dated-class count is zero. It neither
assumes a class weekday nor derives a local date from the coach's device.
When confirmed venue and class details are available, implement occurrence
generation and bookings before adding attendance controls.
