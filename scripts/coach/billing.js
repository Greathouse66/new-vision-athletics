import { configured, supabase } from "../auth/client.js";
import { parseAmountMinorUnits } from "./billing-amount.mjs";
import { summarizePaymentSelection } from "./payment-selection.mjs";

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
const exportButton = document.querySelector("#prepare-export");
const exportStatus = document.querySelector("#export-status");
const exportFiles = document.querySelector("#export-files");
const paymentForm = document.querySelector("#payment-form");
const paymentFamily = document.querySelector("#payment-family");
const paymentChoices = document.querySelector("#payment-charges");
const paymentTotal = document.querySelector("#payment-total");
const paymentContact = document.querySelector("#payment-contact");
const paymentReadiness = document.querySelector("#payment-readiness");
const paymentStatus = document.querySelector("#payment-status");
const deliveryList = document.querySelector("#delivery-list");
let exportUrls = [];

function clearExport() {
  for (const url of exportUrls) URL.revokeObjectURL(url);
  exportUrls = [];
  exportFiles.replaceChildren();
  exportStatus.textContent = "";
}

let athletes = [];
let families = [];
let charges = [];
let allocations = [];
let corrections = [];
let correctionCount = 0;
let request = 0;
let saving = false;
let loadedMonth = null;
let deliveryReady = false;
let billingContacts = new Map();
let paymentRequest = null;
let deliveryRows = [];

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
function appliedTo(chargeId) {
  return allocations.filter((entry) => entry.charge_id === chargeId)
    .reduce((sum, entry) => sum + minor(entry.amount_minor_units), 0);
}
function selectedPayment() {
  const ids = [...paymentChoices.querySelectorAll('input[type="checkbox"]:checked')]
    .map((input) => input.value);
  const amount = summarizePaymentSelection(charges, allocations, ids, paymentFamily.value);
  return { ids, amount };
}
function updatePaymentTotal() {
  const { ids, amount } = selectedPayment();
  paymentTotal.textContent = money(amount);
  paymentForm.querySelector('button[type="submit"]').disabled = saving || !ids.length || !amount;
}
function renderPaymentChoices() {
  const previous = paymentFamily.value;
  paymentFamily.replaceChildren();
  paymentChoices.replaceChildren();
  paymentForm.hidden = !deliveryReady || !loadedMonth;
  if (paymentForm.hidden) return;
  const eligible = charges.filter((charge) =>
    minor(charge.amount_minor_units) > appliedTo(charge.id));
  const familyIds = [...new Set(eligible.map((charge) => charge.family_id))];
  for (const familyId of familyIds) {
    const option = document.createElement("option");
    option.value = familyId;
    option.textContent = families.find((family) => family.id === familyId)?.display_name ?? "Parent account";
    paymentFamily.append(option);
  }
  if (familyIds.includes(previous)) paymentFamily.value = previous;
  const familyId = paymentFamily.value;
  paymentContact.textContent = billingContacts.get(familyId) ?? "No approved email; set one in Parent account access";
  for (const charge of eligible.filter((entry) => entry.family_id === familyId)) {
    const athlete = athletes.find((entry) => entry.id === charge.athlete_id);
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = charge.id;
    input.addEventListener("change", updatePaymentTotal);
    label.append(input, document.createTextNode(
      ` ${athlete?.display_name ?? "Athlete"} · ${money(minor(charge.amount_minor_units) - appliedTo(charge.id))}`,
    ));
    paymentChoices.append(label, document.createElement("br"));
  }
  updatePaymentTotal();
}
function render() {
  chargeList.replaceChildren();
  correctionCharge.replaceChildren();
  correctionList.replaceChildren();
  deliveryList.replaceChildren();
  correctionForm.querySelector("button").disabled = saving || !loadedMonth;
  if (!loadedMonth) {
    renderPaymentChoices();
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
  for (const entry of deliveryRows) {
    const item = document.createElement("li");
    const account = families.find((family) => family.id === entry.family_id)?.display_name ?? "Account";
    const state = {
      pending: "Queued", sending: "Sending", retry: "Retry scheduled",
      sent: "Sent to provider", review: "Needs coach review",
    }[entry.delivery_status];
    if (!state) throw new Error("Unknown receipt status");
    item.textContent = `${account} · ${money(minor(entry.amount_minor_units))} · ${state} · Payment ${entry.payment_id}`;
    deliveryList.append(item);
  }
  if (!deliveryRows.length) {
    const item = document.createElement("li");
    item.textContent = "No confirmed payments received this month.";
    deliveryList.append(item);
  } else if (deliveryRows.length === 200) {
    const item = document.createElement("li");
    item.textContent = "Showing the 200 most recent receipt statuses.";
    deliveryList.append(item);
  }
  renderPaymentChoices();
}

async function loadRoster() {
  const [athleteResult, familyResult, contactResult, readinessResult] = await Promise.all([
    supabase.from("athletes").select("id, family_id, display_name", { count: "exact" })
      .order("display_name").order("id"),
    supabase.from("families").select("id, display_name", { count: "exact" })
      .order("display_name").order("id"),
    supabase.from("family_billing_contacts").select("family_id, email", { count: "exact" })
      .is("revoked_at", null),
    supabase.rpc("billing_delivery_ready"),
  ]);
  if (athleteResult.error || familyResult.error || contactResult.error || readinessResult.error ||
      athleteResult.count > athleteResult.data.length ||
      familyResult.count > familyResult.data.length ||
      contactResult.count > contactResult.data.length) {
    throw new Error("Could not load complete roster");
  }
  athletes = athleteResult.data;
  families = familyResult.data;
  billingContacts = new Map(contactResult.data.map((entry) => [entry.family_id, entry.email]));
  deliveryReady = readinessResult.data === true;
  paymentReadiness.textContent = deliveryReady
    ? "Select charges from one account after checking Venmo. An approved receipt email is required."
    : "Payment recording is paused until receipt delivery is configured and verified.";
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
  deliveryRows = [];
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
  const delivery = await supabase.rpc("list_receipt_delivery_status", {
    p_month: `${month}-01`,
  });
  if (delivery.error) throw new Error("Could not load receipt status");
  if (current !== request || monthInput.value !== month) return;
  charges = data;
  allocations = applied;
  corrections = history.data;
  correctionCount = history.count;
  deliveryRows = delivery.data;
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
  clearExport();
  paymentRequest = null;
  paymentStatus.textContent = "";
  loadMonth().catch(() => setStatus("Could not load balances. Refresh before assigning tuition."));
});

