import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#family-content");
const sessionList = document.querySelector("#sessions");
const cancellationList = document.querySelector("#cancellations");
const signOut = document.querySelector("#sign-out");
let busy = false;

function localDate(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "long", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(instant));
}

function localTime(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

async function cancelSeat(row) {
  if (busy || !window.confirm(`Cancel ${row.athlete_name}'s confirmed place in ${row.class_label} on ${localDate(row.starts_at, row.time_zone)}? This frees the place for this date only. Makeup eligibility will be reviewed separately.`)) return;
  busy = true;
  for (const button of sessionList.querySelectorAll("button")) button.disabled = true;
  status.textContent = "Cancelling this place…";
  try {
    const { error } = await supabase.rpc("cancel_my_class_seat", { p_seat_id: row.seat_id });
    if (error) {
      status.textContent = error.code === "42501" ? "Access changed. Reload to see your current sessions."
        : error.code === "55000" ? "This place can no longer be cancelled. Reload your sessions."
        : "Could not cancel this place. Please reload and try again.";
      return;
    }
    await loadSessions();
    status.textContent = "Place cancelled and recorded for the coach. Makeup eligibility is reviewed separately; no email was sent.";
  } catch {
    status.textContent = "The cancellation may have saved. Reload your sessions before trying again.";
  } finally {
    busy = false;
    for (const button of sessionList.querySelectorAll("button")) button.disabled = false;
  }
}

async function loadSessions() {
  const { data, error } = await supabase.rpc("list_my_cancellable_sessions");
  if (error) throw error;
  sessionList.replaceChildren();
  for (const row of data.slice(0, 200)) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${row.athlete_name} · ${row.class_label} · ` +
      `${localDate(row.starts_at, row.time_zone)}, ` +
      `${localTime(row.starts_at, row.time_zone)}–${localTime(row.ends_at, row.time_zone)} · ` +
      `${row.location_name}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Cancel this session";
    button.addEventListener("click", () => cancelSeat(row));
    item.append(label, button);
    sessionList.append(item);
  }
  if (!data.length) {
    const item = document.createElement("li");
    item.textContent = "No upcoming confirmed sessions yet.";
    sessionList.append(item);
  } else if (data.length > 200) {
    const item = document.createElement("li");
    item.textContent = "Showing the first 200 upcoming sessions.";
    sessionList.append(item);
  }
  const { data: cancelled, error: historyError } = await supabase.rpc("list_my_parent_cancellations");
  if (historyError) throw historyError;
  cancellationList.replaceChildren();
  for (const row of cancelled.slice(0, 200)) {
    const item = document.createElement("li");
    item.textContent = `${row.athlete_name} · ${row.class_label} · ` +
      `${localDate(row.starts_at, row.time_zone)} · ` +
      `Cancelled ${localDate(row.cancelled_at, row.time_zone)}, ` +
      `${localTime(row.cancelled_at, row.time_zone)}`;
    cancellationList.append(item);
  }
  if (!cancelled.length) {
    const item = document.createElement("li");
    item.textContent = "No parent cancellations yet.";
    cancellationList.append(item);
  } else if (cancelled.length > 200) {
    const item = document.createElement("li");
    item.textContent = "Showing the latest 200 cancellations.";
    cancellationList.append(item);
  }
}

async function start() {
  if (!configured) { status.textContent = "Parent portal setup is in progress."; return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  signOut.hidden = false;
  const { count, error: grantError } = await supabase.from("family_guardians")
    .select("family_id", { count: "exact", head: true }).eq("user_id", auth.user.id);
  if (grantError) throw grantError;
  if (!count) {
    status.textContent = "This account has no athlete access yet. Review invitations on My athletes.";
    content.hidden = false;
    return;
  }
  await loadSessions();
  content.hidden = false;
  status.textContent = "";
}

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; status.textContent = "Could not sign out."; return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => { status.textContent = "Could not load upcoming sessions. Please try again."; });
