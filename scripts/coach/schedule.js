import { configured, supabase } from "../auth/client.js";
import { currentOrNextMondayChicago, isMondayDate } from "./week-date.mjs";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const form = document.querySelector("#venue-form");
const weekInput = document.querySelector("#week-start");
const venueSelect = document.querySelector("#venue");
const currentVenue = document.querySelector("#current-venue");
const saveButton = document.querySelector("#save-venue");
const signOut = document.querySelector("#sign-out");
let venues = [];

async function loadWeek() {
  currentVenue.textContent = "";
  venueSelect.value = "";
  if (!isMondayDate(weekInput.value)) {
    status.textContent = "Choose a Monday for the class week.";
    return;
  }
  const { data, error } = await supabase.from("class_week_venues")
    .select("location_id").eq("week_start", weekInput.value).maybeSingle();
  if (error) throw error;
  if (data) {
    venueSelect.value = data.location_id;
    currentVenue.textContent = `Current venue: ${venues.find(v => v.id === data.location_id)?.display_name ?? "Venue needs review"}.`;
  } else {
    currentVenue.textContent = "No venue selected for this week.";
  }
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
