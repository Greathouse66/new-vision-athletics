import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPaymentReceipt } from "../../supabase/functions/_shared/payment-receipt.mjs";

const ids = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const sample = {
  paymentId: ids[0], familyId: ids[1], amountMinorUnits: 18000,
  receivedAt: "2026-10-01T12:00:00+00:00",
  portalSignInUrl: "https://example.test/auth/sign-in.html",
  allocations: [
    { familyId: ids[1], chargeId: ids[2], athleteName: "Alex <script>", serviceMonth: "2026-10-01", amountMinorUnits: 10000 },
    { familyId: ids[1], chargeId: ids[3], athleteName: "Jordan", serviceMonth: "2026-10-01", amountMinorUnits: 8000 },
  ],
};

test("renders one Venmo payment with sibling allocations and a navigation-only portal link", () => {
  const receipt = renderPaymentReceipt(sample);
  assert.match(receipt.text, /Amount: \$180\.00/);
  assert.match(receipt.text, /Alex <script>.*\$100\.00/);
  assert.match(receipt.text, /Jordan.*\$80\.00/);
  assert.match(receipt.html, /Alex &lt;script&gt;/);
  assert.doesNotMatch(receipt.html, /<script>/);
  assert.match(receipt.html, /href="https:\/\/example\.test\/auth\/sign-in\.html"/);
  assert.doesNotMatch(receipt.html, /token=|access_token=/);
});

test("rejects mismatched account, total and token-bearing portal URL", () => {
  assert.throws(() => renderPaymentReceipt({ ...sample, amountMinorUnits: 17999 }), /do not match/);
  assert.throws(() => renderPaymentReceipt({ ...sample, allocations: [
    { ...sample.allocations[0], familyId: ids[3] }, sample.allocations[1],
  ] }), /Invalid receipt allocation/);
  assert.throws(() => renderPaymentReceipt({
    ...sample, portalSignInUrl: "https://example.test/auth/sign-in.html?token=abc",
  }), /public HTTPS/);
});
