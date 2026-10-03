import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#family-content");
const sessionList = document.querySelector("#sessions");
const signOut = document.querySelector("#sign-out");

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
  const { data, error } = await supabase.rpc("list_my_upcoming_sessions");
  if (error) throw error;
  sessionList.replaceChildren();
  for (const row of data.slice(0, 200)) {
    const item = document.createElement("li");
    item.textContent = `${row.athlete_name} · ${row.class_label} · ` +
      `${localDate(row.starts_at, row.time_zone)}, ` +
      `${localTime(row.starts_at, row.time_zone)}–${localTime(row.ends_at, row.time_zone)} · ` +
      `${row.location_name}`;
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
