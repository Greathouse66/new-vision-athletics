import test from "node:test";
import assert from "node:assert/strict";
import { approvalNotificationSettings, renderDropInApprovalNotification } from "../../supabase/functions/_shared/drop-in-notification.mjs";
import { deliverApprovalNotification } from "../../supabase/functions/drop-in-notification-worker/approval-delivery.mjs";
import { runNotifications } from "../../supabase/functions/drop-in-notification-worker/run.mjs";

const parentConfig = { apiKey: "test-key", from: "receipts@example.invalid",
  portalUrl: "https://newvision-athletics.com/parent/sessions.html" };
const coachConfig = { ...parentConfig, reviewUrl: "https://newvision-athletics.com/coach/drop-ins.html" };
const payload = {
  requestId: "11111111-1111-4111-8111-111111111111", parentId: "22222222-2222-4222-8222-222222222222",
  seatId: "33333333-3333-4333-8333-333333333333", to: "parent@example.invalid", from: parentConfig.from,
  portalUrl: parentConfig.portalUrl, athleteName: '<Test & "athlete">', classLabel: "Intro",
  locationName: "Minot Armory", startsAt: "2026-10-09T23:00:00+00:00", timeZone: "America/Chicago",
};
function fixture(options = {}) {
  const calls = [];
  const admin = { async rpc(name, args) {
    calls.push([name, args]);
    if (name === "claim_drop_in_approval_notification") {
      if (options.claimThrows) throw new Error("private value must not be logged");
      return { data: { payload: { ...payload, ...options.payload }, leaseToken: "lease" }, error: options.claimError };
    }
    if (name === "drop_in_approval_notification_current") return { data: !options.revoked };
    if (name === "settle_drop_in_approval_notification") return { error: options.settleError };
    if (name === "claim_drop_in_notification") return { data: options.coachJob ? {
      payload: { ...payload, coachId: payload.parentId, to: "coach@example.invalid", reviewUrl: coachConfig.reviewUrl }, leaseToken: "coach-lease",
    } : null };
    if (name === "drop_in_notification_current") return { data: true };
    return {};
  } };
  const send = async (url, args) => {
    calls.push(["email", url, args]);
    if (options.networkFailure) throw new Error("temporary");
    return Response.json({ id: "message-id" }, { status: options.status ?? 200 });
  };
  const log = { error(...args) { calls.push(["log", ...args]); } };
  return { calls, admin, send, log };
}

test("parent confirmation names the reserved class and venue with local time and protected portal link", () => {
  const message = renderDropInApprovalNotification(payload);
  assert.match(message.subject, /approved/);
  assert.ok(!message.subject.includes(payload.athleteName));
  assert.match(message.text, /place is reserved/);
  assert.match(message.text, /Intro/); assert.match(message.text, /Minot Armory/);
  assert.match(message.text, /Friday, October 9, 2026 at 6:00 PM CDT/);
  assert.match(message.text, /parent\/sessions.html/);
  assert.match(message.html, /&lt;Test &amp; &quot;athlete&quot;&gt;/);
  assert.ok(!message.html.includes(payload.athleteName));
  for (const change of [{ parentId: "bad" }, { seatId: null }, { portalUrl: parentConfig.portalUrl + "?token=secret" },
    { portalUrl: coachConfig.reviewUrl }, { timeZone: null }, { to: "invalid" }, { startsAt: "2026-10-09T23:00:00" }]) {
    assert.throws(() => renderDropInApprovalNotification({ ...payload, ...change }));
  }
  const env = { RESEND_API_KEY: parentConfig.apiKey, NVA_RECEIPT_FROM: parentConfig.from,
    NVA_PUBLIC_ORIGIN: "https://newvision-athletics.com" };
  assert.deepEqual(approvalNotificationSettings((key) => env[key]), parentConfig);
});

test("approval delivery uses parent-only checked RPCs, captured recipient and a distinct stable key", async () => {
  const f = fixture();
  assert.deepEqual(await (await deliverApprovalNotification(f.admin, parentConfig, f.send, f.log)).json(), { status: "sent" });
  assert.deepEqual(f.calls.map((call) => call[0]), ["claim_drop_in_approval_notification",
    "drop_in_approval_notification_current", "email", "settle_drop_in_approval_notification"]);
  assert.equal(f.calls[1][1].p_parent_id, payload.parentId);
  assert.equal(f.calls[1][1].p_coach_id, undefined);
  const request = f.calls[2][2];
  assert.deepEqual(JSON.parse(request.body).to, [payload.to]);
  assert.equal(request.headers["Idempotency-Key"], `nva-drop-in-approved-${payload.requestId}-${payload.parentId}`);
  assert.equal(f.calls[3][1].p_provider_id, "message-id");
});

test("parent delivery skips revoked or malformed jobs and retries temporary failures without changing bytes", async () => {
  for (const options of [{ revoked: true }, { payload: { from: "other@example.invalid" } },
    { payload: { portalUrl: "https://other.example/parent/sessions.html" } }]) {
    const f = fixture(options);
    await deliverApprovalNotification(f.admin, parentConfig, f.send, f.log);
    assert.ok(!f.calls.some((call) => call[0] === "email"));
  }
  for (const options of [{ networkFailure: true }, { status: 429 }, { status: 503 }]) {
    const f = fixture(options);
    assert.deepEqual(await (await deliverApprovalNotification(f.admin, parentConfig, f.send, f.log)).json(), { status: "retry" });
    assert.ok(!JSON.stringify(f.calls.filter((call) => call[0] === "log")).includes(payload.to));
  }
  const first = fixture({ settleError: { code: "offline" } });
  assert.equal((await deliverApprovalNotification(first.admin, parentConfig, first.send, first.log)).status, 503);
  const retry = fixture(); await deliverApprovalNotification(retry.admin, parentConfig, retry.send, retry.log);
  const a = first.calls.find((call) => call[0] === "email")[2];
  const b = retry.calls.find((call) => call[0] === "email")[2];
  assert.equal(a.body, b.body); assert.equal(a.headers["Idempotency-Key"], b.headers["Idempotency-Key"]);
});

test("the scheduled worker processes both queues with separate recipients and keys", async () => {
  const f = fixture({ coachJob: true });
  const response = await runNotifications(f.admin, coachConfig, parentConfig, f.send, f.log);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { parent: { status: "sent" }, coach: { status: "sent" }, cancellation: { status: "idle" } });
  const requests = f.calls.filter((call) => call[0] === "email").map((call) => call[2]);
  assert.deepEqual(requests.map((args) => JSON.parse(args.body).to), [[payload.to], ["coach@example.invalid"]]);
  assert.notEqual(requests[0].headers["Idempotency-Key"], requests[1].headers["Idempotency-Key"]);
});

test("a failed parent queue does not block coach notifications or log private error details", async () => {
  for (const options of [{ claimError: { code: "missing" } }, { claimThrows: true }, { settleError: { code: "offline" } }]) {
    const f = fixture({ ...options, coachJob: true });
    const response = await runNotifications(f.admin, coachConfig, parentConfig, f.send, f.log);
    assert.equal(response.status, 503);
    assert.deepEqual((await response.json()).coach, { status: "sent" });
    assert.ok(!JSON.stringify(f.calls.filter((call) => call[0] === "log")).includes("private value"));
  }
});
