import { configured, supabase } from "../auth/client.js";
import { todayChicago } from "./week-date.mjs";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");
const classDate = document.querySelector("#class-date");
const roster = document.querySelector("#roster");
let requestNumber = 0;
let busy = false;

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

function markedTime(instant) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short",
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

async function saveAttendance(seat, nextStatus, currentMark) {
  if (busy || currentMark?.status === nextStatus) return;
  let reason = null;
  if (currentMark) {
    const answer = window.prompt(
      `Why change ${nextStatus === "present" ? "to present" : "to absent"} for this athlete? (3–500 characters)`
    );
    if (answer === null) return;
    reason = answer.trim();
    if (reason.length < 3 || reason.length > 500) {
      status.textContent = "Enter a correction reason of 3 to 500 characters.";
      return;
    }
  }
  busy = true;
  classDate.disabled = true;
  for (const button of roster.querySelectorAll("button")) button.disabled = true;
  let message;
  try {
    const { error } = await supabase.rpc("record_class_attendance", {
      p_seat_id: seat.id, p_status: nextStatus, p_reason: reason,
    });
    message = error
      ? error.code === "55000" ? "Attendance opens when this class starts."
        : error.code === "42501" ? "Coach access is no longer available."
        : "Could not save attendance. Refresh the roster and try again."
      : `${nextStatus === "present" ? "Present" : "Absent"} recorded${currentMark ? " as an audited correction" : ""}.`;
  } catch {
    message = "Could not save attendance. Refresh the roster and try again.";
  } finally {
    busy = false;
    classDate.disabled = false;
    try { await loadRoster(); status.textContent = message; }
    catch { status.textContent = "Attendance may have saved, but the roster could not refresh. Reload before another change."; }
  }
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
  const seatIds = seats.map((seat) => seat.id);
  const [athletes, attendance, audit] = seatIds.length ? await Promise.all([
    checkedList(supabase.from("athletes")
      .select("id, display_name", { count: "exact" }).in("id", athleteIds), "Athlete list"),
    checkedList(supabase.from("class_attendance")
      .select("seat_id, status", { count: "exact" }).in("seat_id", seatIds), "Attendance list"),
    checkedList(supabase.from("class_attendance_audit")
      .select("id, seat_id, old_status, new_status, reason, changed_at", { count: "exact" })
      .in("seat_id", seatIds).order("changed_at").order("id"), "Attendance history"),
  ]) : [[], [], []];
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
      const mark = attendance.find((entry) => entry.seat_id === seat.id);
      const label = document.createElement("span");
      label.textContent = `${athlete?.display_name ?? "Athlete needs review"} · ` +
        `${seat.seat_kind === "regular" ? "Regular" : "Drop-in"} · ` +
        (mark?.status ?? "Not marked");
      item.append(label);
      if (new Date(occurrence.starts_at).getTime() <= Date.now()) {
        for (const nextStatus of ["present", "absent"]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "secondary";
          button.textContent = nextStatus === "present" ? "Present" : "Absent";
          button.disabled = busy || mark?.status === nextStatus;
          button.addEventListener("click", () => saveAttendance(seat, nextStatus, mark));
          item.append(button);
        }
      }
      const history = audit.filter((entry) => entry.seat_id === seat.id);
      if (history.length) {
        const details = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Attendance history (Minot time)";
        const historyList = document.createElement("ul");
        for (const event of history) {
          const entry = document.createElement("li");
          entry.textContent = `${event.old_status ?? "Unmarked"} → ${event.new_status} · ` +
            `${markedTime(event.changed_at)}${event.reason ? ` · ${event.reason}` : ""}`;
          historyList.append(entry);
        }
        details.append(summary, historyList);
        item.append(details);
      }
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
