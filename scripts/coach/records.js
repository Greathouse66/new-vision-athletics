import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");
const familySelect = document.querySelector("#family");
const familyDetails = document.querySelector("#family-details");
const familyName = document.querySelector("#family-name");
const athleteList = document.querySelector("#athletes");
const athleteSelect = document.querySelector("#athlete");
const athleteName = document.querySelector("#athlete-name");
const renameAthleteForm = document.querySelector("#rename-athlete-form");
const addFamilyForm = document.querySelector("#add-family-form");
const renameFamilyForm = document.querySelector("#rename-family-form");
const addAthleteForm = document.querySelector("#add-athlete-form");

let families = [];
let athletes = [];
let requestNumber = 0;
let saving = false;

function setStatus(message) { status.textContent = message; }
function cleanName(value) { return value.trim(); }
function validName(value) { return value.length >= 1 && value.length <= 160; }

function option(id, name) {
  const element = document.createElement("option");
  element.value = id;
  element.textContent = name;
  return element;
}

function selectedFamily() { return families.find((family) => family.id === familySelect.value); }

async function loadFamilies(preferredId = familySelect.value) {
  const { data, count, error } = await supabase.from("families")
    .select("id, display_name", { count: "exact" }).order("display_name").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Family list exceeds the current page limit");
  families = data;
  familySelect.replaceChildren(option("", "Choose a family"));
  for (const family of families) familySelect.append(option(family.id, family.display_name));
  familySelect.value = families.some((family) => family.id === preferredId) ? preferredId : "";
  await loadAthletes();
}

function renderAthletes(preferredId = athleteSelect.value) {
  athleteList.replaceChildren();
  athleteSelect.replaceChildren();
  for (const athlete of athletes) {
    const item = document.createElement("li");
    item.textContent = athlete.display_name;
    athleteList.append(item);
    athleteSelect.append(option(athlete.id, athlete.display_name));
  }
  if (!athletes.length) {
    const item = document.createElement("li");
    item.textContent = "No athletes have been added yet.";
    athleteList.append(item);
  }
  renameAthleteForm.hidden = !athletes.length;
  athleteSelect.value = athletes.some((athlete) => athlete.id === preferredId)
    ? preferredId : athletes[0]?.id ?? "";
  athleteName.value = athletes.find((athlete) => athlete.id === athleteSelect.value)?.display_name ?? "";
}

async function loadAthletes(preferredId) {
  const familyId = familySelect.value;
  const request = ++requestNumber;
  familyDetails.hidden = true;
  athletes = [];
  if (!familyId) return;
  const family = selectedFamily();
  const { data, count, error } = await supabase.from("athletes")
    .select("id, display_name", { count: "exact" }).eq("family_id", familyId)
    .order("display_name").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Athlete list exceeds the current page limit");
  if (request !== requestNumber || familySelect.value !== familyId) return;
  athletes = data;
  familyName.value = family.display_name;
  renderAthletes(preferredId);
  familyDetails.hidden = false;
}

async function save(action) {
  if (saving) return;
  saving = true;
  const buttons = content.querySelectorAll("button[type=submit]");
  for (const button of buttons) button.disabled = true;
  familySelect.disabled = true;
  athleteSelect.disabled = true;
  try { await action(); }
  catch { setStatus("Could not save the record. Please refresh and try again."); }
  finally {
    for (const button of buttons) button.disabled = false;
    familySelect.disabled = false;
    athleteSelect.disabled = false;
    saving = false;
  }
}

async function afterSave(refresh, message) {
  try { await refresh(); setStatus(message); }
  catch { setStatus("Saved, but the list could not refresh. Reload the page before trying again."); }
}

async function start() {
  if (!configured) { setStatus("Coach portal setup is in progress."); return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  const { data: coach, error } = await supabase.from("coach_users")
    .select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (error) throw error;
  if (!coach) { setStatus("This account does not have coach access."); return; }
  signOut.hidden = false;
  await loadFamilies();
  content.hidden = false;
  setStatus("");
}

familySelect.addEventListener("change", () => {
  loadAthletes().then(() => setStatus(""))
    .catch(() => setStatus("Could not load this family's athletes. Please try again."));
});

athleteSelect.addEventListener("change", () => {
  athleteName.value = athletes.find((athlete) => athlete.id === athleteSelect.value)?.display_name ?? "";
});

addFamilyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const name = cleanName(addFamilyForm.elements.name.value);
    if (!validName(name)) { setStatus("Enter a family name of 1 to 160 characters."); return; }
    if (families.some((family) => family.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`A family named ${name} already exists. Add another family with that name?`)) return;
    const { data, error } = await supabase.from("families").insert({ display_name: name })
      .select("id").single();
    if (error) throw error;
    addFamilyForm.reset();
    await afterSave(() => loadFamilies(data.id), `${name} added. Add athletes or approve guardian access separately.`);
  });
});

renameFamilyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const family = selectedFamily();
    if (!family) return;
    const name = cleanName(renameFamilyForm.elements.name.value);
    if (!validName(name)) { setStatus("Enter a family name of 1 to 160 characters."); return; }
    if (name === family.display_name) { setStatus("Family name is already current."); return; }
    if (families.some((entry) => entry.id !== family.id &&
        entry.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`Another family is named ${name}. Use the same name for this family?`)) return;
    const { data, error } = await supabase.from("families")
      .update({ display_name: name }).eq("id", family.id)
      .eq("display_name", family.display_name).select("id").maybeSingle();
    if (error || !data) { setStatus("Family name changed elsewhere or access was removed. Refresh and try again."); return; }
    await afterSave(() => loadFamilies(family.id), "Family name updated.");
  });
});

addAthleteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const familyId = familySelect.value;
    const name = cleanName(addAthleteForm.elements.name.value);
    if (!familyId || !validName(name)) { setStatus("Select a family and enter an athlete name of 1 to 160 characters."); return; }
    if (athletes.some((athlete) => athlete.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`An athlete named ${name} is already in this family. Add another?`)) return;
    const { error } = await supabase.from("athletes").insert({ family_id: familyId, display_name: name });
    if (error) throw error;
    addAthleteForm.reset();
    await afterSave(() => loadAthletes(), `${name} added to the selected family.`);
  });
});

renameAthleteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const athlete = athletes.find((entry) => entry.id === athleteSelect.value);
    const familyId = familySelect.value;
    if (!athlete || !familyId) return;
    const name = cleanName(renameAthleteForm.elements.name.value);
    if (!validName(name)) { setStatus("Enter an athlete name of 1 to 160 characters."); return; }
    if (name === athlete.display_name) { setStatus("Athlete name is already current."); return; }
    if (athletes.some((entry) => entry.id !== athlete.id &&
        entry.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`Another athlete in this family is named ${name}. Use the same name?`)) return;
    const { data, error } = await supabase.from("athletes")
      .update({ display_name: name }).eq("id", athlete.id).eq("family_id", familyId)
      .eq("display_name", athlete.display_name).select("id").maybeSingle();
    if (error || !data) { setStatus("Athlete name changed elsewhere or access was removed. Refresh and try again."); return; }
    await afterSave(() => loadAthletes(athlete.id), "Athlete name updated.");
  });
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; setStatus("Could not sign out."); return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => setStatus("Could not load family records. Please try again."));
