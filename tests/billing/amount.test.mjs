import assert from "node:assert/strict";
import test from "node:test";
import { parseAmountMinorUnits } from "../../scripts/coach/billing-amount.mjs";

test("monthly tuition uses exact cents and accepts zero", () => {
  assert.equal(parseAmountMinorUnits("0"), 0);
  assert.equal(parseAmountMinorUnits("0.01"), 1);
  assert.equal(parseAmountMinorUnits("125.5"), 12550);
  assert.equal(parseAmountMinorUnits(" 999.99 "), 99999);
});

test("monthly tuition refuses ambiguous or unsafe entries", () => {
  for (const value of ["", "1.001", "1,000.00", "-1", "+1", "01.00", "1e3", "9999999999", "abc"]) {
    assert.equal(parseAmountMinorUnits(value), null, value);
  }
});
