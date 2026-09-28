# Setup and handoff

## Existing public site
1. Clone the GitHub repository.
2. Use a feature branch for changes.
3. Serve the root with `python -m http.server 8000`.
4. Visit the homepage and `/Pay-Now.html`.

No package manager, backend server or application test command is configured yet.
Portal folders contain only placeholders. Opening /coach/ or /parent/ is not a working portal.

## Netlify
Use the existing connected Netlify project and preserve its current production branch,
build and publish settings for this foundation. Confirm the linked owner is Greathouse66.
Review pull requests before merging into main, which may trigger production deployment.
Check homepage, responsive images, navigation and payment page after deploys.
A deploy ZIP is a published snapshot, not a replacement for source history.

## Before building portals
Complete M2 in the roadmap. Define a public-only publish boundary before adding backend
implementation, then document real runtime commands and provider configuration here.
The .env.example contains proposed names only and is not loaded by the current website.
Keep server credentials out of client bundles. Use separate test and production services.

## Before real family data
Implement verified access and family isolation; policy review; tested backups/recovery;
transaction and notification integrity. Import through a reviewed private process.
No real records or sample seeds belong in this foundation change.
