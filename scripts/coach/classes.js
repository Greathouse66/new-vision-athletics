import { configured, supabase } from "../auth/client.js";
import { classDatesForWeek, currentOrNextMondayChicago, isMondayDate } from "./week-date.mjs";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");
const regularForm = document.querySelector("#regular-form");
const regularSlot = document.querySelector("#regular-slot");
const regularAthlete = document.querySelector("#regular-athlete");
const regularStart = document.querySelector("#regular-start");
const regularEnd = document.querySelector("#regular-end");
const regularList = document.querySelector("#regular-list");
const weekStart = document.querySelector("#week-start");
const weekClasses = document.querySelector("#week-classes");
const dropInForm = document.querySelector("#drop-in-form");
const dropInClass = document.querySelector("#drop-in-class");
const dropInAthlete = document.querySelector("#drop-in-athlete");
const seatList = document.querySelector("#seat-list");

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
let athletes = [];
let slots = [];
let groups = [];
let locations = [];
let occurrences = [];
let seats = [];
let busy = false;
let weekRequest = 0;

function option(value, label) {
  const result = document.createElement("option");
  result.value = value;
  result.textContent = label;
  return result;
}

function addEmptyItem(list, message) {
  if (list.childElementCount) return;
  const item = document.createElement("li");
  item.textContent = message;
  list.append(item);
}

function athleteName(id) {
  return athletes.find((athlete) => athlete.id === id)?.display_name ?? "Athlete needs review";
}

function slotLabel(slot) {
  if (!slot) return "Class needs review";
  const className = slot.class_kind === "intro" ? "Intro"
    : groups.find((group) => group.id === slot.group_id)?.name ?? "Group needs review";
  const hour = Number(slot.local_start_time.slice(0, 2));
  const minute = slot.local_start_time.slice(3, 5);
  const localHour = hour % 12 || 12;
  return `${weekdays[slot.iso_weekday - 1]} ${localHour}:${minute} ${hour < 12 ? "am" : "pm"} · ${className}`;
}

function classLabel(occurrence) {
  const slot = slots.find((item) => item.id === occurrence.standing_slot_id);
  const venue = locations.find((item) => item.id === occurrence.location_id)?.display_name
    ?? "Venue needs review";
  return `${occurrence.class_date} · ${slotLabel(slot)} · ${venue}`;
}

async function fullList(table, columns, orderColumn) {
  const { data, count, error } = await supabase.from(table)
    .select(columns, { count: "exact" }).order(orderColumn).order("id");
  if (error) throw error;
  if (count > data.length) throw new Error(`${table} list exceeds current page limit`);
  return data;
}

async function loadReferenceData() {
  [athletes, slots, groups, locations] = await Promise.all([
    fullList("athletes", "id, display_name", "display_name"),
    fullList("standing_class_slots",
      "id, group_id, class_kind, iso_weekday, local_start_time, capacity, active_from, active_until", "iso_weekday"),
    fullList("skill_groups", "id, name", "name"),
    fullList("class_locations", "id, display_name", "display_name"),
  ]);
  slots.sort((a, b) => a.iso_weekday - b.iso_weekday ||
    a.local_start_time.localeCompare(b.local_start_time));
  regularSlot.replaceChildren(option("", "Choose a weekly class"));
  for (const slot of slots) regularSlot.append(option(slot.id, slotLabel(slot)));
  for (const select of [regularAthlete, dropInAthlete]) {
    select.replaceChildren(option("", "Choose an athlete"));
    for (const athlete of athletes) select.append(option(athlete.id, athlete.display_name));
  }
}

async function loadRegular() {
  const { data, count, error } = await supabase.from("regular_class_assignments")
    .select("id, athlete_id, standing_slot_id, starts_on, ends_on", { count: "exact" })
    .order("starts_on").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Regular roster exceeds current page limit");
  regularList.replaceChildren();
  for (const assignment of data) {
    const item = document.createElement("li");
    const slot = slots.find((entry) => entry.id === assignment.standing_slot_id);
    item.textContent = `${athleteName(assignment.athlete_id)} · ${slotLabel(slot)} · ` +
      `from ${assignment.starts_on}${assignment.ends_on ? ` until ${assignment.ends_on}` : " (ongoing)"}`;
    regularList.append(item);
  }
  addEmptyItem(regularList, "No regular class places assigned yet.");
}

function renderSelectedSeats() {
  const selected = occurrences.find((entry) => entry.id === dropInClass.value);
  seatList.replaceChildren();
  if (!selected) {
    addEmptyItem(seatList, "Choose a dated class above.");
    return;
  }
  for (const seat of seats.filter((entry) => entry.occurrence_id === selected.id)) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${athleteName(seat.athlete_id)} · ${seat.seat_kind === "regular" ? "Regular" : "Drop-in"}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Cancel this seat";
    button.disabled = busy;
    button.addEventListener("click", () => cancelSeat(seat, selected));
    item.append(label, button);
    seatList.append(item);
  }
  addEmptyItem(seatList, "No seats confirmed in this class.");
}

