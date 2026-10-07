import test from "node:test";
import assert from "node:assert/strict";
import { renderParentCancellationNotification } from "../../supabase/functions/_shared/drop-in-notification.mjs";
import { deliverCancellationNotification } from "../../supabase/functions/drop-in-notification-worker/cancellation-delivery.mjs";
import { runNotifications } from "../../supabase/functions/drop-in-notification-worker/run.mjs";

const coachConfig = { apiKey: "test-only", from: "receipts@example.invalid",
  reviewUrl: "https://newvision-athletics.com/coach/drop-ins.html" };
const config = { ...coachConfig, reviewUrl: "https://newvision-athletics.com/coach/cancellations.html" };
const parentConfig = { ...coachConfig, portalUrl: "https://newvision-athletics.com/parent/sessions.html" };
const payload = {
  seatId: "11111111-1111-4111-8111-111111111111", coachId: "22222222-2222-4222-8222-222222222222",
  to: "coach@example.invalid", from: config.from, reviewUrl: config.reviewUrl,
  athleteName: '<Test & "athlete">', classLabel: "Foundational", locationName: "Minot Armory",
  startsAt: "2026-10-09T23:00:00+00:00", cancelledAt: "2026-10-08T20:00:00+00:00",
  timeZone: "America/Chicago", seatKind: "regular",
};
function fixture(options = {}) {
  const calls = [];
  const admin = { async rpc(name, args) {
    calls.push([name, args]);
    if (name === "claim_parent_cancellation_notification") {
      if (options.throwClaim) throw new Error("private address must not be logged");
      return { data: options.idle ? null : options.skipped ? { skipped: true }
        : { payload: { ...payload, ...options.payload }, leaseToken: "lease" }, error: options.claimError };
    }
    if (name === "parent_cancellation_notification_current") return { data: !options.revoked, error: options.currentError };
    if (name === "settle_parent_cancellation_notification") return { error: options.settleError };
    if (name === "claim_drop_in_notification") return { data: options.allQueues ? {
      payload: { ...payload, requestId: payload.seatId, reviewUrl: coachConfig.reviewUrl }, leaseToken: "coach-lease",
    } : null };
    if (name === "claim_drop_in_approval_notification") return { data: options.allQueues ? {
      payload: { ...payload, requestId: payload.seatId, parentId: payload.coachId,
        to: "parent@example.invalid", portalUrl: parentConfig.portalUrl }, leaseToken: "parent-lease",
    } : null };
    if (name.endsWith("_current")) return { data: true };
    return {};
  } };
  const send = async (url, args) => {
    calls.push(["email", url, args]);
    if (options.networkFailure) throw new Error("network");
    return Response.json(options.response ?? { id: "message-id" }, { status: options.status ?? 200 });
  };
  const log = { error(...args) { calls.push(["log", ...args]); } };
  return { calls, admin, send, log };
}

test("cancellation email shows class and cancellation times, venue, booking type and protected coach link", () => {
  for (const kind of ["regular", "drop_in"]) {
    const message = renderParentCancellationNotification({ ...payload, seatKind: kind });
    assert.match(message.subject, /cancelled/); assert.ok(!message.subject.includes(payload.athleteName));
    assert.match(message.text, /Friday, October 9, 2026 at 6:00 PM CDT/);
    assert.match(message.text, /Thursday, October 8, 2026 at 3:00 PM CDT/);
    assert.match(message.text, /Minot Armory/); assert.match(message.text, /Foundational/);
    assert.match(message.text, /coach\/cancellations.html/);
    assert.match(message.html, /&lt;Test &amp; &quot;athlete&quot;&gt;/);
    assert.ok(!message.html.includes(payload.athleteName));
    assert.match(message.text, /makeup eligibility separately/);
    if (kind === "regular") assert.match(message.text, /weekly assignment remains active/);
    else assert.match(message.text, /drop-in place was cancelled/);
    assert.ok(!message.text.includes("place is reserved"));
  }
  for (const change of [{ seatId: null }, { seatId: undefined, requestId: payload.seatId },
    { coachId: "bad" }, { seatKind: "unknown" }, { cancelledAt: "invalid" },
    { cancelledAt: "2026-10-08T20:00:00" }, { reviewUrl: config.reviewUrl + "?token=secret" },
    { reviewUrl: parentConfig.portalUrl }, { timeZone: null }, { to: "bad\r\n@example.invalid" }]) {
    assert.throws(() => renderParentCancellationNotification({ ...payload, ...change }));
  }
});

