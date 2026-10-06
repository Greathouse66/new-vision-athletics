import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizePaymentSelection } from "../../scripts/coach/payment-selection.mjs";

const charges = [
  { id: "a", family_id: "family-1", currency: "USD", amount_minor_units: 10000 },
  { id: "b", family_id: "family-1", currency: "USD", amount_minor_units: 8000 },
  { id: "c", family_id: "family-2", currency: "USD", amount_minor_units: 7000 },
];

test("one sibling payment covers full outstanding balances once", () => {
  assert.equal(summarizePaymentSelection(charges, [], ["a", "b"], "family-1"), 18000);
});

test("rejects another account, duplicate charge, and paid charge", () => {
  assert.throws(() => summarizePaymentSelection(charges, [], ["a", "c"], "family-1"), /one account/);
  assert.throws(() => summarizePaymentSelection(charges, [], ["a", "a"], "family-1"), /once/);
  assert.throws(() => summarizePaymentSelection(charges,
    [{ charge_id: "a", amount_minor_units: 10000 }], ["a"], "family-1"), /paid/);
});