function renderWeek(preferredOccurrenceId) {
  weekClasses.replaceChildren();
  dropInClass.replaceChildren(option("", "Choose a dated class"));
  for (const occurrence of occurrences) {
    const label = classLabel(occurrence);
    const used = seats.filter((seat) => seat.occurrence_id === occurrence.id).length;
    const item = document.createElement("li");
    item.textContent = `${label} · ${used}/${occurrence.capacity} seats`;
    weekClasses.append(item);
    dropInClass.append(option(occurrence.id, `${label} · ${used}/${occurrence.capacity} seats`));
  }
  addEmptyItem(weekClasses, "No dated classes have been created for this week.");
  dropInClass.value = occurrences.some((entry) => entry.id === preferredOccurrenceId)
    ? preferredOccurrenceId : "";
  renderSelectedSeats();
}

async function loadWeek(preferredOccurrenceId = dropInClass.value) {
  const request = ++weekRequest;
  occurrences = [];
  seats = [];
  renderWeek();
  if (!isMondayDate(weekStart.value)) {
    status.textContent = "Choose a Monday for the class week.";
    return;
  }
  const dates = classDatesForWeek(weekStart.value);
  const { data, count, error } = await supabase.from("class_occurrences")
    .select("id, standing_slot_id, class_date, capacity, location_id", { count: "exact" })
    .gte("class_date", dates[0]).lte("class_date", dates[4])
    .order("class_date").order("starts_at").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Class week exceeds current page limit");
  if (request !== weekRequest) return;
  occurrences = data;
  if (occurrences.length) {
    const { data: seatData, count: seatCount, error: seatError } = await supabase.from("class_seats")
      .select("id, occurrence_id, athlete_id, seat_kind", { count: "exact" })
      .in("occurrence_id", occurrences.map((entry) => entry.id)).is("cancelled_at", null)
      .order("confirmed_at").order("id");
    if (seatError) throw seatError;
    if (seatCount > seatData.length) throw new Error("Class seats exceed current page limit");
    if (request !== weekRequest) return;
    seats = seatData;
  }
  renderWeek(preferredOccurrenceId);
  status.textContent = "";
}

async function performWrite(action, refresh, successMessage) {
  if (busy) return;
  busy = true;
  for (const control of content.querySelectorAll("button, select, input")) control.disabled = true;
  try {
    const { error } = await action();
    if (error) {
      status.textContent = error.code === "23514" ? "This class is full. Review its seats."
        : error.code === "23505" ? "This athlete already has this place. Review the roster."
        : error.code === "42501" ? "Coach access is no longer available."
        : "Could not save this class place. Review the dates and try again.";
      return;
    }
    try { await refresh(); status.textContent = successMessage; }
    catch { status.textContent = "Saved, but the list could not refresh. Reload before trying again."; }
  } catch {
    status.textContent = "Could not save this class place. Reload before trying again.";
  } finally {
    for (const control of content.querySelectorAll("button, select, input")) control.disabled = false;
    busy = false;
    renderSelectedSeats();
  }
}

async function cancelSeat(seat, occurrence) {
  if (busy || !window.confirm(`Cancel ${athleteName(seat.athlete_id)}'s seat in ${classLabel(occurrence)}? This does not end their regular weekly assignment.`)) return;
  await performWrite(
    () => supabase.rpc("cancel_coach_class_seat", { p_seat_id: seat.id }),
    () => loadWeek(occurrence.id),
    "Dated seat cancelled. Check with the family directly."
  );
}

regularForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const slot = slots.find((item) => item.id === regularSlot.value);
  const athlete = athletes.find((item) => item.id === regularAthlete.value);
  if (busy || !slot || !athlete || !regularStart.value ||
      (regularEnd.value && regularEnd.value <= regularStart.value)) {
    status.textContent = "Choose an athlete, weekly class and valid effective dates.";
    return;
  }
  const end = regularEnd.value || null;
  if (!window.confirm(`Assign ${athlete.display_name} to ${slotLabel(slot)} from ${regularStart.value}${end ? ` until ${end}` : " ongoing"}? This reserves dated seats in that range.`)) return;
  await performWrite(
    () => supabase.rpc("add_regular_class_athlete", {
      p_slot_id: slot.id, p_athlete_id: athlete.id,
      p_starts_on: regularStart.value, p_ends_on: end,
    }),
    async () => { await loadRegular(); await loadWeek(); },
    "Regular class place assigned. Review the dated seats."
  );
});

dropInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const occurrence = occurrences.find((entry) => entry.id === dropInClass.value);
  const athlete = athletes.find((entry) => entry.id === dropInAthlete.value);
  if (busy || !occurrence || !athlete) {
    status.textContent = "Choose a dated class and an athlete already on the roster.";
    return;
  }
  if (!window.confirm(`Confirm one drop-in seat for ${athlete.display_name} in ${classLabel(occurrence)}?`)) return;
  await performWrite(
    () => supabase.rpc("confirm_coach_drop_in", {
      p_occurrence_id: occurrence.id, p_athlete_id: athlete.id,
    }),
    () => loadWeek(occurrence.id),
    "Drop-in seat confirmed. Check with the family directly."
  );
});

weekStart.addEventListener("change", () => {
  loadWeek().catch(() => { status.textContent = "Could not load this class week. Try again."; });
});
dropInClass.addEventListener("change", renderSelectedSeats);
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
  await loadReferenceData();
  regularStart.value = currentOrNextMondayChicago();
  weekStart.value = regularStart.value;
  await Promise.all([loadRegular(), loadWeek()]);
  content.hidden = false;
  status.textContent = "";
}

start().catch(() => { status.textContent = "Could not load class places. Try again."; });
