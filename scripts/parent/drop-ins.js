import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#family-content");
const signOut = document.querySelector("#sign-out");
const form = document.querySelector("#request-form");
const athleteSelect = document.querySelector("#athlete");
const classSelect = document.querySelector("#class");
const requestList = document.querySelector("#requests");
let athletes = [];
let enrollments = [];
let classes = [];
let busy = false;

function option(value, label) {
  const entry = document.createElement("option");
  entry.value = value;
  entry.textContent = label;
  return entry;
}

function when(instant, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

function eligible(athleteId, entry) {
  return entry.class_kind === "intro" || enrollments.some((enrollment) =>
    enrollment.athlete_id === athleteId && enrollment.group_id === entry.group_id &&
    enrollment.starts_on <= entry.class_date &&
    (!enrollment.ends_on || enrollment.ends_on > entry.class_date)
  );
}

function renderClasses() {
  const available = classes.filter((entry) => entry.places_left > 0 && eligible(athleteSelect.value, entry));
  classSelect.replaceChildren(option("", "Choose a class"));
  for (const entry of available) {
    classSelect.append(option(entry.occurrence_id,
      `${when(entry.starts_at, entry.time_zone)} · ${entry.class_label} · ${entry.location_name} · ${entry.places_left} places left`));
  }
  form.querySelector('button[type="submit"]').disabled = busy || !available.length;
}

async function loadRequests() {
  const { data, error } = await supabase.rpc("list_my_drop_in_requests");
  if (error) throw error;
  requestList.replaceChildren();
  for (const entry of data.slice(0, 200)) {
    const item = document.createElement("li");
    item.textContent = `${entry.athlete_name} · ${when(entry.starts_at, entry.time_zone)} · ` +
      `${entry.class_label} · ${entry.location_name} · ${entry.status}`;
    requestList.append(item);
  }
  if (!data.length) {
    const item = document.createElement("li");
    item.textContent = "No drop-in requests yet.";
    requestList.append(item);
  } else if (data.length > 200) {
    const item = document.createElement("li");
    item.textContent = "Showing the 200 most recent requests.";
    requestList.append(item);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !athletes.some((a) => a.id === athleteSelect.value)) return;
  const entry = classes.find((row) => row.occurrence_id === classSelect.value);
  if (!entry || !eligible(athleteSelect.value, entry)) return;
  busy = true;
  athleteSelect.disabled = classSelect.disabled = true;
  form.querySelector('button[type="submit"]').disabled = true;
  try {
    const { error } = await supabase.rpc("request_drop_in", {
      p_athlete_id: athleteSelect.value, p_occurrence_id: entry.occurrence_id,
    });
    if (error) {
      status.textContent = error.code === "23514" ? "This class filled up. Choose another date."
        : error.code === "23505" ? "This athlete already has a confirmed place."
        : error.code === "55000" ? "This class request was already declined. Contact the coach."
        : error.code === "42501" ? "Your athlete access changed. Reload the page."
        : "Could not send the request. Check the class and try again.";
      return;
    }
    await loadRequests();
    status.textContent = "Request sent. A coach must approve it before the place is confirmed.";
  } catch {
    status.textContent = "The request may have saved. Reload before trying again.";
  } finally {
    busy = false;
    athleteSelect.disabled = classSelect.disabled = false;
    renderClasses();
  }
});

athleteSelect.addEventListener("change", renderClasses);
signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; status.textContent = "Could not sign out."; return; }
  location.replace("/auth/sign-in.html");
});

async function start() {
  if (!configured) { status.textContent = "Parent portal setup is in progress."; return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  signOut.hidden = false;
  const { data: grants, count: grantCount, error: grantError } = await supabase.from("family_guardians")
    .select("family_id", { count: "exact" }).eq("user_id", auth.user.id);
  if (grantError) throw grantError;
  if (!grants.length) {
    status.textContent = "This account has no athlete access yet. Review invitations on My athletes.";
    return;
  }
  if (grantCount > grants.length) throw new Error("Parent account list exceeded the current page limit");
  const familyIds = [...new Set(grants.map((g) => g.family_id))];
  const [athleteResult, enrollmentResult, classResult] = await Promise.all([
    supabase.from("athletes").select("id, family_id, display_name", { count: "exact" })
      .in("family_id", familyIds).order("display_name"),
    supabase.from("group_enrollments")
      .select("athlete_id, group_id, starts_on, ends_on", { count: "exact" })
      .order("starts_on"),
    supabase.rpc("list_open_drop_in_classes"),
  ]);
  for (const result of [athleteResult, enrollmentResult, classResult]) {
    if (result.error) throw result.error;
    if (result.count > result.data.length) throw new Error("List exceeded the current page limit");
  }
  athletes = athleteResult.data;
  enrollments = enrollmentResult.data;
  classes = classResult.data.slice(0, 200);
  athleteSelect.replaceChildren(option("", "Choose an athlete"));
  for (const athlete of athletes) athleteSelect.append(option(athlete.id, athlete.display_name));
  renderClasses();
  await loadRequests();
  content.hidden = false;
  status.textContent = "";
}

start().catch(() => { status.textContent = "Could not load drop-in requests. Try again."; });
