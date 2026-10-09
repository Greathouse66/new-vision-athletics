# Homepage drop-in requests

The homepage header, mobile menu, hero and closing call to action now link to
the existing `/parent/drop-ins.html` page with “Request a Drop-in.” These links
replace the homepage's Calendly “Book Now” links and stay in the same tab.
The Pay Now and Sign in links retain their existing destinations.

Signed-in parents use the existing athlete/class request form immediately.
Signed-out parents are sent to sign-in with an allowlisted return destination.
The email callback carries that destination in its query string, so it also
works when the email is opened on another browser or device. Ordinary sign-in
still opens the parent portal; verified coaches still open their dashboard.
Failed links preserve the destination when requesting another link, and a
failed role lookup cannot bypass coach/parent routing.

This continues to require an existing account and linked athlete. It does not
create a public enrollment form, reserve a seat without approval or bypass any
existing family-access, skill, capacity, notification or coach-approval rules.
No database migration or Edge Function deployment is needed.

## Supabase redirect configuration

Keep the existing callback redirect URL. Also allow this exact URL under
Authentication → URL Configuration → Redirect URLs:

`https://newvision-athletics.com/auth/callback.html?next=%2Fparent%2Fdrop-ins.html`

For a local or Netlify preview test, allow the same path/query on that exact
preview origin. Avoid broad redirect wildcards. Supabase may already accept
the production URL when its hostname matches Site URL, but adding the exact
URL makes the intended callback explicit and supports stricter configuration.

## Verification

- Run `npm run test:access` and `npm run build` on Node 22.
- Check all four homepage request links on desktop and mobile.
- A signed-in test parent should see only their linked athletes and eligible
  dated classes with space.
- A signed-out test parent should receive a link and return directly to the
  request page after clicking it. Test the email in another browser too.
- Submit one intentional test request and confirm the existing coach approval
  and notification flow, then clean up the test booking through coach tools.
- Ordinary sign-in and coach dashboard routing should retain their behavior.
