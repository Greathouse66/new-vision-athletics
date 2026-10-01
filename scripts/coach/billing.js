import { configured, supabase } from "../auth/client.js";
import { parseAmountMinorUnits } from "./billing-amount.mjs";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");
const monthInput = document.querySelector("#service-month");
const athleteSelect = document.querySelector("#athlete");
const chargeForm = document.querySelector("#charge-form");
const chargeList = document.querySelector("#charges");
const correctionForm = document.querySelector("#correction-form");
const correctionCharge = document.querySelector("#correction-charge");
const correctionList = document.querySelector("#corrections");

let athletes = [];
let families = [];
let charges = [];
let allocations = [];
let corrections = [];
let correctionCount = 0;
let request = 0;
let saving = false;
let loadedMonth = null;

function setStatus(message) { status.textContent = message; }
function labelFor(athlete) {
  return `${athlete.display_name} · ${families.find((family) => family.id === athlete.family_id)?.display_name ?? "Account"}`;
}
function minor(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid financial amount");
  return n;
}
function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}
function render() {
  chargeList.replaceChildren();
  correctionCharge.replaceChildren();
  correctionList.replaceChildren();
  correctionForm.querySelector("button").disabled = saving || !loadedMonth;
  if (!loadedMonth) {
    const item = document.createElement("li");
    item.textContent = "Balances are not loaded. Choose a month or refresh.";
    chargeList.append(item);
    return;
  }
  let eligible = 0;
  for (const athlete of athletes) {
    const charge = charges.find((entry) => entry.athlete_id === athlete.id);
    const item = document.createElement("li");
    const name = document.createElement("strong");
    name.textContent = labelFor(athlete);
    item.append(name);
    if (!charge) {
      item.append(document.createTextNode(" · Tuition not assigned"));
    } else {
      if (charge.currency !== "USD") throw new Error("Unexpected billing currency");
      const amount = minor(charge.amount_minor_units);
      const paid = allocations.filter((entry) => entry.charge_id === charge.id)
        .reduce((sum, entry) => sum + minor(entry.amount_minor_units), 0);
      if (!Number.isSafeInteger(paid) || paid > amount) throw new Error("Invalid allocation total");
      const balance = amount - paid;
      const state = amount === 0 ? "No charge due" : balance === 0 ? "Paid" : paid > 0 ? "Partially paid" : "Unpaid";
      item.append(document.createTextNode(
        ` · Tuition ${money(amount)} · ${state} · Balance ${money(balance)}`,
      ));
      if (paid === 0) {
        const option = document.createElement("option");
        option.value = charge.id;
        option.textContent = `${labelFor(athlete)} · ${money(amount)}`;
        correctionCharge.append(option);
        eligible++;
      }
    }
    chargeList.append(item);
  }
  if (!athletes.length) {
    const item = document.createElement("li");
    item.textContent = "No athletes have been added yet.";
    chargeList.append(item);
  }
  correctionForm.querySelector("button").disabled = saving || !eligible;
  for (const entry of corrections) {
    const item = document.createElement("li");
    const athlete = athletes.find((row) => row.id === entry.athlete_id);
    item.textContent = `${athlete ? labelFor(athlete) : "Athlete"} · ${money(minor(entry.old_amount_minor_units))} → ${money(minor(entry.new_amount_minor_units))} · ${entry.reason} · ${new Date(entry.changed_at).toLocaleString("en-US", { timeZone: "UTC" })} UTC`;
    correctionList.append(item);
  }
  if (!corrections.length) {
    const item = document.createElement("li");
    item.textContent = "No corrections for this month.";
    correctionList.append(item);
  } else if (correctionCount > corrections.length) {
    const item = document.createElement("li");
    item.textContent = "Showing the latest 100 corrections.";
    correctionList.append(item);
  }
}

async function loadRoster() {
  const [athleteResult, familyResult] = await Promise.all([
    supabase.from("athletes").select("id, family_id, display_name", { count: "exact" })
      .order("display_name").order("id"),
    supabase.from("families").select("id, display_name", { count: "exact" })
      .order("display_name").order("id"),
  ]);
  if (athleteResult.error || familyResult.error ||
      athleteResult.count > athleteResult.data.length || familyResult.count > familyResult.data.length) {
    throw new Error("Could not load complete roster");
  }
  athletes = athleteResult.data;
  families = familyResult.data;
  athleteSelect.replaceChildren();
  for (const athlete of athletes) {
    const option = document.createElement("option");
    option.value = athlete.id;
    option.textContent = labelFor(athlete);
    athleteSelect.append(option);
  }
  chargeForm.querySelector("button").disabled = !athletes.length;
  render();
}

