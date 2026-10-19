# Invitation email delivery investigation

Scope reported by Will: **invitations only** land in spam. Other platform mail has not been reported as affected. Do not assume the shared sender is broken or that a visual redesign fixes filtering.

## Read-only findings — 2026-10-19

- The application sends new parent invitations through Supabase Auth `inviteUserByEmail`; existing confirmed users instead receive `signInWithOtp` with account creation disabled. Both use the current custom SMTP configuration. The worker does not provide replacement email HTML.
- Google's public DNS resolver returned NXDOMAIN for `_dmarc.newvision-athletics.com`; an independent Cloudflare lookup also returned NXDOMAIN. No public DMARC record was observed at that name at the time of inspection.
- A public `resend._domainkey.newvision-athletics.com` TXT key exists. Key presence alone does not prove that an affected invitation was DKIM-signed correctly.
- `send.newvision-athletics.com` resolves through a CNAME to `send.forge.rmta.net`, whose TXT answer contains an SPF policy. Compare this to the actual return-path and records currently required by the provider dashboard before changing anything. An unrelated or differently named return-path may be used; do not replace records based solely on an assumed default.
- No root TXT SPF answer was returned. This is not by itself evidence of an SPF failure: the SMTP envelope's actual return-path domain is what must be checked.
- Read-only metadata from the test parent's saved October 6 invitation showed **SPF pass and DKIM pass**, including a DKIM signature from `newvision-athletics.com`. Its actual return-path was on **`rsend.newvision-athletics.com`**, not `send`. The visible sender was **New Vision Athletics <no-reply@newvision-athletics.com>** and the subject was the generic **You've been invited**. No DMARC result was present in that message's Authentication-Results header. Do not infer an SPF problem from the unrelated `send` record above.
- That saved message is currently labeled INBOX; it does not establish present-day spam placement. Its body used the short default invitation text, contained both plain text and HTML, and had no tracking pixel in the inspected HTML. Current hosted templates and provider tracking settings still need comparison before changes.
- No DNS, SMTP, tracking or live template settings have been changed. No message labels were changed and no email was sent.

## Next evidence

From one affected Gmail invitation, use the message's More menu → **Show original**. Record only the visible sender address/domain, SPF result/domain, DKIM result/domain and DMARC result/domain, plus Gmail's spam explanation if shown. Do not copy the message body, magic-link URL, token, private athlete details or credentials into an issue or public repository. Avoid storing personal headers in Git.

In Resend, inspect the same invitation's delivery event and **Insights** checks, and compare the current domain verification records. A provider “delivered” event establishes acceptance by the receiving server, not placement in the inbox.

## Changes to review after the evidence

1. If the visible sender is on this domain, add an appropriate DMARC TXT record at `_dmarc` after checking for an existing record and other legitimate sending services. Start with `v=DMARC1; p=none;`; add aggregate reporting only to a mailbox or service the owner controls and monitors. Do not invent a reporting address. Do not move straight to quarantine/reject. A monitoring policy is a first step, not proof of improved inbox placement.
2. Correct actual SPF/DKIM or alignment failures using the exact current provider-required records. Do not add a second SPF policy at a hostname, delete unrelated mail records or tighten enforcement without validating all legitimate sources.
3. Inspect open/click tracking. Supabase recommends disabling email tracking for Auth links because rewriting can affect them. Resend recommends avoiding open tracking on transactional mail. If enabled, propose the precise change and explain the domain-wide scope before applying; no need to change an already-disabled setting.
4. Use a recognized, accurate sender name such as New Vision Athletics. Keep the verified sending address until an inspected problem justifies changing it. Only add a reply-to address that is actually monitored.
5. Apply the reviewed HTML/subject drafts from `supabase/templates` after comparing and backing up the hosted templates. Retain `{{ .ConfirmationURL }}`; branding does not require a backend change.
6. Test a fresh, expected invitation and inspect the new authentication results and spam placement. Compare to the earlier message. No setting guarantees inbox placement. Don't bulk resend to improve reputation, change mail providers as a first step, or mark messages on the user's behalf without authorization.

## Primary references

- Supabase templates, confirmation variables and tracking: https://supabase.com/docs/guides/auth/auth-email-templates
- Resend DMARC and staged rollout: https://resend.com/docs/dashboard/domains/dmarc
- Resend message-specific delivery insights: https://resend.com/docs/dashboard/emails/deliverability-insights
- Resend tracking and domain-wide scope: https://resend.com/docs/dashboard/domains/tracking
- Gmail Show original: https://support.google.com/mail/answer/29436
