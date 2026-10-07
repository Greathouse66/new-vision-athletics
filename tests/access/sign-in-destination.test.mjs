import test from "node:test";
import assert from "node:assert/strict";
import {
  dropInPath, requestedParentDestination, signInCallbackUrl, signInDestination,
} from "../../scripts/auth/destination.mjs";

function client({ coach = false, userError = null, roleError = null } = {}) {
  return {
    auth: { async getUser() { return { data: { user: { id: "verified-user" } }, error: userError }; } },
    from(table) {
      assert.equal(table, "coach_users");
      return { select() { return this; }, eq(field, id) {
        assert.equal(field, "user_id");
        assert.equal(id, "verified-user");
        return this;
      }, async maybeSingle() { return { data: coach ? { user_id: "verified-user" } : null, error: roleError }; } };
    },
  };
}

test("parents return to drop-in requests; normal sign-in and coach routing remain intact", async () => {
  assert.equal(await signInDestination(client(), dropInPath), dropInPath);
  assert.equal(await signInDestination(client()), "/parent/");
  assert.equal(await signInDestination(client({ coach: true }), dropInPath), "/coach/");
  await assert.rejects(signInDestination(client({ userError: {} }), dropInPath), /route/);
  await assert.rejects(signInDestination(client({ roleError: {} }), dropInPath), /route/);
});

test("return destinations cannot redirect parents to external URLs or other private pages", async () => {
  assert.equal(requestedParentDestination(`?next=${encodeURIComponent(dropInPath)}`), dropInPath);
  for (const next of ["https://example.invalid/", "//example.invalid/", "/coach/", "/parent/payments.html", "/parent/drop-ins.html?admin=true", "javascript:alert(1)"]) {
    assert.equal(requestedParentDestination(`?next=${encodeURIComponent(next)}`), "");
    assert.equal(await signInDestination(client(), next), "/parent/");
  }
  assert.equal(requestedParentDestination(), "");
});

test("the email callback carries the drop-in destination across browsers and devices", () => {
  const origin = "https://newvision-athletics.com";
  const callback = new URL(signInCallbackUrl(origin, dropInPath));
  assert.equal(callback.origin, origin);
  assert.equal(callback.pathname, "/auth/callback.html");
  assert.equal(requestedParentDestination(callback.search), dropInPath);
  assert.equal(signInCallbackUrl(origin), `${origin}/auth/callback.html`);
  assert.equal(signInCallbackUrl(origin, "https://example.invalid"), `${origin}/auth/callback.html`);
});
