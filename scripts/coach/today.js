import { configured, supabase } from "../auth/client.js";
import { todayChicago } from "./week-date.mjs";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");
const classDate = document.querySelector("#class-date");
const roster = document.querySelector("#roster");
let requestNumber = 0;

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function classTime(instant, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

async function checkedList(query, label) {
  const { data, count, error } = await query;
  if (error) throw error;
  if (count > data.length) throw new Error(`${label} exceeded the current page limit`);
  return data;
}

function emptyMessage(message) {
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  roster.replaceChildren(paragraph);
}

async function loadRoster() {
  const request = ++requestNumber;
  roster.replaceChildren();
  if (!isRealDate(classDate.value)) {
    status.textContent = "Choose a valid class date.";
    return;
  }
  status.textContent = "Loading the class roster…";
  const occurrences = await checkedList(
    supabase.from("class_occurrences")
      .select("id, standing_slot_id, class_date, starts_at, ends_at, capacity, location_id", { count: "exact" })
      .eq("class_date", classDate.value).order("starts_at").order("id"),
    "Dated class list"
  );
  if (request !== requestNumber) return;
  if (!occurrences.length) {
    emptyMessage("No dated classes for this date. Confirm the venue and open dates on Plan class dates.");
    status.textContent = "";
    return;
  }

  const [slots, groups, locations, seats] = await Promise.all([
    checkedList(supabase.from("standing_class_slots")
      .select("id, group_id, class_kind", { count: "exact" })
      .in("id", [...new Set(occurrences.map((item) => item.standing_slot_id))]), "Weekly class list"),
    checkedList(supabase.from("skill_groups")
      .select("id, name", { count: "exact" }).order("name"), "Skill group list"),
    checkedList(supabase.from("class_locations")
      .select("id, display_name, time_zone", { count: "exact" })
      .in("id", [...new Set(occurrences.map((item) => item.location_id))]), "Venue list"),
    checkedList(supabase.from("class_seats")
      .select("id, occurrence_id, athlete_id, seat_kind", { count: "exact" })
      .in("occurrence_id", occurrences.map((item) => item.id))
      .is("cancelled_at", null).order("confirmed_at").order("id"), "Seat list"),
  ]);
  if (request !== requestNumber) return;
  const athleteIds = [...new Set(seats.map((seat) => seat.athlete_id))];
  const athletes = athleteIds.length ? await checkedList(
    supabase.from("athletes")
      .select("id, display_name", { count: "exact" }).in("id", athleteIds),
    "Athlete list"
  ) : [];
  if (request !== requestNumber) return;

  const sections = [];
  for (const occurrence of occurrences) {
    const slot = slots.find((item) => item.id === occurrence.standing_slot_id);
    const venue = locations.find((item) => item.id === occurrence.location_id);
    const group = groups.find((item) => item.id === slot?.group_id);
    const name = slot?.class_kind === "intro" ? "Intro" : group?.name ?? "Class needs review";
    const zone = venue?.time_zone ?? "America/Chicago";
    const confirmed = seats.filter((seat) => seat.occurrence_id === occurrence.id);
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = `${name} · ${classTime(occurrence.starts_at, zone)}–${classTime(occurrence.ends_at, zone)}`;
    const details = document.createElement("p");
    details.textContent = `${venue?.display_name ?? "Venue needs review"} · ${confirmed.length}/${occurrence.capacity} places`;
    const list = document.createElement("ul");
    for (const seat of confirmed) {
      const item = document.createElement("li");
      const athlete = athletes.find((entry) => entry.id === seat.athlete_id);
      item.textContent = `${athlete?.display_name ?? "Athlete needs review"} · ` +
        (seat.seat_kind === "regular" ? "Regular" : "Drop-in");
      list.append(item);
    }
    if (!confirmed.length) {
      const item = document.createElement("li");
      item.textContent = "No seats confirmed yet.";
      list.append(item);
    }
    section.append(heading, details, list);
    sections.push(section);
  }
  roster.replaceChildren(...sections);
  status.textContent = "";
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
  classDate.value = todayChicago();
  content.hidden = false;
  await loadRoster();
}

classDate.addEventListener("change", () => {
  loadRoster().catch(() => { status.textContent = "Could not load this class roster. Try again."; });
});
signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; status.textContent = "Could not sign out."; return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => { status.textContent = "Could not load the Today roster. Try again."; });
