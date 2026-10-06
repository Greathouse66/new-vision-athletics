// Kept independent of the runtime so email failures and role checks can be tested.
export async function inviteParent(request, { caller, admin, userId, publicOrigin, log = console }) {
  const respond = (status, code) => Response.json({ code }, { status });
  if (request.method !== "POST") return respond(405, "method_not_allowed");
  if (!userId) return respond(401, "sign_in_required");
  const role = await caller.from("coach_users").select("user_id").eq("user_id", userId).maybeSingle();
  if (role.error) return respond(503, "access_check_failed");
  if (!role.data) return respond(403, "coach_required");

  let body;
  try { body = await request.json(); } catch { return respond(400, "invalid_request"); }
  if (!body || typeof body.family_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.family_id) ||
      typeof body.email !== "string" || body.email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
    return respond(400, "invalid_request");
  }
  // A coach cannot supply a redirect or tokens. Use the configured public site only.
  let callback;
  try {
    const origin = new URL(publicOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password ||
        origin.pathname !== "/" || origin.search || origin.hash) throw new Error("origin");
    callback = new URL("/auth/callback.html", origin).href;
  } catch { return respond(503, "email_setup_required"); }

  const { data, error } = await caller.rpc("reserve_guardian_invitation_email", {
    p_family_id: body.family_id, p_email: body.email.trim().toLowerCase(),
  });
  if (error) {
    if (error.message === "Invitation email is still being sent") return respond(429, "send_in_progress");
    if (error.message === "Please wait before resending") return respond(429, "wait_before_resending");
    if (error.message === "This email already has family access") return respond(409, "already_linked");
    if (error.message === "Family not found") return respond(404, "family_not_found");
    if (error.code === "42501") return respond(403, "coach_required");
    return respond(503, "invitation_unavailable");
  }
  const reservation = data?.[0];
  if (!reservation) return respond(503, "invitation_unavailable");

  let sent = false;
  try {
    // SMTP creates a new Auth account and emails its one-time invitation link.
    const invitation = await admin.auth.admin.inviteUserByEmail(reservation.email, { redirectTo: callback });
    if (!invitation.error) sent = true;
    else if (invitation.error.code === "email_exists") {
      // Existing confirmed users need a fresh sign-in link, not another account.
      const signIn = await admin.auth.signInWithOtp({
        email: reservation.email,
        options: { shouldCreateUser: false, emailRedirectTo: callback },
      });
      sent = !signIn.error;
    }
  } catch {
    // Keep the approval for retry. Never log addresses, links, or Auth responses.
  }
  try {
    const result = await admin.rpc("finish_guardian_invitation_email", {
      p_attempt_id: reservation.attempt_id, p_sent: sent,
    });
    if (result.error) log.error("Invitation email status could not be recorded");
  } catch { log.error("Invitation email status could not be recorded"); }
  return respond(sent ? 200 : 502, sent ? "email_sent" : "email_failed");
}
