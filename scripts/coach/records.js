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
const nameCorrections = document.querySelector("#name-corrections");
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
const deletionPanel = document.querySelector("#delete-record-panel");
const deletionForm = document.querySelector("#delete-record-form");
const deletionName = document.querySelector("#delete-record-name");
const deletionSubmit = document.querySelector("#delete-record-submit");
let deletionReview = null;
const rosterStatus = document.querySelector("#roster-status");

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

function clearDeletionReview() {
  deletionReview = null;
  deletionPanel.hidden = true;
  deletionForm.hidden = true;
  deletionName.value = "";
  updateDeletionButton();
}

function updateDeletionButton() {
  deletionSubmit.disabled = saving || !deletionReview?.can_delete ||
    deletionName.value !== deletionReview.confirmation_name;
}

function deletionError(error) {
  if (error.code === "PGRST202") return "The account deletion database update has not been applied yet.";
  if (error.code === "42501") return "Coach access is no longer available. Reload and sign in again.";
  if (error.code === "40001") return "The record changed. Reload the roster and review deletion again.";
  if (["55000", "22023"].includes(error.code)) return error.message;
  return "Could not confirm deletion. Reload the roster before trying again.";
}

async function reviewDeletion(athleteId = null) {
  if (saving || !selectedFamily()) return;
  const familyId = familySelect.value;
  await save(async () => {
    clearDeletionReview();
    const { data, error } = await supabase.rpc("review_unused_account_deletion", {
      p_family_id: familyId, p_athlete_id: athleteId,
    });
    if (error) { setStatus(deletionError(error)); return; }
    if (familySelect.value !== familyId || !data?.review_token || !Array.isArray(data.athletes) ||
        !Array.isArray(data.blockers) || !Array.isArray(data.group_enrollments)) {
      setStatus("Could not review this record. Reload the roster."); return;
    }
    deletionReview = data;
    const account = data.record_type === "account";
    document.querySelector("#delete-record-heading").textContent = `${account ? "Delete account" : "Delete athlete"}: ${data.confirmation_name}`;
    document.querySelector("#delete-record-summary").textContent = account
      ? `This permanently removes the account “${data.family.display_name}” and all ${data.athletes.length} athlete(s) listed below.`
      : `This permanently removes only this athlete from “${data.family.display_name}”. The account and other athletes stay in place.`;
    const list = document.querySelector("#delete-record-athletes");
    list.replaceChildren();
    for (const athlete of data.athletes) {
      const item = document.createElement("li"); item.textContent = athlete.display_name; list.append(item);
    }
    const blockers = document.querySelector("#delete-record-blockers");
    blockers.replaceChildren();
    for (const reason of data.blockers) {
      const item = document.createElement("li"); item.textContent = reason; blockers.append(item);
    }
    document.querySelector("#delete-record-help").textContent = data.can_delete
      ? `${data.group_enrollments.length} skill-group assignment record(s) will also be removed. A private deletion audit is retained. Parent sign-in users are unchanged. This cannot be undone from the portal.`
      : "Deletion is blocked by the records listed below. Keep this history; deleting a parent account also requires no parent access or invitation history.";
    deletionForm.hidden = !data.can_delete;
    deletionSubmit.textContent = account ? "Permanently delete account" : "Permanently delete athlete";
    deletionPanel.hidden = false;
    deletionPanel.scrollIntoView({ block: "start" });
    document.querySelector("#delete-record-heading").focus({ preventScroll: true });
    setStatus("");
  });
}

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
    .select("id, family_id, display_name, archived_at, archive_revision", { count: "exact" })
    .order("display_name").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Athlete roster exceeds the current page limit");
  roster = data;
  renderRoster();
}

function renderRoster() {
  rosterList.replaceChildren();
  const accountCounts = new Map();
  for (const athlete of roster) {
    accountCounts.set(athlete.family_id, (accountCounts.get(athlete.family_id) ?? 0) + 1);
  }
  const visible = roster.filter(athlete => rosterStatus.value === "all" ||
    (rosterStatus.value === "archived") === Boolean(athlete.archived_at));
  const archivedCount = roster.filter(athlete => athlete.archived_at).length;
  document.querySelector("#roster-count").textContent = `${roster.length - archivedCount} active · ${archivedCount} archived`;
  for (const athlete of visible) {
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
    if (athlete.archived_at) label.append(" · Archived");
    item.append(label, button, archiveButton(athlete));
    rosterList.append(item);
  }
  if (!visible.length) {
    const item = document.createElement("li");
    item.textContent = "No athletes in this view.";
    rosterList.append(item);
  }
}

function archiveButton(athlete) {
  const button = document.createElement("button");
  button.type = "button"; button.className = "secondary";
  button.textContent = athlete.archived_at ? "Reactivate" : "Archive";
  button.setAttribute("aria-label", `${button.textContent} ${athlete.display_name}`);
  button.addEventListener("click", () => changeArchiveStatus(athlete));
  return button;
}

async function changeArchiveStatus(athlete) {
  if (saving) return;
  const archive = !athlete.archived_at;
  const explanation = archive
    ? "Hide from active rosters and prevent new bookings? Payments, waivers, reports and history remain. Existing confirmed sessions and reserved weekly places stay in place. Review class places separately."
    : "Return to active rosters and allow new bookings? Regular assignments resume for newly created class dates. Sessions created during the archive are not backfilled.";
  if (!confirm(`${archive ? "Archive" : "Reactivate"} ${athlete.display_name}? ${explanation}`)) return;
  await save(async () => {
    const { data, error } = await supabase.rpc("set_athlete_archived", {
      p_athlete_id: athlete.id, p_expected_revision: athlete.archive_revision,
      p_archived: archive, p_confirmation_name: athlete.display_name,
    });
    if (error) {
      setStatus(error.code === "PGRST202" ? "The athlete archive database update has not been applied yet."
        : error.code === "40001" ? "This athlete changed. Reload the roster before trying again."
        : error.code === "42501" ? "Coach access is no longer available. Sign in again."
        : "Could not update athlete status. Reload before trying again.");
      return;
    }
    if (data?.athlete_id !== athlete.id || data?.archived !== archive || !Number.isInteger(data?.revision)) {
      setStatus("The status result was unclear. Reload before trying again."); return;
    }
    clearDeletionReview();
    await afterSave(() => refresh(familySelect.value, athlete.id),
      `${athlete.display_name} ${archive ? "archived. Find them in Archived athletes. Existing class places remain for review." : "reactivated. New bookings are available; check their class places."}`);
  });
}

