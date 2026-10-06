import { configured, supabase } from "../auth/client.js";
import { currentOrNextMondayChicago, isMondayDate, classDatesForWeek } from "./week-date.mjs";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const form = document.querySelector("#venue-form");
const weekInput = document.querySelector("#week-start");
const venueSelect = document.querySelector("#venue");
const currentVenue = document.querySelector("#current-venue");
const saveButton = document.querySelector("#save-venue");
const datesForm = document.querySelector("#dates-form");
const datesContainer = document.querySelector("#open-dates");
const createButton = document.querySelector("#create-dates");
const datedStatus = document.querySelector("#dated-status");
const signOut = document.querySelector("#sign-out");
let venues = [];
let selectedVenue = null;

function updateCreateButton() {
  createButton.disabled = !selectedVenue || !datesContainer.querySelector("input:checked");
}

async function loadDates() {
  datesContainer.replaceChildren();
  createButton.disabled = true;
  if (!isMondayDate(weekInput.value)) return;
  const dates = classDatesForWeek(weekInput.value);
  const { data, error } = await supabase.from("class_occurrences")
    .select("class_date").gte("class_date", dates[0]).lte("class_date", dates[4]);
  if (error) throw error;
  const counts = new Map();
  for (const row of data) counts.set(row.class_date, (counts.get(row.class_date) ?? 0) + 1);
  const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
  for (const [index, date] of dates.entries()) {
    const label = document.createElement("label");
    label.style.display = "block";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "openDate";
    checkbox.value = date;
    checkbox.disabled = counts.has(date) || !selectedVenue;
    checkbox.addEventListener("change", updateCreateButton);
    label.append(checkbox, ` ${dayNames[index]}, ${date}`,
      counts.has(date) ? ` — ${counts.get(date)} classes already created` : "");
    datesContainer.append(label);
  }
  updateCreateButton();
}

async function loadWeek() {
  currentVenue.textContent = "";
  venueSelect.value = "";
  selectedVenue = null;
  datedStatus.textContent = "";
  if (!isMondayDate(weekInput.value)) {
    status.textContent = "Choose a Monday for the class week.";
    datesContainer.replaceChildren();
    createButton.disabled = true;
    return;
  }
  const { data, error } = await supabase.from("class_week_venues")
    .select("location_id").eq("week_start", weekInput.value).maybeSingle();
  if (error) throw error;
  if (data) {
    selectedVenue = data.location_id;
    venueSelect.value = data.location_id;
    currentVenue.textContent = `Current venue: ${venues.find(v => v.id === data.location_id)?.display_name ?? "Venue needs review"}.`;
  } else {
    currentVenue.textContent = "No venue selected for this week.";
  }
  status.textContent = "";
  await loadDates();
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
  const { data, error } = await supabase.from("class_locations")
    .select("id, display_name, time_zone").order("display_name");
  if (error) throw error;
  venues = data;
  for (const venue of venues) {
    const option = document.createElement("option");
    option.value = venue.id;
    option.textContent = `${venue.display_name} (${venue.time_zone})`;
    venueSelect.append(option);
  }
  weekInput.value = currentOrNextMondayChicago();
  await loadWeek();
  content.hidden = false;
  if (!venues.length) status.textContent = "No venues available yet. Ask the program owner to add them.";
}

weekInput.addEventListener("change", () => {
  loadWeek().catch(() => { status.textContent = "Could not load this week's venue. Try again."; });
});

datesForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const dates = [...datesContainer.querySelectorAll("input:checked:not(:disabled)")]
    .map(input => input.value);
  if (!selectedVenue || !isMondayDate(weekInput.value) || !dates.length) {
    datedStatus.textContent = "Save a weekly venue and select confirmed open dates.";
    return;
  }
  createButton.disabled = true;
  try {
    const { data, error } = await supabase.rpc("create_dated_classes", {
      p_week_start: weekInput.value, p_open_dates: dates,
    });
    if (error) {
      datedStatus.textContent = error.code === "55000"
        ? "Classes were already created for a selected date. Refresh this week before trying again."
        : "Could not create dated classes. Confirm the schedule and try again.";
      return;
    }
    await loadWeek();
    datedStatus.textContent = `${data} dated classes created. No seats or messages were created.`;
  } catch {
    datedStatus.textContent = "Could not load the dated classes. Refresh this week before trying again.";
  } finally {
    updateCreateButton();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isMondayDate(weekInput.value) || !venues.some(v => v.id === venueSelect.value)) {
    status.textContent = "Choose a Monday and a listed venue.";
    return;
  }
  saveButton.disabled = true;
  try {
    const { error } = await supabase.rpc("set_class_week_venue", {
      p_week_start: weekInput.value, p_location_id: venueSelect.value,
    });
    if (error) {
      status.textContent = error.code === "55000"
        ? "Dated classes already exist for this week. Review them before changing the venue."
        : "Could not save this venue. Please try again.";
      return;
    }
    await loadWeek();
    status.textContent = "Weekly venue saved.";
  } catch {
    status.textContent = "Could not save this venue. Please try again.";
  } finally {
    saveButton.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; status.textContent = "Could not sign out."; return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => { status.textContent = "Could not load the weekly venue page. Please try again."; });
