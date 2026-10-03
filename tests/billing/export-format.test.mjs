import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBillingExport } from "../../supabase/functions/billing-export/format.mjs";

const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);

test("a sibling payment is counted once and CSV reference formulas are inert", () => {
  const result = formatBillingExport({
    format: "nva-internal-billing-v1", month: "2026-10", currency: "USD",
    payment_timezone: "UTC", generated_at: "2026-10-01T17:00:00Z",
    charges: [
      { id: ids[0], family_id: ids[2], athlete_id: ids[3], service_month: "2026-10-01", currency: "USD", amount_minor_units: 10000, allocated_minor_units: 10000 },
      { id: ids[1], family_id: ids[2], athlete_id: ids[4], service_month: "2026-10-01", currency: "USD", amount_minor_units: 8000, allocated_minor_units: 8000 },
    ],
    payments: [{ id: ids[5], family_id: ids[2], received_at: "2026-10-01T16:00:00+00:00", currency: "USD", amount_minor_units: 18000, method: "venmo", provider_reference: "=SUM(1,2)" }],
    allocations: [
      { id: ids[6], payment_id: ids[5], charge_id: ids[0], amount_minor_units: 10000 },
      { id: "00000000-0000-4000-8000-000000000008", payment_id: ids[5], charge_id: ids[1], amount_minor_units: 8000 },
    ],
  });
  assert.deepEqual(result.manifest.counts, { charges: 2, payments: 1, allocations: 2 });
  assert.equal(result.manifest.totals.received_cents, 18000);
  assert.equal(result.manifest.totals.received_allocations_cents, 18000);
  assert.equal(result.manifest.totals.outstanding_cents, 0);
  assert.match(result.files["payments.csv"], /"'=SUM\(1,2\)"/);
  assert.equal(result.files["payments.csv"].trim().split("\r\n").length, 2);
});

test("incomplete payment allocations stop export", () => {
  assert.throws(() => formatBillingExport({
    format: "nva-internal-billing-v1", month: "2026-10", currency: "USD",
    payment_timezone: "UTC", generated_at: "2026-10-01T17:00:00Z",
    charges: [], allocations: [],
    payments: [{ id: ids[5], family_id: ids[2], received_at: "2026-10-01T16:00:00Z", currency: "USD", amount_minor_units: 10000, method: "venmo", provider_reference: null }],
  }), /allocation totals/);
});
