import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");
const list = document.querySelector("#cancellations");

function when(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

async function start() {
  if (!configured) { status.textContent = "Coach portal setup is in progress."; return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  const { data: coach, error: coachError } = await supabase.from("coach_users")
    .select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (coachError) throw coachError;
  if (!coach) { status.textContent = "This account does not have coach access."; return; }
  signOut.hidden = false;
  const { data, error } = await supabase.rpc("list_coach_parent_cancellations");
  if (error) throw error;
  list.replaceChildren();
  for (const row of data.slice(0, 200)) {
    const item = document.createElement("li");
    item.textContent = `${row.athlete_name} · ${row.class_label} · ` +
      `${when(row.starts_at, row.time_zone)} · ${row.location_name} · ` +
      `${row.seat_kind === "regular" ? "Regular" : "Drop-in"} · ` +
      `Cancelled ${when(row.cancelled_at, row.time_zone)}`;
    list.append(item);
  }
  if (!data.length) {
    const item = document.createElement("li");
    item.textContent = "No parent cancellations yet.";
    list.append(item);
  } else if (data.length > 200) {
    const item = document.createElement("li");
    item.textContent = "Showing the latest 200 parent cancellations.";
    list.append(item);
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

start().catch(() => { status.textContent = "Could not load parent cancellations. Try again."; });
