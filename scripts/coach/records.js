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
const groupAthleteSelect = document.querySelector("#group-athlete");
const groupHistory = document.querySelector("#group-history");
const assignmentSection = document.querySelector("#assignment-section");
const rosterList = document.querySelector("#roster");
const renameAthleteForm = document.querySelector("#rename-athlete-form");
const addIndividualForm = document.querySelector("#add-individual-form");
const addFamilyForm = document.querySelector("#add-family-form");
const renameFamilyForm = document.querySelector("#rename-family-form");
const addAthleteForm = document.querySelector("#add-athlete-form");
const assignGroupForm = document.querySelector("#assign-group-form");
const individualGroup = document.querySelector("#individual-group");
const sharedGroup = document.querySelector("#new-athlete-group");
const assignmentGroup = document.querySelector("#assignment-group");

let families = [];
let athletes = [];
let roster = [];
let groups = [];
let requestNumber = 0;
let historyRequest = 0;
let saving = false;

function setStatus(message) { status.textContent = message; }
function cleanName(value) { return value.trim(); }
function validName(value) { return value.length >= 1 && value.length <= 160; }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }

function option(id, name) {
  const element = document.createElement("option");
  element.value = id;
  element.textContent = name;
  return element;
}

function selectedFamily() { return families.find((family) => family.id === familySelect.value); }

async function loadGroups() {
  const { data, count, error } = await supabase.from("skill_groups")
    .select("id, name, is_active", { count: "exact" }).order("name").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Group list exceeds the current page limit");
  groups = data;
  for (const select of [individualGroup, sharedGroup, assignmentGroup]) {
    const previous = select.value;
    select.replaceChildren(option("", "Choose an active group"));
    for (const group of groups.filter((group) => group.is_active)) {
      select.append(option(group.id, group.name));
    }
    select.value = groups.some((group) => group.id === previous && group.is_active) ? previous : "";
  }
}

async function loadFamilies(preferredId = familySelect.value, preferredAthleteId) {
  const { data, count, error } = await supabase.from("families")
    .select("id, display_name", { count: "exact" }).order("display_name").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Family list exceeds the current page limit");
  families = data;
  familySelect.replaceChildren(option("", "Choose an account"));
  for (const family of families) familySelect.append(option(family.id, family.display_name));
  familySelect.value = families.some((family) => family.id === preferredId) ? preferredId : "";
  await loadAthletes(preferredAthleteId);
}

async function loadRoster() {
  const { data, count, error } = await supabase.from("athletes")
    .select("id, family_id, display_name", { count: "exact" })
    .order("display_name").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Athlete roster exceeds the current page limit");
  roster = data;
  rosterList.replaceChildren();
  const accountCounts = new Map();
  for (const athlete of roster) {
    accountCounts.set(athlete.family_id, (accountCounts.get(athlete.family_id) ?? 0) + 1);
  }
  for (const athlete of roster) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const account = families.find((family) => family.id === athlete.family_id);
    label.textContent = accountCounts.get(athlete.family_id) > 1
      ? `${athlete.display_name} · ${account?.display_name ?? "Shared account"}`
      : athlete.display_name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Review account";
    button.setAttribute("aria-label", `Review account for ${athlete.display_name}`);
    button.addEventListener("click", () => {
      if (saving) return;
      familySelect.value = athlete.family_id;
      loadAthletes(athlete.id).then(() => setStatus(""))
        .catch(() => setStatus("Could not load this account. Please try again."));
    });
    item.append(label, button);
    rosterList.append(item);
  }
  if (!roster.length) {
    const item = document.createElement("li");
    item.textContent = "No athletes have been added yet.";
    rosterList.append(item);
  }
}

async function refresh(preferredFamilyId = familySelect.value, preferredAthleteId) {
  await loadGroups();
  await loadFamilies(preferredFamilyId, preferredAthleteId);
  await loadRoster();
}

