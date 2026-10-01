const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error("Invalid export ID");
  return value;
}
function cents(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Invalid export amount");
  return number;
}
function add(a, b) {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error("Export total exceeds safe range");
  return result;
}
function csvCell(value) {
  let cell = String(value ?? "");
  // Prevent a downloaded CSV from executing a user-entered reference as a formula.
  if (/^\s*[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replaceAll('"', '""')}"`;
}
function csv(columns, rows) {
  return [columns.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

export function formatBillingExport(snapshot) {
  if (snapshot?.format !== "nva-internal-billing-v1" ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(snapshot.month) ||
      snapshot.currency !== "USD" || snapshot.payment_timezone !== "UTC" ||
      !Array.isArray(snapshot.charges) || !Array.isArray(snapshot.payments) ||
      !Array.isArray(snapshot.allocations) ||
      [snapshot.charges, snapshot.payments, snapshot.allocations].some((rows) => rows.length > 5000)) {
    throw new Error("Invalid billing snapshot");
  }
  const charges = [];
  const payments = [];
  const allocations = [];
  const totals = { tuition_cents: 0, allocated_to_charges_cents: 0,
    outstanding_cents: 0, received_cents: 0, received_allocations_cents: 0 };
  const paymentAmounts = new Map();
  for (const charge of snapshot.charges) {
    const amount = cents(charge.amount_minor_units);
    const applied = cents(charge.allocated_minor_units);
    if (applied > amount || charge.currency !== "USD" ||
        charge.service_month !== `${snapshot.month}-01`) throw new Error("Invalid charge balance");
    const balance = amount - applied;
    charges.push([id(charge.id), id(charge.family_id), id(charge.athlete_id),
      charge.service_month, "USD", amount, applied, balance,
      balance === 0 ? "paid" : applied ? "partial" : "unpaid"]);
    totals.tuition_cents = add(totals.tuition_cents, amount);
    totals.allocated_to_charges_cents = add(totals.allocated_to_charges_cents, applied);
    totals.outstanding_cents = add(totals.outstanding_cents, balance);
  }
  for (const payment of snapshot.payments) {
    const amount = cents(payment.amount_minor_units);
    if (amount === 0 || payment.currency !== "USD" || payment.method !== "venmo" ||
        typeof payment.received_at !== "string" ||
        !Number.isFinite(Date.parse(payment.received_at)) ||
        new Date(payment.received_at).toISOString().slice(0, 7) !== snapshot.month ||
        payment.provider_reference != null &&
          (typeof payment.provider_reference !== "string" || payment.provider_reference.length > 160)) {
      throw new Error("Invalid payment row");
    }
    const paymentId = id(payment.id);
    if (paymentAmounts.has(paymentId)) throw new Error("Duplicate payment");
    paymentAmounts.set(paymentId, { amount, applied: 0 });
    payments.push([paymentId, id(payment.family_id), payment.received_at,
      "USD", amount, "venmo", payment.provider_reference ?? ""]);
    totals.received_cents = add(totals.received_cents, amount);
  }
  const allocationIds = new Set();
  for (const allocation of snapshot.allocations) {
    const allocationId = id(allocation.id);
    const paymentId = id(allocation.payment_id);
    const applied = cents(allocation.amount_minor_units);
    const payment = paymentAmounts.get(paymentId);
    if (allocationIds.has(allocationId) || !payment || applied === 0) {
      throw new Error("Invalid payment allocation");
    }
    allocationIds.add(allocationId);
    payment.applied = add(payment.applied, applied);
    allocations.push([allocationId, paymentId, id(allocation.charge_id), applied]);
    totals.received_allocations_cents = add(totals.received_allocations_cents, applied);
  }
  if ([...paymentAmounts.values()].some((payment) => payment.amount !== payment.applied)) {
    throw new Error("Payment allocation totals do not match");
  }
  const manifest = {
    format: snapshot.format, month: snapshot.month,
    charge_basis: "service_month", payment_basis: "received_at_UTC",
    generated_at: snapshot.generated_at, currency: "USD",
    counts: { charges: charges.length, payments: payments.length, allocations: allocations.length },
    totals,
  };
  return {
    manifest,
    files: {
      "charges.csv": csv(["charge_id", "account_id", "athlete_id", "service_month",
        "currency", "tuition_cents", "allocated_cents", "balance_cents", "status"], charges),
      "payments.csv": csv(["payment_id", "account_id", "received_at_UTC",
        "currency", "received_cents", "method", "provider_reference"], payments),
      "allocations.csv": csv(["allocation_id", "payment_id", "charge_id",
        "allocated_cents"], allocations),
      "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
    },
  };
}
