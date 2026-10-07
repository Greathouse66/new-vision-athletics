# Experimental homepage redesign

This branch began as a local, non-permanent concept based on Will's first desktop
Stitch reference, “Direction 1: Elite Dark Court.” The mobile Stitch HTML was
incorporated as a second visual reference, preserving the desktop concept.

## Final approval — October 7, 2026

Will reviewed the desktop and mobile screenshots, requested the desktop Contact
Us navigation adjustment, then reviewed the working local browser preview and
confirmed that the links worked. In response to the question asking for final
design approval and authorization to merge into main and deploy, Will said:
“yes I approve this final design”. This authorizes release of this reviewed
homepage version. Approval does not extend to unrelated functional or platform
changes or automatically approve future redesign concepts.

Release scope: `index.html`, `index.css` and this workflow/review record only.
Original assets, authentication, Supabase, payment/booking destinations, portal
code and Netlify/build configuration remain unchanged. GitHub/Netlify release
checks will use the current main branch and this exact reviewed source.

## Direction 1 implementation

| Stitch reference | Existing homepage | Presentation changes |
| --- | --- | --- |
| Sticky dark navigation | Header and mobile menu | Original logo, translucent dark bar, cyan buttons; Sign in stays visible on phones |
| Split hero and photo | `#hero` and animated heading | Condensed heading, dark/cyan gradient, two button treatments, original responsive court photos in a bordered frame |
| Impact strip | Existing coaching themes | Skill-building, discipline, mentorship, character and growth; no invented performance claims |
| Coach portrait and story | `#about` | Original Emery portrait, existing biography and three original statistics in dark cards |
| Three coaching cards | `#features` | Original SVG icons, titles and descriptions with cyan/amber accents |
| Testimonial cards | `#testimonials` | Existing quotes and avatars; no invented star ratings |
| Booking call to action | Existing booking section | Large headline and cyan booking button using the specific coach Calendly URL |
| Dark footer | Existing footer | Original logo, destinations and legal text; `#plans` gets an alias at the existing training section |

Only `index.html` and `index.css` implement the concept. Homepage styles are scoped
under `.stitch-concept`; no generated application framework or Material Symbols
dependency was added. Barlow Condensed and Space Grotesk match the reference's
typography. All original inline scripts remain byte-for-byte identical.

The mockup's placeholder logo/photos, generic Calendly URL, fictional program
labels, expanded coaching claims and star ratings are excluded. The original
headline still types and loops, so it does not exactly match the mockup's static
two-line heading. The original contact modal is retained and visually restyled;
Stitch's replacement mailto link is excluded. Original assets remain unchanged.

## Mobile Stitch implementation

| Mobile reference | Existing section | Adaptation |
| --- | --- | --- |
| Compact sticky header | `site-header`, `mobileMenu` | Original logo, visible Sign in and existing menu toggle; safe-area spacing |
| Headline → image → buttons → stats | `#hero` | 44px headline, 288px original court-photo frame, full-width rectangular buttons and three stat cards |
| Heading → portrait → biography | `#about` | Existing heading above original Emery portrait; original biography in a compact card |
| Compact coaching card stack | `#features` | Existing SVG icons beside 22px titles; original descriptions beneath |
| Compact testimonial stack | `#testimonials` | Original quotations, names, roles and avatars; amber quote accent replaces unverified stars |
| Booking/contact card | Existing closing CTA | Mobile-only Contact Us button invokes the existing contact trigger; booking URL unchanged |
| Centered dark footer | Existing footer | Original logo reference, navigation destinations and exact legal text |

Phone composition applies at widths up to 600px. Small HTML wrappers permit CSS
to reorder the hero and coach sections without duplicating interactive controls,
IDs or content. Desktop styling remains in place. Tablet contact access remains
available. Existing scripts are unchanged, and no generated application code,
backend code or new icon dependency was introduced.
The phone hero reuses the original wider `Desktop-hero.jpg` in its short frame so
the coach and athletes remain visible. The original portrait-format mobile photo
is retained unchanged in the assets folder and in the baseline homepage.

Excluded from the mobile reference: placeholder NV branding/photos, fabricated
coach quotation, biomechanics/performance claims, rewritten testimonials,
shooting-percentage and scholarship claims, review locations/class year, ratings,
nonfunctional buttons and new footer hash routes. The original viewport permits
pinch zoom; the generated `user-scalable=no` and `maximum-scale=1.0` were not copied.
Full original stat labels and the existing coaching themes remain visible.

Mobile validation: the Node 22 build and browser checks passed at 1440, 901, 768,
600, 390, 375 and 320 pixels. Checks cover overflow, hero and coach section order,
Sign in visibility, navigation/action spacing, mobile menu toggling, and opening
and closing the original contact form from the new mobile button. Original script
blocks, required hooks, links, form configuration and asset files were compared
again and remain intact. No real form submission or account action was performed.
The completed desktop screenshot matches the previous desktop concept pixel for
pixel; the mobile adaptation did not alter its rendered layout.
Screenshots pause browser timers after the existing headline finishes typing;
this is a preview-only capture step, not an application animation change.