paymentFamily.addEventListener("change", renderPaymentChoices);
paymentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (saving || !deliveryReady || loadedMonth !== monthInput.value) return;
  const familyId = paymentFamily.value;
  const { ids, amount } = selectedPayment();
  const receivedValue = document.querySelector("#payment-received").value;
  const received = new Date(receivedValue);
  const reference = document.querySelector("#payment-reference").value.trim();
  if (!familyId || !billingContacts.has(familyId) || !ids.length || ids.length > 20 || !amount ||
      ids.some((id) => charges.find((charge) => charge.id === id)?.family_id !== familyId) ||
      !receivedValue || !Number.isFinite(received.valueOf()) || received > new Date() ||
      !document.querySelector("#payment-verified").checked) {
    paymentStatus.textContent = "Select one account's unpaid charges, the received time, and verify Venmo.";
    return;
  }
  const { data: currentContact, error: contactError } = await supabase
    .from("family_billing_contacts").select("email")
    .eq("family_id", familyId).is("revoked_at", null).maybeSingle();
  if (contactError || !currentContact || currentContact.email !== billingContacts.get(familyId)) {
    paymentStatus.textContent = "Receipt contact changed. Refresh before confirming payment.";
    return;
  }
  const details = { ids: [...ids].sort(), amount, receivedAt: received.toISOString(), reference };
  const fingerprint = JSON.stringify(details);
  if (paymentRequest && paymentRequest.fingerprint !== fingerprint) {
    paymentStatus.textContent = "Payment details changed after an attempt. Refresh balances before retrying.";
    return;
  }
  const selectedNames = details.ids.map((id) => {
    const charge = charges.find((entry) => entry.id === id);
    return `${athletes.find((athlete) => athlete.id === charge.athlete_id)?.display_name ?? "Athlete"}: ${money(minor(charge.amount_minor_units) - appliedTo(id))}`;
  }).join("\n");
  if (!confirm(`Venmo verified for ${families.find((family) => family.id === familyId)?.display_name ?? "account"}?\n${selectedNames}\nTotal ${money(amount)} received ${received.toLocaleString()}\nReceipt email: ${currentContact.email}\n${reference ? `Reference: ${reference}\n` : ""}Record this payment and queue its email?`)) return;
  if (!paymentRequest) paymentRequest = { id: crypto.randomUUID(), fingerprint };
  saving = true;
  paymentForm.querySelector('button[type="submit"]').disabled = true;
  monthInput.disabled = true;
  paymentStatus.textContent = "Recording verified payment…";
  try {
    const { error } = await supabase.rpc("confirm_venmo_payment", {
      p_request_id: paymentRequest.id, p_charge_ids: details.ids,
      p_amount_minor_units: amount, p_received_at: details.receivedAt,
      p_provider_reference: reference || null,
    });
    if (error) {
      paymentStatus.textContent = error.code === "55000"
        ? "Receipt delivery is paused. No payment was recorded; refresh after setup."
        : "Could not confirm payment. Refresh balances and check Venmo before trying again.";
      return;
    }
    paymentRequest = null;
    paymentForm.reset();
    clearExport();
    await loadMonth();
    paymentStatus.textContent = "Payment recorded. Receipt queued; delivery must be checked separately.";
  } catch {
    paymentStatus.textContent = "The result is unclear. Refresh and check the balance before retrying.";
  } finally {
    saving = false;
    monthInput.disabled = false;
    updatePaymentTotal();
  }
});

