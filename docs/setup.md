# Setup and handoff

## Existing public site
1. Clone the GitHub repository.
2. Use a feature branch for changes and run `npm.cmd install` on Windows.
3. Run `npm.cmd run build`; Netlify serves only `dist/`.
4. For a local preview, run `npx.cmd --yes http-server .\dist -p 8765 -c-1`
   and open the URL that the server prints. Visit `/` and `/Pay-Now.html`.

The parent sign-in and family summary, coach workspace, parent access, athlete
roster, and group management are working preview routes. The browser build reads
`NVA_SUPABASE_PUBLISHABLE_KEY` from its
environment. See `parent-sign-in.md` for configuration and access boundaries.

## Netlify
Use the existing connected Netlify project and preserve its current production branch,
build and publish settings for this foundation. Confirm the linked owner is Greathouse66.
Review pull requests before merging into main, which may trigger production deployment.
Check homepage, responsive images, navigation and payment page after deploys.
A deploy ZIP is a published snapshot, not a replacement for source history.

## Before adding server features
Complete the open M2 decisions in the roadmap. The current public-only build
does not make `backend/` executable. Choose a runtime before adding server code.
The build does not automatically load `.env`; set the public key in the shell
locally or in Netlify's build environment. Keep server credentials out of client
bundles. Use separate test and production services when adding server features.

## Before real family data
Implement verified access and family isolation; policy review; tested backups/recovery;
transaction and notification integrity. Import through a reviewed private process.
No real records or sample seeds belong in this foundation change.
