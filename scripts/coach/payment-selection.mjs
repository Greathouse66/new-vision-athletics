function cents(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid financial amount");
  return amount;
}

export function summarizePaymentSelection(charges, allocations, ids, familyId) {
  if (!Array.isArray(ids) || ids.length > 20 || new Set(ids).size !== ids.length) {
    throw new Error("Select each charge once, up to 20");
  }
  let amount = 0;
  for (const id of ids) {
    const charge = charges.find((entry) => entry.id === id);
    if (!charge || charge.family_id !== familyId || charge.currency !== "USD") {
      throw new Error("Charges must belong to one account in USD");
    }
    const applied = allocations.filter((entry) => entry.charge_id === id)
      .reduce((total, entry) => total + cents(entry.amount_minor_units), 0);
    const outstanding = cents(charge.amount_minor_units) - applied;
    if (!Number.isSafeInteger(applied) || outstanding <= 0) {
      throw new Error("Charge is paid or needs review");
    }
    amount += outstanding;
    if (!Number.isSafeInteger(amount)) throw new Error("Payment exceeds safe range");
  }
  return amount;
}
