import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const portal = document.querySelector("#parent-portal");
const content = document.querySelector("#family-content");
const emptyState = document.querySelector("#empty-state");
const signOut = document.querySelector("#sign-out");
const invitationSection = document.querySelector("#invitations-section");
const invitationList = document.querySelector("#invitations");
const accountSwitcher = document.querySelector("#account-switcher");
const accountFilter = document.querySelector("#account-filter");
let dashboard = null;

function showError(message) {
  status.textContent = message;
  content.hidden = true;
}

function minotToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((entry) => entry.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function sessionWhen(instant, zone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(instant));
}

async function loadInvitations() {
  invitationList.replaceChildren();
  invitationSection.hidden = true;
  const { data, error } = await supabase.rpc("list_my_guardian_invitations");
  if (error?.code === "PGRST202") return false;
  if (error) throw error;
  for (const invite of data) {
    const li = document.createElement("li");
    li.className = "parent-invitation-card";
    const label = document.createElement("span");
    label.textContent = `${invite.family_display_name} · expires ${new Date(invite.expires_at).toLocaleDateString()}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Accept access";
    button.addEventListener("click", async () => {
      button.disabled = true;
      const { error: acceptError } = await supabase.rpc("accept_guardian_invitation", {
        p_invitation_id: invite.invitation_id,
      });
      if (acceptError) {
        button.disabled = false;
        status.textContent = "Could not accept this invitation. It may have expired; contact New Vision Athletics.";
        return;
      }
      try {
        await loadFamily();
        status.textContent = "Parent account access accepted.";
      } catch {
        showError("Access accepted, but the page could not refresh. Please reload.");
      }
    });
    li.append(label, button);
    invitationList.append(li);
  }
  invitationSection.hidden = !data.length;
  return data.length > 0;
}

function selectedFamilyId() {
  return accountFilter.value || "all";
}

function renderDashboard() {
  if (!dashboard) return;
  const familyId = selectedFamilyId();
  const visibleFamilies = dashboard.families.filter((family) => familyId === "all" || family.id === familyId);
  const visibleAthletes = dashboard.athletes.filter((athlete) => familyId === "all" || athlete.family_id === familyId);
  const total = document.querySelector("#athlete-total");
  total.textContent = `${visibleAthletes.length} rostered`;
  const list = document.querySelector("#families");
  list.replaceChildren();
  for (const family of visibleFamilies) {
    const children = visibleAthletes.filter((athlete) => athlete.family_id === family.id);
    if (visibleFamilies.length > 1) {
      const heading = document.createElement("h3");
      heading.className = "parent-family-heading";
      heading.textContent = family.display_name;
      list.append(heading);
    }
    for (const athlete of children) {
      const card = document.createElement("article");
      card.className = "parent-athlete-card";
      const initials = document.createElement("span");
      initials.className = "parent-athlete-initial";
      initials.setAttribute("aria-hidden", "true");
      initials.textContent = athlete.display_name.trim().charAt(0).toUpperCase();
      const info = document.createElement("div");
      const name = document.createElement("h3");
      name.textContent = athlete.display_name;
      const group = document.createElement("span");
      group.className = "parent-group-chip";
      const enrollment = dashboard.enrollments.find((row) => row.athlete_id === athlete.id &&
        row.starts_on <= dashboard.today && (!row.ends_on || row.ends_on > dashboard.today));
      group.textContent = enrollment
        ? dashboard.groupNames.get(enrollment.group_id) ?? "Group details unavailable"
        : dashboard.groupsAvailable ? "Group pending" : "Group details unavailable";
      info.append(name, group);
      card.append(initials, info);
      list.append(card);
    }
  }
  if (!visibleAthletes.length) {
    const empty = document.createElement("p");
    empty.textContent = "No athletes have been added to this account yet.";
    list.append(empty);
  }
  const balance = document.querySelector("#balance-summary");
  const filteredCharges = dashboard.charges?.filter((row) => familyId === "all" || row.family_id === familyId);
  if (!filteredCharges) {
    balance.textContent = "Tuition summary unavailable. Open tuition for details.";
  } else if (!filteredCharges.length) {
    balance.textContent = "No tuition charges recorded yet.";
  } else {
    const outstanding = filteredCharges.reduce((totalCents, row) =>
      totalCents + Number(row.amount_minor_units) - Number(row.allocated_minor_units), 0);
    balance.textContent = Number.isSafeInteger(outstanding) && outstanding >= 0
      ? `${money(outstanding)} remaining across recorded charges`
      : "Open tuition for your current balance.";
  }
  const sessions = document.querySelector("#upcoming-preview");
  sessions.replaceChildren();
  const visibleSessions = dashboard.sessions?.filter((row) => familyId === "all" || row.family_id === familyId);
  if (!visibleSessions) {
    const item = document.createElement("li");
    item.textContent = "Session preview unavailable. Open confirmed sessions for details.";
    sessions.append(item);
  } else if (!visibleSessions.length) {
    const item = document.createElement("li");
    item.textContent = "No upcoming confirmed sessions yet. Check back after the coach confirms a place.";
    sessions.append(item);
  } else {
    for (const row of visibleSessions.slice(0, 2)) {
      const item = document.createElement("li");
      item.textContent = `${row.athlete_name} · ${row.class_label} · ${sessionWhen(row.starts_at, row.time_zone)} · ${row.location_name}`;
      sessions.append(item);
    }
  }
}

async function loadFamily() {
  if (!configured) { showError("Parent portal setup is in progress."); return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  signOut.hidden = false;
  const hasInvitations = await loadInvitations();
  portal.hidden = false;
  const { data: grants, error: grantError } = await supabase.from("family_guardians")
    .select("family_id").eq("user_id", auth.user.id);
  if (grantError) throw grantError;
  if (!grants.length) {
    dashboard = null;
    content.hidden = true;
    emptyState.hidden = false;
    status.textContent = hasInvitations ? "Review your invitation below." : "";
    return;
  }
  const familyIds = grants.map((grant) => grant.family_id);
  const [{ data: families, error: familyError }, { data: athletes, error: athleteError }] = await Promise.all([
    supabase.from("families").select("id, display_name").in("id", familyIds).order("display_name"),
    supabase.from("athletes").select("id, family_id, display_name").in("family_id", familyIds).order("display_name"),
  ]);
  if (familyError || athleteError) throw familyError ?? athleteError;
  const athleteIds = athletes.map((athlete) => athlete.id);
  const enrollmentResult = athleteIds.length
    ? await supabase.from("group_enrollments").select("athlete_id, group_id, starts_on, ends_on")
      .in("athlete_id", athleteIds)
    : { data: [], error: null };
  const enrollments = enrollmentResult.error ? [] : enrollmentResult.data;
  const groupIds = [...new Set(enrollments.map((row) => row.group_id))];
  const groupResult = groupIds.length
    ? await supabase.from("skill_groups").select("id, name").in("id", groupIds)
    : { data: [], error: null };
  const [chargesResult, sessionsResult] = await Promise.all([
    supabase.rpc("list_my_monthly_charges"),
    supabase.rpc("list_my_upcoming_sessions"),
  ]);
  dashboard = {
    families, athletes, enrollments,
    groupsAvailable: !enrollmentResult.error && !groupResult.error,
    groupNames: new Map((groupResult.data ?? []).map((group) => [group.id, group.name])),
    charges: chargesResult.error ? null : chargesResult.data,
    sessions: sessionsResult.error ? null : sessionsResult.data,
    today: minotToday(),
  };
  accountFilter.replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All parent accounts";
  accountFilter.append(all);
  for (const family of families) {
    const option = document.createElement("option");
    option.value = family.id;
    option.textContent = family.display_name;
    accountFilter.append(option);
  }
  accountSwitcher.hidden = families.length < 2;
  emptyState.hidden = true;
  content.hidden = false;
  renderDashboard();
  status.textContent = "";
}

accountFilter.addEventListener("change", renderDashboard);
signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; showError("Could not sign out. Please try again."); return; }
  location.replace("/auth/sign-in.html");
});

loadFamily().catch(() => showError("We could not load your parent account right now. Please try again."));
