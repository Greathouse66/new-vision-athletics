# Private portal visual preview

The public homepage and Pay Now page are not part of this styling change.
The existing auth, parent, and coach pages use the Stitch charcoal/aqua palette,
condensed headings, card spacing, and mobile navigation. Real pages still use
their existing Supabase data and access controls.

Run `npm run preview:design` locally, then serve `dist/` on port 8765 and open
`http://127.0.0.1:8765/design-preview/`. The preview command first runs the
ordinary build and then creates static copies of the private pages under
`dist/design-preview/`. They use clearly fictional sample data. The copies
remove their Supabase module scripts and cannot accept payments or change
records. Preview controls are visual only; page links stay within the local
preview where a counterpart exists.

The normal `npm run build` removes `dist/` and recreates only the approved
production pages. Netlify runs that normal build, so it does not publish the
local-only preview pages. Do not change the Netlify build command to the
preview command.