rosterStatus.addEventListener("change", renderRoster);

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
    const label = document.createElement("span"); label.textContent = athlete.display_name + (athlete.archived_at ? " · Archived" : "");
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "secondary"; remove.textContent = "Delete athlete";
    remove.setAttribute("aria-label", `Delete athlete ${athlete.display_name}`);
    remove.addEventListener("click", () => reviewDeletion(athlete.id));
    item.append(label, archiveButton(athlete), remove);
    athleteList.append(item);
    athleteSelect.append(option(athlete.id, athlete.display_name + (athlete.archived_at ? " · Archived" : "")));
    groupAthleteSelect.append(option(athlete.id, athlete.display_name + (athlete.archived_at ? " · Archived" : "")));
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

async function loadNameCorrections(familyId, request) {
  nameCorrections.replaceChildren();
  const { data, count, error } = await supabase.from("record_name_corrections")
    .select("record_type, old_name, new_name, changed_by, changed_at", { count: "exact" })
    .eq("family_id", familyId).order("changed_at", { ascending: false })
    .order("id", { ascending: false }).limit(30);
  if (error) throw error;
  if (request !== requestNumber || familySelect.value !== familyId) return;
  for (const entry of data) {
    const item = document.createElement("li");
    const date = new Date(entry.changed_at).toISOString().replace("T", " ").slice(0, 19);
    const actor = entry.changed_by ? `coach ID ${entry.changed_by}` : "database action (no coach ID)";
    item.textContent = `${entry.record_type === "athlete" ? "Athlete" : "Parent account"}: ` +
      `${entry.old_name} → ${entry.new_name} · ${date} UTC · ${actor}`;
    nameCorrections.append(item);
  }
  if (!data.length) {
    const item = document.createElement("li");
    item.textContent = "No name corrections recorded for this account.";
    nameCorrections.append(item);
  } else if (count > data.length) {
    const item = document.createElement("li");
    item.textContent = "Showing the 30 most recent corrections.";
    nameCorrections.append(item);
  }
}

async function loadAthletes(preferredId) {
  clearDeletionReview();
  const familyId = familySelect.value;
  const request = ++requestNumber;
  ++historyRequest;
  familyDetails.hidden = true;
  athletes = [];
  if (!familyId) return;
  const family = selectedFamily();
  const { data, count, error } = await supabase.from("athletes")
    .select("id, display_name, archived_at, archive_revision", { count: "exact" }).eq("family_id", familyId)
    .order("display_name").order("id");
  if (error) throw error;
  if (count > data.length) throw new Error("Athlete list exceeds the current page limit");
  if (request !== requestNumber || familySelect.value !== familyId) return;
  athletes = data;
  familyName.value = family.display_name;
  renderAthletes(preferredId);
  familyDetails.hidden = false;
  await Promise.all([loadGroupHistory(), loadNameCorrections(familyId, request)]);
}

async function save(action) {
  if (saving) return;
  saving = true;
  const controls = new Map([...content.querySelectorAll("button, input, select")].map(control => [control, control.disabled]));
  for (const control of controls.keys()) control.disabled = true;
  signOut.disabled = true;
  try { await action(); }
  catch { setStatus("Could not save the record. Please refresh and try again."); }
  finally {
    for (const [control, disabled] of controls) if (control.isConnected) control.disabled = disabled;
    signOut.disabled = false;
    saving = false;
    updateDeletionButton();
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
  if (saving) return;
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; setStatus("Could not sign out."); return; }
  location.replace("/auth/sign-in.html");
});

document.querySelector("#review-delete-account").addEventListener("click", () => reviewDeletion());
document.querySelector("#cancel-record-deletion").addEventListener("click", () => {
  if (saving) return;
  clearDeletionReview();
  document.querySelector("#review-delete-account").focus();
});
deletionName.addEventListener("input", updateDeletionButton);
deletionForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (saving || !deletionReview?.can_delete || deletionName.value !== deletionReview.confirmation_name) return;
  const review = deletionReview, confirmation = deletionName.value;
  await save(async () => {
    const { data, error } = await supabase.rpc("delete_unused_account_record", {
      p_family_id: review.family.id, p_athlete_id: review.athlete_id,
      p_review_token: review.review_token, p_confirmation_name: confirmation,
    });
    if (error) { clearDeletionReview(); setStatus(deletionError(error)); return; }
    clearDeletionReview();
    if (typeof data?.deleted_account !== "boolean" || !Number.isInteger(data.deleted_athletes)) {
      setStatus("The deletion result was unclear. Reload the roster before trying again."); return;
    }
    const message = data?.deleted_account
      ? `Account deleted with ${data.deleted_athletes} athlete(s). Parent sign-in users are unchanged.`
      : "Athlete deleted. The parent account and other athletes are unchanged.";
    try { await refresh(review.family.id); setStatus(message); }
    catch { setStatus("Deleted, but the roster could not refresh. Reload the page."); }
  });
});

start().catch(() => setStatus("Could not load the athlete roster. Please try again."));
