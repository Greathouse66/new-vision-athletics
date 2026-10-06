import test from "node:test";
import assert from "node:assert/strict";
import { renderDropInNotification, notificationSettings } from "../../supabase/functions/_shared/drop-in-notification.mjs";
import { deliverNotification } from "../../supabase/functions/drop-in-notification-worker/delivery.mjs";

const config = { apiKey: "test-provider-key", from: "receipts@example.invalid",
  reviewUrl: "https://newvision-athletics.com/coach/drop-ins.html" };
const payload = {
  requestId: "11111111-1111-4111-8111-111111111111", coachId: "22222222-2222-4222-8222-222222222222",
  to: "coach@example.invalid", from: config.from, reviewUrl: config.reviewUrl,
  athleteName: '<Test & "athlete">', classLabel: "Foundational", locationName: "Minot Armory",
  startsAt: "2026-10-09T23:00:00+00:00", timeZone: "America/Chicago",
};
function fixture(options = {}) {
  const calls = [];
  const job = { payload: { ...payload, ...options.payload }, leaseToken: "lease" };
  const admin = { async rpc(name, body) {
    calls.push([name, body]);
    if (name === "claim_drop_in_notification") return {
      data: options.idle ? null : options.skipped ? { skipped: true } : job, error: options.claimError };
    if (name === "drop_in_notification_current") return { data: !options.revoked, error: options.currentError };
    return { error: options.settleError };
  } };
  const send = async (url, request) => {
    calls.push(["email", url, request]);
    if (options.networkFailure) throw new Error("Network unavailable");
    return Response.json(options.response ?? { id: "provider-id" }, { status: options.status ?? 200 });
  };
  return { calls, admin, send, log: { error(...args) { calls.push(["log", ...args]); } } };
}
async function deliver(f) { return deliverNotification(f.admin, config, f.send, f.log); }

test("coach email includes athlete, class, Minot time, venue and a protected review link", () => {
  const message = renderDropInNotification(payload);
  assert.match(message.text, /Foundational/); assert.match(message.text, /Minot Armory/);
  assert.match(message.text, /6:00 PM CDT/); assert.match(message.text, /does not reserve a place/);
  assert.match(message.html, /&lt;Test &amp; &quot;athlete&quot;&gt;/);
  assert.ok(!message.html.includes(payload.athleteName));
  assert.match(message.html, /https:\/\/newvision-athletics.com\/coach\/drop-ins.html/);
  assert.ok(!message.subject.includes(payload.athleteName));
  for (const change of [{ reviewUrl: config.reviewUrl + "?token=secret" }, { to: "bad\r\n@example.invalid" },
    { timeZone: "bad-zone" }, { startsAt: "not-a-time" }, { athleteName: "" }]) {
    assert.throws(() => renderDropInNotification({ ...payload, ...change }));
  }
});

test("sender reuses existing provider settings; malformed origins and missing keys fail before claiming", () => {
  const env = { RESEND_API_KEY: "key", NVA_RECEIPT_FROM: config.from, NVA_PUBLIC_ORIGIN: "https://newvision-athletics.com" };
  assert.deepEqual(notificationSettings((key) => env[key]), { ...config, apiKey: "key" });
  assert.equal(notificationSettings((key) => ({ ...env, NVA_NOTIFICATION_FROM: "alerts@example.invalid" })[key]).from,
    "alerts@example.invalid");
  for (const change of [{ RESEND_API_KEY: null }, { NVA_PUBLIC_ORIGIN: "http://site.example" },
    { NVA_PUBLIC_ORIGIN: "https://site.example/path" }, { NVA_RECEIPT_FROM: "bad" }]) {
    assert.throws(() => notificationSettings((key) => ({ ...env, ...change })[key]));
  }
});

test("worker rechecks authorization, sends one stable provider request, and records the provider ID", async () => {
  const f = fixture();
  assert.deepEqual(await (await deliver(f)).json(), { status: "sent" });
  assert.deepEqual(f.calls.map((entry) => entry[0]), ["claim_drop_in_notification", "drop_in_notification_current", "email", "settle_drop_in_notification"]);
  const request = f.calls[2][2];
  assert.equal(request.headers["Idempotency-Key"], `nva-drop-in-${payload.requestId}-${payload.coachId}`);
  assert.deepEqual(JSON.parse(request.body).to, ["coach@example.invalid"]);
  assert.equal(f.calls[3][1].p_sent, true);
  assert.equal(f.calls[3][1].p_provider_id, "provider-id");
});

test("idle, skipped, unauthorized or malformed jobs do not send email", async () => {
  for (const options of [{ idle: true }, { skipped: true }, { revoked: true },
    { payload: { from: "other@example.invalid" } }, { payload: { reviewUrl: "https://evil.example/coach/drop-ins.html" } }]) {
    const f = fixture(options); await deliver(f);
    assert.ok(!f.calls.some((entry) => entry[0] === "email"));
  }
});

test("temporary provider and network failures retry; definitive failures require review", async () => {
  for (const [options, status, code] of [
    [{ networkFailure: true }, "retry", "temporary"],
    [{ status: 429 }, "retry", "rate_limited"],
    [{ status: 503 }, "retry", "temporary"],
    [{ status: 409, response: { name: "concurrent_idempotent_requests" } }, "retry", "temporary"],
    [{ status: 409, response: { name: "invalid_idempotent_request" } }, "review", "idempotency_conflict"],
    [{ status: 403 }, "review", "provider_rejected"],
    [{ revoked: true }, "skipped", "no_longer_current"],
    [{ currentError: { code: "offline" } }, "retry", "temporary"],
  ]) {
    const f = fixture(options);
    assert.deepEqual(await (await deliver(f)).json(), { status });
    const settlement = f.calls.find((entry) => entry[0] === "settle_drop_in_notification")[1];
    assert.equal(settlement.p_sent, false); assert.equal(settlement.p_failure_code, code);
    assert.ok(!JSON.stringify(f.calls.filter((entry) => entry[0] === "log")).includes(payload.to));
  }
});

test("failed settlement never sends twice in the same invocation; retries use identical email bytes and key", async () => {
  const first = fixture({ settleError: { code: "offline" } });
  assert.equal((await deliver(first)).status, 503);
  assert.equal(first.calls.filter((entry) => entry[0] === "email").length, 1);
  const retry = fixture(); await deliver(retry);
  const a = first.calls.find((entry) => entry[0] === "email")[2];
  const b = retry.calls.find((entry) => entry[0] === "email")[2];
  assert.equal(a.body, b.body); assert.equal(a.headers["Idempotency-Key"], b.headers["Idempotency-Key"]);
});