exportButton.addEventListener("click", async () => {
  const month = monthInput.value;
  clearExport();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    exportStatus.textContent = "Choose a reporting month first.";
    return;
  }
  exportButton.disabled = true;
  monthInput.disabled = true;
  exportStatus.textContent = "Preparing private export…";
  try {
    const { data, error } = await supabase.functions.invoke("billing-export", { body: { month } });
    if (error || !data || data.manifest?.month !== month || !data.files) {
      throw new Error("Export unavailable");
    }
    for (const name of ["charges.csv", "payments.csv", "allocations.csv", "manifest.json"]) {
      if (typeof data.files[name] !== "string") throw new Error("Incomplete export");
    }
    if (monthInput.value !== month) throw new Error("Reporting month changed");
    for (const name of ["charges.csv", "payments.csv", "allocations.csv", "manifest.json"]) {
      const type = name.endsWith(".csv") ? "text/csv;charset=utf-8" : "application/json";
      const url = URL.createObjectURL(new Blob([data.files[name]], { type }));
      exportUrls.push(url);
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = url;
      link.download = `nva-${month}-${name}`;
      link.textContent = `Download ${name}`;
      item.append(link);
      exportFiles.append(item);
    }
    exportStatus.textContent = "Files prepared. Download all four files and keep them together.";
  } catch {
    clearExport();
    exportStatus.textContent = "Could not prepare a complete export. Try again or contact support.";
  } finally {
    exportButton.disabled = false;
    monthInput.disabled = false;
  }
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
    clearExport();
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
    clearExport();
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
  clearExport();
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; setStatus("Could not sign out."); return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => setStatus("Could not load monthly tuition. Please try again."));
