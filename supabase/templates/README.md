# Branded Auth email drafts

These are **review drafts**, not live Supabase configuration. No email has been sent or template replaced. No `config.toml` wiring is added. A website build, Git merge, `supabase db push` or Netlify deployment does not install them into hosted Supabase Auth.

| Supabase template | HTML file | Proposed subject |
| --- | --- | --- |
| Invite user | `invite.html` | Your New Vision Athletics Parent Portal invitation |
| Magic Link | `magic-link.html` | Your New Vision Athletics sign-in link |

The Invite user copy explains the existing two-step parent workflow: authenticate with the email link, then select **Accept access** in the Parent Portal. It does not claim that sending an email grants family access. New parent invitations use Invite user; an already-confirmed parent's invitation uses Magic Link. Magic Link is role-neutral because coaches also use it.

The invitation draft assumes a parent invitation. Supabase's Invite user template is project-wide; review this wording if inviting coaches through the Auth dashboard as well.

Both templates retain `{{ .ConfirmationURL }}` unchanged in the primary button and fallback link. No fixed portal URL replaces authentication, no custom token flow is introduced, and no redirect allow-list or SMTP credentials change. The branded layout uses system fonts, inline table-based styling, a 560px fluid card, a 52px button and mobile padding. There are no image downloads, third-party fonts, marketing links or tracking pixels. The markup is about 4–5KB per template.

## Review and install after approval

1. In Supabase Authentication → Email templates, copy the current **subject and entire HTML** for Invite user and Magic Link to a safe local backup. These live versions have not been inspected by the draft author; compare them before replacing any custom wording.
2. Review the drafts at desktop and phone widths. Browser screenshots are approximations; Gmail and Outlook delivery must be checked separately.
3. After Will approves, replace only the corresponding subjects and HTML in the hosted dashboard. Keep the existing SMTP sender, credentials, Site URL, redirect allow list and Auth settings unchanged unless a separate, evidence-backed correction is approved.
4. Use one controlled test invitation to a verified test recipient and a separately requested magic link. Confirm each link reaches the correct dashboard and parent access still requires **Accept access**. Do not resend broadly to real families.
5. If needed, restore the backed-up subjects and HTML. No database rollback is required.

See `docs/auth-email-deliverability.md` for the invitation spam investigation. Better presentation alone does not establish or repair inbox placement.