async function loadMonth() {
  const month = monthInput.value;
  const current = ++request;
  loadedMonth = null;
  charges = [];
  allocations = [];
  corrections = [];
  correctionCount = 0;
  render();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    setStatus("Choose a month to see tuition and balances.");
    return;
  }
  const { data, count, error } = await supabase.from("athlete_monthly_charges")
    .select("id, athlete_id, family_id, currency, amount_minor_units", { count: "exact" })
    .eq("service_month", `${month}-01`).order("athlete_id");
  if (error || count > data.length) throw new Error("Could not load complete charge list");
  if (current !== request || monthInput.value !== month) return;
  const ids = data.map((entry) => entry.id);
  let applied = [];
  if (ids.length) {
    const result = await supabase.from("payment_allocations")
      .select("charge_id, amount_minor_units", { count: "exact" }).in("charge_id", ids);
    if (result.error || result.count > result.data.length) throw new Error("Could not load complete allocations");
    applied = result.data;
  }
  const history = await supabase.from("monthly_charge_corrections")
    .select("athlete_id, old_amount_minor_units, new_amount_minor_units, reason, changed_at", { count: "exact" })
    .eq("service_month", `${month}-01`).order("changed_at", { ascending: false })
    .order("id", { ascending: false }).limit(100);
  if (history.error) throw new Error("Could not load correction history");
  if (current !== request || monthInput.value !== month) return;
  charges = data;
  allocations = applied;
  corrections = history.data;
  correctionCount = history.count;
  loadedMonth = month;
  render();
  setStatus("");
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
  await loadRoster();
  content.hidden = false;
  setStatus("Choose a month to see tuition and balances.");
}

monthInput.addEventListener("change", () => {
  loadMonth().catch(() => setStatus("Could not load balances. Refresh before assigning tuition."));
});

correctionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  const month = monthInput.value;
  const charge = charges.find((entry) => entry.id === correctionCharge.value);
  const athlete = athletes.find((entry) => entry.id === charge?.athlete_id);
  const amount = parseAmountMinorUnits(correctionForm.elements.amount.value);
  const reason = correctionForm.elements.reason.value.trim();
  if (loadedMonth !== month || !charge || !athlete) {
    setStatus("Load the tuition month and choose an unpaid charge first."); return;
  }
  if (allocations.some((entry) => entry.charge_id === charge.id)) {
    setStatus("A payment is already applied. Request a reviewed adjustment."); return;
  }
  if (amount === null || amount === minor(charge.amount_minor_units)) {
    setStatus("Enter a different USD amount with up to two decimal places."); return;
  }
  if (reason.length < 10 || reason.length > 500) {
    setStatus("Enter a reason between 10 and 500 characters."); return;
  }
  if (!confirm(`Change ${labelFor(athlete)} tuition for ${month} from ${money(minor(charge.amount_minor_units))} to ${money(amount)}?\nReason: ${reason}`)) return;
  saving = true;
  correctionForm.querySelector("button").disabled = true;
  monthInput.disabled = true;
  try {
    const { error } = await supabase.rpc("correct_monthly_charge", {
      p_charge_id: charge.id, p_amount_minor_units: amount, p_reason: reason,
    });
    if (error) {
      setStatus(error.code === "22023"
        ? "The charge changed or a payment was applied. Refresh before requesting an adjustment."
        : "Could not save correction. Refresh before trying again.");
      return;
    }
    correctionForm.reset();
    await loadMonth();
    setStatus(`Tuition correction saved for ${athlete.display_name} in ${month}.`);
  } catch {
    setStatus("The result is unclear. Refresh and check correction history before retrying.");
  } finally {
    saving = false;
    monthInput.disabled = false;
    correctionForm.querySelector("button").disabled = !loadedMonth || !correctionCharge.options.length;
  }
});

chargeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving) return;
  const athlete = athletes.find((entry) => entry.id === athleteSelect.value);
  const month = monthInput.value;
  const amount = parseAmountMinorUnits(chargeForm.elements.amount.value);
  if (!athlete || !/^\d{4}-\d{2}$/.test(month)) {
    setStatus("Choose an athlete and a tuition month first."); return;
  }
  if (loadedMonth !== month) {
    setStatus("Load this month's balances before assigning tuition."); return;
  }
  if (amount === null) {
    setStatus("Enter a USD amount with up to two decimal places."); return;
  }
  if (charges.some((entry) => entry.athlete_id === athlete.id)) {
    setStatus("Tuition is already assigned for this athlete and month. Corrections need review."); return;
  }
  if (!confirm(`Assign ${money(amount)} tuition to ${labelFor(athlete)} for ${month}?`)) return;
  saving = true;
  const button = chargeForm.querySelector("button");
  button.disabled = true;
  monthInput.disabled = true;
  athleteSelect.disabled = true;
  try {
    const { error } = await supabase.rpc("assign_monthly_charge", {
      p_athlete_id: athlete.id, p_service_month: `${month}-01`,
      p_amount_minor_units: amount, p_currency: "USD",
    });
    if (error) {
      setStatus(error.code === "22023"
        ? "This charge already exists with different details. Refresh and request a correction."
        : "Could not assign tuition. Refresh before trying again.");
      return;
    }
    chargeForm.reset();
    await loadMonth();
    setStatus(`Tuition assigned to ${athlete.display_name} for ${month}.`);
  } catch {
    setStatus("The result is unclear. Refresh before trying again.");
  } finally {
    saving = false;
    button.disabled = false;
    monthInput.disabled = false;
    athleteSelect.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; setStatus("Could not sign out."); return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => setStatus("Could not load monthly tuition. Please try again."));