## Local validation — October 7, 2026

Header revision requested by Will: Contact Us now follows Testimonials in the
desktop navigation. Only Sign in and Book Now occupy the desktop action group.
The existing modal trigger and scripts are unchanged. Compact desktop spacing
keeps both action buttons visible, and tablet contact access remains available.
The build and browser checks passed at 1440, 901, 768, 390 and 320 pixels, including
navigation/action separation and contact-modal open/close. This revision does not
constitute final design approval or authorization to push, merge or deploy.

- Existing `npm run build` passed using Node 22. No build, package, Netlify,
  database, authentication, payment or portal files were changed.
- Compared all original script blocks, anchor destinations, form action/method,
  field attributes and IDs against `main`. Original scripts and form settings
  match exactly, and every original link and required hook remains.
- Browser checks passed at 1440, 768, 390 and 320 pixels: no horizontal overflow,
  visible Sign in, mobile menu toggle and desktop/tablet contact form open/close.
  The built sign-in page renders its email field; coach, parent and payment pages
  remain in the build. No real form submissions, emails or account actions occurred.
- Original local photos and both reference font families loaded in the browser;
  no JavaScript errors occurred. Desktop and phone screenshots were visually
  reviewed. Review artifacts are in ignored `build/homepage-review/`.
- The original CodePen logo host returns a Cloudflare block to this environment.
  The original logo URL remains intact; screenshots show its alt text. Logo
  rendering still needs a check from an environment that can reach that host.
- Preview screenshots use local caches of the CDN scripts and fonts to avoid
  external browser loading problems. These caches are ignored review artifacts;
  production resource URLs and original assets were not replaced.

To preview this checkout locally: `npm ci`, `npm run build`, then
`python -m http.server 8767 --directory dist` and open `http://localhost:8767`.
Use the Node 22 version specified by the project. This command serves the local
concept only and does not publish or deploy it.

## Isolation and approval

- Branch: `homepage-stitch-redesign`, created from clean `main` at
  `75347bdd2846856d4c255d7f3edf395993ff8801` (merged cancellation notifications).
- Work in this separate checkout. Leave earlier worktrees, staged files and
  original implementations intact. Do not reset, stash or discard existing work.
- Keep concept commits focused, reversible and limited to the public homepage.
- Do not merge into a production branch, publish the official homepage, delete
  the old implementation, or make irreversible Git changes before Will explicitly
  approves the final design. Approval is not implied by a mockup or revision request.
- Keep previews local until an external preview is explicitly requested. No
  redesign branch has been pushed or deployment triggered during preparation.

## Before implementing each mockup

Compare the mockup against the current homepage and explain:

1. Which sections correspond to the existing header, hero, coach biography,
   coaching benefits, testimonials, booking call to action, footer and contact form.
2. Which HTML and CSS changes are needed, and which original assets fit the layout.
3. Which functional hooks, routes and form behavior must be protected.
4. Which placeholder images, invented content or generated architecture should
   not be copied literally.

Stitch is a visual reference, not authority to replace the application's
architecture. Multiple concepts can be compared, combined, revised or rejected.
Implement presentation changes incrementally; preserve functionality if visual
fidelity conflicts with it, and explain the conflict before changing behavior.

## Preserve the baseline

- Preserve content, navigation destinations, registration/booking links, Sign in
  (`/auth/sign-in.html`), `/Pay-Now.html`, parent and coach routes, existing URLs,
  authentication, Supabase, Netlify configuration, JavaScript behavior and payments.
- Much of the homepage behavior is inline in `index.html`. Protect `site-header`,
  `logo-link`, `mobileMenu`, `typed-hero`, `headerContactBtn`,
  `floatingFormContainer`, `contactForm`, section anchors, event handlers and any
  other IDs/data attributes/hooks identified during implementation.
- Preserve the Basin contact form action, POST method, required fields named
  `Name`, `Email` and `Message`, and open/close/submission behavior. Do not send
  test messages through the real form while previewing a visual concept.
- Reuse the current logo reference and original images at existing paths:
  `Assets/Images/Desktop-hero.jpg`, `Tablet-hero-IMG.jpg`, `Mobile-hero2.jpg`,
  `Headshot-Em.png`, and the original testimonial avatars. Keep other existing
  images and branding assets intact. Do not delete, rename, move or modify originals
  to experiment, or duplicate assets without a reason.
- Scope changes to layout, typography, spacing, responsive styling, section
  composition, hierarchy, cards, buttons, backgrounds and image presentation.
- Do not change backend/database/auth code because generated HTML uses a
  different framework or structure. Existing defects are separate from a visual
  concept and do not authorize unrelated fixes.

## Review loop

Implement on this branch → run the existing `npm run build` → preview locally →
review desktop/mobile screenshots and browser behavior → iterate → explicit final
design approval from Will → only then discuss merge and deployment.

Before handing off each stage, check the branch, working tree and diff; confirm
the original asset files and protected functionality remain intact. Do not assume
a concept is final or automatically merge/publish it.
