import test from "node:test";
import assert from "node:assert/strict";
import { inviteParent } from "../../supabase/functions/coach-invite-parent/delivery.mjs";
import { signInDestination } from "../../scripts/auth/destination.mjs";

const family = "11111111-1111-4111-8111-111111111111";
function fixture(options = {}) {
  const calls = [];
  const caller = {
    from(name) {
      calls.push(["role", name]);
      return { select() { return this; }, eq(field, id) {
        calls.push(["identity", field, id]); return this;
      }, async maybeSingle() {
        return { data: options.parent ? null : { user_id: "coach" }, error: options.roleError };
      } };
    },
    async rpc(name, body) {
      calls.push([name, body]);
      return { data: [{ invitation_id: "invitation", attempt_id: "attempt", email: "parent@example.invalid" }],
        error: options.reserveError };
    },
    auth: { async getUser() { return { data: { user: { id: "verified-id", user_metadata: { role: "coach" } } },
      error: options.userError }; } },
  };
  const admin = {
    auth: {
      admin: { async inviteUserByEmail(email, opts) {
        calls.push(["invite", email, opts]);
        if (options.throwMail) throw new Error("SMTP unavailable");
        return { error: options.inviteError };
      } },
      async signInWithOtp(body) { calls.push(["otp", body]); return { error: options.otpError }; },
    },
    async rpc(name, body) { calls.push([name, body]); return { error: options.finishError }; },
  };
  return { calls, caller, admin, userId: "coach", publicOrigin: "https://newvision-athletics.com",
    log: { error(message) { calls.push(["log", message]); } } };
}
function request(body = { family_id: family, email: " Parent@Example.invalid " }, method = "POST") {
  return new Request("https://functions.example.invalid/invite", {
    method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

test("new parent: verify coach, reserve approval, send Auth invitation, record result without exposing tokens", async () => {
  const f = fixture();
  const result = await inviteParent(request({ family_id: family, email: " Parent@Example.invalid ",
    redirectTo: "https://evil.example", user_id: "other" }), f);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { code: "email_sent" });
  assert.deepEqual(f.calls.map((call) => call[0]),
    ["role", "identity", "reserve_guardian_invitation_email", "invite", "finish_guardian_invitation_email"]);
  assert.deepEqual(f.calls[1], ["identity", "user_id", "coach"]);
  assert.deepEqual(f.calls[2][1], { p_family_id: family, p_email: "parent@example.invalid" });
  assert.deepEqual(f.calls[3], ["invite", "parent@example.invalid",
    { redirectTo: "https://newvision-athletics.com/auth/callback.html" }]);
  assert.deepEqual(f.calls[4][1], { p_attempt_id: "attempt", p_sent: true });
});

test("existing confirmed parent receives OTP with account creation disabled", async () => {
  const f = fixture({ inviteError: { code: "email_exists" } });
  assert.equal((await inviteParent(request(), f)).status, 200);
  assert.deepEqual(f.calls.find((call) => call[0] === "otp")[1], {
    email: "parent@example.invalid", options: { shouldCreateUser: false,
      emailRedirectTo: "https://newvision-athletics.com/auth/callback.html" },
  });
});

test("signed-out, parent, failed role lookup, malformed body and bad origin never reserve or send", async () => {
  for (const [options, overrides, req, status] of [
    [{}, { userId: null }, request(), 401],
    [{ parent: true }, {}, request(), 403],
    [{ roleError: { code: "offline" } }, {}, request(), 503],
    [{}, {}, request({ family_id: family, email: "bad" }), 400],
    [{}, {}, request({ family_id: "bad", email: "parent@example.invalid" }), 400],
    [{}, { publicOrigin: "https://site.example/path" }, request(), 503],
    [{}, { publicOrigin: "http://site.example" }, request(), 503],
    [{}, {}, request(null), 400],
    [{}, {}, request(undefined, "GET"), 405],
  ]) {
    const f = { ...fixture(options), ...overrides };
    assert.equal((await inviteParent(req, f)).status, status);
    assert.ok(!f.calls.some((call) => call[0] === "invite" || call[0].startsWith("reserve")));
  }
});

test("cooldown, linked membership, and revoked coach stop Auth calls", async () => {
  for (const [error, status, code] of [
    [{ message: "Invitation email is still being sent" }, 429, "send_in_progress"],
    [{ message: "Please wait before resending" }, 429, "wait_before_resending"],
    [{ message: "This email already has family access" }, 409, "already_linked"],
    [{ code: "42501" }, 403, "coach_required"],
  ]) {
    const f = fixture({ reserveError: error });
    const result = await inviteParent(request(), f);
    assert.equal(result.status, status);
    assert.deepEqual(await result.json(), { code });
    assert.ok(!f.calls.some((call) => call[0] === "invite"));
  }
});

test("SMTP failures keep approval for retry and cannot report sent", async () => {
  for (const options of [
    { throwMail: true }, { inviteError: { code: "over_email_send_rate_limit" } },
    { inviteError: { code: "email_exists" }, otpError: { code: "smtp_failure" } },
  ]) {
    const f = fixture(options);
    const result = await inviteParent(request(), f);
    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { code: "email_failed" });
    assert.deepEqual(f.calls.find((call) => call[0] === "finish_guardian_invitation_email")[1],
      { p_attempt_id: "attempt", p_sent: false });
  }
});

test("accepted mail is not sent a second time when result recording fails", async () => {
  const f = fixture({ finishError: { code: "offline" } });
  assert.equal((await inviteParent(request(), f)).status, 200);
  assert.equal(f.calls.filter((call) => call[0] === "invite").length, 1);
  assert.deepEqual(f.calls.find((call) => call[0] === "log"),
    ["log", "Invitation email status could not be recorded"]);
});

test("routing uses verified user ID and saved coach membership, not user metadata", async () => {
  const coach = fixture();
  assert.equal(await signInDestination(coach.caller), "/coach/");
  assert.deepEqual(coach.calls[1], ["identity", "user_id", "verified-id"]);
  assert.equal(await signInDestination(fixture({ parent: true }).caller), "/parent/");
  await assert.rejects(signInDestination(fixture({ roleError: {} }).caller), /route/);
  await assert.rejects(signInDestination(fixture({ userError: {} }).caller), /route/);
});
