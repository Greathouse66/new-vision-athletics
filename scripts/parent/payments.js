import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#family-content");
const signOut = document.querySelector("#sign-out");
const chargeList = document.querySelector("#charges");
const paymentList = document.querySelector("#payments");
const moneyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function minor(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid financial amount");
  return number;
}
function money(value) { return moneyFormatter.format(value / 100); }
function appendEmpty(list, message) {
  if (list.children.length) return;
  const item = document.createElement("li");
  item.textContent = message;
  list.append(item);
}

async function start() {
  if (!configured) { status.textContent = "Parent portal setup is in progress."; return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  signOut.hidden = false;

  const { data: grants, error: grantsError } = await supabase.from("family_guardians")
    .select("family_id").eq("user_id", auth.user.id);
  if (grantsError) throw grantsError;
  if (!grants.length) {
    status.textContent = "This account has no family access yet. Please contact New Vision Athletics.";
    return;
  }

  const familyIds = grants.map((grant) => grant.family_id);
  const [familyResult, athleteResult, chargeResult, paymentResult] = await Promise.all([
    supabase.from("families").select("id, display_name").in("id", familyIds),
    supabase.from("athletes").select("id, family_id, display_name").in("family_id", familyIds),
    supabase.rpc("list_my_monthly_charges")
      .order("service_month", { ascending: false }).order("athlete_id").limit(200),
    supabase.rpc("list_my_payment_history")
      .order("received_at", { ascending: false }).order("payment_id").limit(200),
  ]);
  if (familyResult.error || athleteResult.error || chargeResult.error || paymentResult.error) {
    throw familyResult.error ?? athleteResult.error ?? chargeResult.error ?? paymentResult.error;
  }
  const families = new Map(familyResult.data.map((family) => [family.id, family.display_name]));
  const athletes = new Map(athleteResult.data.map((athlete) => [athlete.id, athlete]));
  const manyAccounts = families.size > 1;

  for (const charge of chargeResult.data) {
    if (!families.has(charge.family_id) || charge.currency !== "USD") throw new Error("Unexpected charge");
    const athlete = athletes.get(charge.athlete_id);
    if (!athlete || athlete.family_id !== charge.family_id) throw new Error("Unexpected athlete");
    const amount = minor(charge.amount_minor_units);
    const paid = minor(charge.allocated_minor_units);
    if (paid > amount) throw new Error("Invalid balance");
    const remaining = amount - paid;
    const state = amount === 0 ? "No charge due" : remaining === 0 ? "Paid" : paid > 0 ? "Partially paid" : "Unpaid";
    const item = document.createElement("li");
    item.textContent = athlete.display_name + (manyAccounts ? " · " + families.get(charge.family_id) : "") +
      " · " + charge.service_month.slice(0, 7) + " · Tuition " + money(amount) +
      " · " + state + " · Balance " + money(remaining);
    chargeList.append(item);
  }
  appendEmpty(chargeList, "No monthly tuition has been assigned yet.");
  if (chargeResult.data.length === 200) appendEmptyMessage(chargeList, "Showing the 200 most recent charges.");

  for (const payment of paymentResult.data) {
    if (!families.has(payment.family_id) || payment.currency !== "USD" || payment.method !== "venmo") {
      throw new Error("Unexpected payment");
    }
    const received = new Date(payment.received_at);
    if (Number.isNaN(received.valueOf())) throw new Error("Invalid payment date");
    const item = document.createElement("li");
    item.textContent = received.toISOString().slice(0, 16).replace("T", " ") + " UTC" +
      (manyAccounts ? " · " + families.get(payment.family_id) : "") +
      " · Venmo " + money(minor(payment.amount_minor_units));
    paymentList.append(item);
  }
  appendEmpty(paymentList, "No confirmed payments recorded yet.");
  if (paymentResult.data.length === 200) appendEmptyMessage(paymentList, "Showing the 200 most recent payments.");
  status.textContent = "";
  content.hidden = false;
}

function appendEmptyMessage(list, message) {
  const item = document.createElement("li");
  item.textContent = message;
  list.append(item);
}

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; status.textContent = "Could not sign out."; return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => {
  content.hidden = true;
  status.textContent = "Could not load your tuition records. Please try again.";
});