function renderAthletes(preferredId = athleteSelect.value) {
  athleteList.replaceChildren();
  athleteSelect.replaceChildren();
  groupAthleteSelect.replaceChildren();
  for (const athlete of athletes) {
    const item = document.createElement("li");
    item.textContent = athlete.display_name;
    athleteList.append(item);
    athleteSelect.append(option(athlete.id, athlete.display_name));
    groupAthleteSelect.append(option(athlete.id, athlete.display_name));
  }
  if (!athletes.length) {
    const item = document.createElement("li");
    item.textContent = "No athletes have been added yet.";
    athleteList.append(item);
  }
  renameAthleteForm.hidden = !athletes.length;
  assignmentSection.hidden = !athletes.length;
  athleteSelect.value = athletes.some((athlete) => athlete.id === preferredId)
    ? preferredId : athletes[0]?.id ?? "";
  groupAthleteSelect.value = athleteSelect.value;
  athleteName.value = athletes.find((athlete) => athlete.id === athleteSelect.value)?.display_name ?? "";
}

async function loadGroupHistory() {
  const athleteId = groupAthleteSelect.value;
  const request = ++historyRequest;
  groupHistory.replaceChildren();
  if (!athleteId) return;
  const { data, count, error } = await supabase.from("group_enrollments")
    .select("group_id, starts_on, ends_on", { count: "exact" })
    .eq("athlete_id", athleteId).order("starts_on", { ascending: false });
  if (error) throw error;
  if (count > data.length) throw new Error("Group history exceeds the current page limit");
  if (request !== historyRequest || groupAthleteSelect.value !== athleteId) return;
  for (const entry of data) {
    const item = document.createElement("li");
    item.textContent = `${groups.find((group) => group.id === entry.group_id)?.name ?? "Unknown group"}: ` +
      `${entry.starts_on} to ${entry.ends_on ?? "open-ended"}`;
    groupHistory.append(item);
  }
  if (!data.length) {
    const item = document.createElement("li");
    item.textContent = "No group has been recorded for this athlete yet.";
    groupHistory.append(item);
  }
}

async function loadAthletes(preferredId) {
  const familyId = familySelect.value;
  const request = ++requestNumber;
  ++historyRequest;
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
  await loadGroupHistory();
}

async function save(action) {
  if (saving) return;
  saving = true;
  const buttons = content.querySelectorAll("button[type=submit]");
  for (const button of buttons) button.disabled = true;
  familySelect.disabled = true;
  athleteSelect.disabled = true;
  groupAthleteSelect.disabled = true;
  try { await action(); }
  catch { setStatus("Could not save the record. Please refresh and try again."); }
  finally {
    for (const button of buttons) button.disabled = false;
    familySelect.disabled = false;
    athleteSelect.disabled = false;
    groupAthleteSelect.disabled = false;
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
  await refresh();
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

groupAthleteSelect.addEventListener("change", () => {
  loadGroupHistory().then(() => setStatus(""))
    .catch(() => setStatus("Could not load group history. Please try again."));
});

addIndividualForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const name = cleanName(addIndividualForm.elements.name.value);
    const groupId = individualGroup.value;
    const startsOn = addIndividualForm.elements.date.value;
    if (!validName(name)) { setStatus("Enter an athlete name of 1 to 160 characters."); return; }
    if (!groupId || !validDate(startsOn)) { setStatus("Choose a group and its start date."); return; }
    if (roster.some((athlete) => athlete.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`An athlete named ${name} already exists. Create a separate account for another athlete with this name?`)) return;
    const { data, error } = await supabase.rpc("create_individual_athlete", {
      p_display_name: name, p_group_id: groupId, p_starts_on: startsOn,
    });
    if (error) {
      setStatus(error.code === "PGRST202"
        ? "The database update for group assignments has not been applied yet."
        : error.code === "22023" ? "Check the group and effective date, then try again."
          : "Could not add this athlete. Please try again.");
      return;
    }
    const created = data?.[0];
    if (!created) { setStatus("The result was unclear. Refresh before trying again."); return; }
    addIndividualForm.reset();
    await afterSave(() => refresh(created.family_id, created.athlete_id),
      `${name} added to ${groups.find((group) => group.id === groupId)?.name ?? "the group"} with a separate parent account. Approve parent access separately.`);
  });
});

addFamilyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const name = cleanName(addFamilyForm.elements.name.value);
    if (!validName(name)) { setStatus("Enter an account name of 1 to 160 characters."); return; }
    if (families.some((family) => family.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`A family named ${name} already exists. Add another family with that name?`)) return;
    const { data, error } = await supabase.from("families").insert({ display_name: name })
      .select("id").single();
    if (error) throw error;
    addFamilyForm.reset();
    await afterSave(() => refresh(data.id), `${name} created. Add the siblings to this account.`);
  });
});

renameFamilyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const family = selectedFamily();
    if (!family) return;
    const name = cleanName(renameFamilyForm.elements.name.value);
    if (!validName(name)) { setStatus("Enter an account name of 1 to 160 characters."); return; }
    if (name === family.display_name) { setStatus("Account name is already current."); return; }
    if (families.some((entry) => entry.id !== family.id &&
        entry.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`Another family is named ${name}. Use the same name for this family?`)) return;
    const { data, error } = await supabase.from("families")
      .update({ display_name: name }).eq("id", family.id)
      .eq("display_name", family.display_name).select("id").maybeSingle();
    if (error || !data) { setStatus("Account name changed elsewhere or access was removed. Refresh and try again."); return; }
    await afterSave(() => refresh(family.id), "Account name updated.");
  });
});

addAthleteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const familyId = familySelect.value;
    const name = cleanName(addAthleteForm.elements.name.value);
    const groupId = sharedGroup.value;
    const startsOn = addAthleteForm.elements.date.value;
    if (!familyId || !validName(name)) { setStatus("Select an account and enter an athlete name of 1 to 160 characters."); return; }
    if (!groupId || !validDate(startsOn)) { setStatus("Choose a group and its start date."); return; }
    if (athletes.some((athlete) => athlete.display_name.toLocaleLowerCase() === name.toLocaleLowerCase()) &&
        !confirm(`An athlete named ${name} is already in this family. Add another?`)) return;
    if (!confirm(`Add ${name} to ${selectedFamily().display_name}? Parents with access to this account will see this athlete.`)) return;
    const { data: athleteId, error } = await supabase.rpc("create_shared_athlete", {
      p_family_id: familyId, p_display_name: name, p_group_id: groupId, p_starts_on: startsOn,
    });
    if (error) {
      setStatus(error.code === "PGRST202"
        ? "The database update for group assignments has not been applied yet."
        : "Could not add this athlete. Check the group and date, then try again.");
      return;
    }
    addAthleteForm.reset();
    await afterSave(() => refresh(familyId, athleteId), `${name} added to the selected account and group.`);
  });
});

assignGroupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  save(async () => {
    const athleteId = groupAthleteSelect.value;
    const groupId = assignmentGroup.value;
    const startsOn = assignGroupForm.elements.date.value;
    if (!athleteId || !groupId || !validDate(startsOn)) {
      setStatus("Choose an athlete, active group and effective date."); return;
    }
    const { error } = await supabase.rpc("assign_athlete_group", {
      p_athlete_id: athleteId, p_group_id: groupId, p_starts_on: startsOn,
    });
    if (error) {
      setStatus(error.code === "PGRST202"
        ? "The database update for group assignments has not been applied yet."
        : error.code === "23P01" ? "That assignment overlaps an existing group. Review the history."
          : error.message?.includes("already in this group") ? "This athlete is already in that group."
            : error.message?.includes("Transfer date") ? "Use a date after the current group's start date."
              : "Could not change the group. Review the dates and refresh before trying again.");
      return;
    }
    assignGroupForm.reset();
    await afterSave(() => refresh(familySelect.value, athleteId), "Group assignment saved. Earlier dates remain in the history.");
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
    await afterSave(() => refresh(familyId, athlete.id), "Athlete name updated. Check the account label too if this athlete has a separate account.");
  });
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; setStatus("Could not sign out."); return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => setStatus("Could not load the athlete roster. Please try again."));
