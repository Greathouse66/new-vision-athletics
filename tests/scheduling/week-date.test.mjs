import test from "node:test";
import assert from "node:assert/strict";
import { currentOrNextMondayChicago, isMondayDate } from "../../scripts/coach/week-date.mjs";

test("the week picker follows Minot time rather than browser UTC", () => {
  assert.equal(currentOrNextMondayChicago(new Date("2026-10-03T19:00:00Z")), "2026-10-05");
  assert.equal(currentOrNextMondayChicago(new Date("2026-10-05T03:00:00Z")), "2026-10-05");
  assert.equal(currentOrNextMondayChicago(new Date("2026-10-05T18:00:00Z")), "2026-10-05");
  assert.equal(currentOrNextMondayChicago(new Date("2026-11-01T19:00:00Z")), "2026-11-02");
});

test("only real Monday ISO dates are accepted", () => {
  assert.equal(isMondayDate("2026-10-05"), true);
  assert.equal(isMondayDate("2026-10-06"), false);
  assert.equal(isMondayDate("2026-02-30"), false);
});
