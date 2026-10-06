import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");
const list = document.querySelector("#requests");
const notificationForm = document.querySelector("#notification-form");
const emailEnabled = document.querySelector("#email-enabled");
const notificationStatus = document.querySelector("#notification-status");
const saveNotifications = document.querySelector("#save-notifications");
let busy = false;

async function loadEmailPreference() {
  const { data, error } = await supabase.rpc("my_drop_in_email_preference");
  if (error || !data?.[0]?.email) {
    notificationStatus.textContent = "Email notifications are unavailable. Your coach sign-in email must be verified.";
    return;
  }
  document.querySelector("#notification-email").textContent = `Send to: ${data[0].email}`;
  emailEnabled.checked = data[0].enabled;
  emailEnabled.disabled = saveNotifications.disabled = false;
  notificationStatus.textContent = data[0].enabled ? "Email notifications are on for new requests." : "Email notifications are off.";
}

notificationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saveNotifications.disabled) return;
  emailEnabled.disabled = saveNotifications.disabled = true;
  try {
    const { error } = await supabase.rpc("set_my_drop_in_email_preference", { p_enabled: emailEnabled.checked });
    if (error) throw error;
    await loadEmailPreference();
  } catch {
    notificationStatus.textContent = "Could not confirm your email preference was saved. Reload before trying again.";
    emailEnabled.disabled = saveNotifications.disabled = false;
  }
});

function when(instant, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

async function decide(entry, approve) {
  if (busy || !window.confirm(`${approve ? "Approve" : "Decline"} ${entry.athlete_name}'s drop-in request for ${entry.class_label} on ${when(entry.starts_at, entry.time_zone)}?`)) return;
  busy = true;
  for (const button of list.querySelectorAll("button")) button.disabled = true;
  let message;
  try {
    const { error } = await supabase.rpc("review_drop_in_request", {
      p_request_id: entry.request_id, p_approve: approve,
    });
    message = error
      ? error.code === "23514" ? "Class is full. Decline the request or free a seat first."
        : error.code === "23505" ? "This athlete already has a confirmed place. Review class places."
        : error.code === "42501" ? "Access changed. Reload and review the request."
        : "Could not review the request. Reload before trying again."
      : `${approve ? "Approved and reserved" : "Declined"}. Contact the parent directly.`;
  } catch {
    message = "The decision may have saved. Reload before trying again.";
  }
  try { await loadRequests(); status.textContent = message; }
  catch { status.textContent = "The decision may have saved, but requests did not refresh. Reload before another decision."; }
  busy = false;
  for (const button of list.querySelectorAll("button")) button.disabled = false;
}

async function loadRequests() {
  const { data, error } = await supabase.rpc("list_coach_drop_in_requests");
  if (error) throw error;
  list.replaceChildren();
  for (const entry of data.slice(0, 200)) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${entry.athlete_name} · ${entry.class_label} · ` +
      `${when(entry.starts_at, entry.time_zone)} · ${entry.location_name} · ` +
      `${entry.places_left} places left`;
    item.append(label);
    for (const approve of [true, false]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = approve ? "Approve" : "Decline";
      button.disabled = busy || (approve && entry.places_left <= 0);
      button.addEventListener("click", () => decide(entry, approve));
      item.append(button);
    }
    list.append(item);
  }
  if (!data.length) {
    const item = document.createElement("li");
    item.textContent = "No pending drop-in requests.";
    list.append(item);
  } else if (data.length > 200) {
    const item = document.createElement("li");
    item.textContent = "Showing the first 200 pending requests.";
    list.append(item);
  }
}

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; status.textContent = "Could not sign out."; return; }
  location.replace("/auth/sign-in.html");
});

async function start() {
  if (!configured) { status.textContent = "Coach portal setup is in progress."; return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  const { data: coach, error: coachError } = await supabase.from("coach_users")
    .select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (coachError) throw coachError;
  if (!coach) { status.textContent = "This account does not have coach access."; return; }
  signOut.hidden = false;
  await loadRequests();
  await loadEmailPreference().catch(() => { notificationStatus.textContent = "Could not load email preferences. Please reload."; });
  content.hidden = false;
  status.textContent = "";
}

start().catch(() => { status.textContent = "Could not load drop-in requests. Try again."; });