test("cancellation worker rechecks coach permission, uses the exact seat and coach key, and records delivery", async () => {
  const f = fixture();
  assert.deepEqual(await (await deliverCancellationNotification(f.admin, config, f.send, f.log)).json(), { status: "sent" });
  assert.deepEqual(f.calls.map((call) => call[0]), ["claim_parent_cancellation_notification",
    "parent_cancellation_notification_current", "email", "settle_parent_cancellation_notification"]);
  assert.equal(f.calls[1][1].p_seat_id, payload.seatId); assert.equal(f.calls[1][1].p_coach_id, payload.coachId);
  assert.equal(f.calls[1][1].p_request_id, undefined);
  const args = f.calls[2][2];
  assert.deepEqual(JSON.parse(args.body).to, [payload.to]);
  assert.equal(args.headers["Idempotency-Key"], `nva-parent-cancelled-${payload.seatId}-${payload.coachId}`);
  assert.equal(f.calls[3][1].p_provider_id, "message-id");
});

test("idle, skipped, revoked and malformed cancellations send nothing; provider failures retry safely", async () => {
  for (const options of [{ idle: true }, { skipped: true }, { revoked: true }, { claimError: {} },
    { payload: { from: "other@example.invalid" } }, { payload: { reviewUrl: "https://other.example/coach/cancellations.html" } }]) {
    const f = fixture(options); await deliverCancellationNotification(f.admin, config, f.send, f.log);
    assert.ok(!f.calls.some((call) => call[0] === "email"));
  }
  for (const [options, status] of [[{ networkFailure: true }, "retry"], [{ status: 429 }, "retry"],
    [{ status: 503 }, "retry"], [{ status: 409, response: { name: "concurrent_idempotent_requests" } }, "retry"],
    [{ status: 409, response: { name: "invalid_idempotent_request" } }, "review"], [{ status: 403 }, "review"]]) {
    const f = fixture(options);
    assert.deepEqual(await (await deliverCancellationNotification(f.admin, config, f.send, f.log)).json(), { status });
    assert.ok(!JSON.stringify(f.calls.filter((call) => call[0] === "log")).includes(payload.to));
  }
  const first = fixture({ settleError: {} });
  assert.equal((await deliverCancellationNotification(first.admin, config, first.send, first.log)).status, 503);
  const retry = fixture(); await deliverCancellationNotification(retry.admin, config, retry.send, retry.log);
  const a = first.calls.find((call) => call[0] === "email")[2];
  const b = retry.calls.find((call) => call[0] === "email")[2];
  assert.equal(a.body, b.body); assert.equal(a.headers["Idempotency-Key"], b.headers["Idempotency-Key"]);
});

test("all three email queues can send concurrently with separate event keys", { timeout: 1500 }, async () => {
  const f = fixture({ allQueues: true });
  let started = 0, unblock;
  const barrier = new Promise((resolve) => { unblock = resolve; });
  const send = async (url, args) => {
    if (++started === 3) unblock();
    await barrier;
    return f.send(url, args);
  };
  const response = await runNotifications(f.admin, coachConfig, parentConfig, send, f.log);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { parent: { status: "sent" }, coach: { status: "sent" }, cancellation: { status: "sent" } });
  const messages = f.calls.filter((call) => call[0] === "email").map((call) => call[2]);
  assert.equal(new Set(messages.map((args) => args.headers["Idempotency-Key"])).size, 3);
  assert.equal(messages.filter((args) => JSON.parse(args.body).to[0] === payload.to).length, 2);
});

test("a cancellation queue failure cannot block parent approvals or coach request alerts", async () => {
  const f = fixture({ allQueues: true, throwClaim: true });
  const response = await runNotifications(f.admin, coachConfig, parentConfig, f.send, f.log);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body.parent, { status: "sent" }); assert.deepEqual(body.coach, { status: "sent" });
  assert.ok(body.cancellation.error);
  assert.ok(!JSON.stringify(f.calls.filter((call) => call[0] === "log")).includes("private address"));
});
