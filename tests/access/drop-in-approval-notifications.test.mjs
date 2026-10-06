import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../helpers/database.mjs";
import { deliverApprovalNotification } from "../../supabase/functions/drop-in-notification-worker/approval-delivery.mjs";

let db;
const coach = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherParent = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const stranger = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const family = "11111111-1111-4111-8111-111111111111";
const otherFamily = "22222222-2222-4222-8222-222222222222";
const athlete = "33333333-3333-4333-8333-333333333333";
const otherAthlete = "44444444-4444-4444-8444-444444444444";
const occurrence = "55555555-5555-4555-8555-555555555555";
const portal = "https://newvision-athletics.com/parent/sessions.html";
const sender = "receipts@newvision-athletics.com";
before(async () => { db = await testDatabase(); });
after(async () => { await db?.close(); });

async function as(role, user = "") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
}
async function denied(fn, pattern = /permission denied|Coach access required/) {
  await db.exec("savepoint expected_failure");
  try { await assert.rejects(fn, pattern); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}
async function fixture(run) {
  await db.exec("begin");
  try {
    await db.exec(`
      insert into auth.users values ('${coach}', 'coach@example.invalid', now()),
        ('${parent}', 'requester@example.invalid', now()), ('${otherParent}', 'guardian@example.invalid', now()),
        ('${stranger}', 'stranger@example.invalid', now());
      insert into public.coach_users(user_id) values ('${coach}');
      insert into public.families(id, display_name) values ('${family}', 'Linked family'), ('${otherFamily}', 'Other family');
      insert into public.athletes(id, family_id, display_name) values
        ('${athlete}', '${family}', 'Test athlete'), ('${otherAthlete}', '${otherFamily}', 'Other athlete');
      insert into public.family_guardians(family_id, user_id) values
        ('${family}', '${parent}'), ('${family}', '${otherParent}'), ('${otherFamily}', '${stranger}');
      insert into public.class_occurrences(id, standing_slot_id, class_date, starts_at, ends_at, capacity, location_id)
        select '${occurrence}', s.id, current_date + 7, now() + interval '7 days',
          now() + interval '7 days 1 hour', 10, l.id from public.standing_class_slots s
          cross join public.class_locations l where s.class_kind = 'intro' limit 1;
    `);
    await run();
  } finally { await db.exec("rollback; reset role"); }
}
async function request() {
  await as("authenticated", parent);
  return (await db.query("select public.request_drop_in($1,$2) as id", [athlete, occurrence])).rows[0].id;
}
async function approve(id, decision = true) {
  await as("authenticated", coach);
  return (await db.query("select public.review_drop_in_request($1,$2) as seat", [id, decision])).rows[0].seat;
}
async function queued() {
  await as("postgres");
  return (await db.query("select * from private.drop_in_approval_notification_outbox")).rows;
}
async function claim() {
  await as("service_role");
  return (await db.query("select public.claim_drop_in_approval_notification($1,$2) as job", [portal, sender])).rows[0].job;
}
async function current(job) {
  return (await db.query("select public.drop_in_approval_notification_current($1,$2,$3) as ok",
    [job.payload.requestId, job.payload.parentId, job.leaseToken])).rows[0].ok;
}
async function settle(job, sent = false, failure = "temporary") {
  return db.query("select public.settle_drop_in_approval_notification($1,$2,$3,$4,$5,$6)",
    [job.payload.requestId, job.payload.parentId, job.leaseToken, sent, sent ? "provider-id" : null, sent ? null : failure]);
}

test("approval queues one confirmation only for the requesting parent after a seat is reserved", async () => fixture(async () => {
  const id = await request();
  assert.equal((await queued()).length, 0);
  const seat = await approve(id);
  const rows = await queued();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].parent_id, parent);
  assert.equal(rows[0].recipient_email, "requester@example.invalid");
  const job = await claim();
  assert.equal(job.payload.seatId, seat);
  assert.equal(job.payload.requestId, id);
  assert.equal(job.payload.portalUrl, portal);
  assert.equal(await current(job), true);
  assert.equal(await claim(), null); // An active lease prevents a concurrent claim.
  await settle(job, true);
  assert.equal(await claim(), null);
}));

test("declines, failed approvals and repeated approval cannot generate another email or place", async () => {
  await fixture(async () => {
    const id = await request(); await approve(id, false);
    assert.equal((await queued()).length, 0);
  });
  await fixture(async () => {
    const id = await request();
    await as("authenticated", parent);
    await denied(() => db.query("select public.review_drop_in_request($1,true)", [id]));
    await as("postgres"); await db.exec("update public.class_occurrences set capacity=1");
    await as("authenticated", coach);
    await db.query("select public.confirm_coach_drop_in($1,$2)", [occurrence, otherAthlete]);
    await denied(() => db.query("select public.review_drop_in_request($1,true)", [id]), /full/);
    assert.equal((await queued()).length, 0);
  });
  await fixture(async () => {
    const id = await request(); await approve(id);
    await as("authenticated", coach);
    await denied(() => db.query("select public.review_drop_in_request($1,true)", [id]), /already reviewed/);
    assert.equal((await queued()).length, 1);
    assert.equal((await db.query("select * from public.class_seats")).rows.length, 1);
  });
});

test("browsers cannot read the private parent queue, forge a send or change its recipient", async () => fixture(async () => {
  const id = await request(); await approve(id);
  for (const [role, user] of [["anon", ""], ["authenticated", parent], ["authenticated", otherParent],
    ["authenticated", stranger], ["authenticated", coach]]) {
    await as(role, user);
    await denied(() => db.query("select * from private.drop_in_approval_notification_outbox"));
    await denied(() => db.query("select public.claim_drop_in_approval_notification($1,$2)", [portal, sender]));
    await denied(() => db.query("select public.drop_in_approval_notification_current($1,$2,$3)", [id, parent, occurrence]));
    await denied(() => db.query("select public.settle_drop_in_approval_notification($1,$2,$3,true,'id',null)", [id, parent, occurrence]));
    await denied(() => db.query("update private.drop_in_approval_notification_outbox set recipient_email='wrong@example.invalid'"));
  }
}));

test("revocation, changed or unconfirmed email, cancellation and a past class skip pending confirmations", async () => {
  for (const change of [
    () => db.query("delete from public.family_guardians where family_id=$1 and user_id=$2", [family, parent]),
    () => db.query("update auth.users set email='changed@example.invalid' where id=$1", [parent]),
    () => db.query("update auth.users set email_confirmed_at=null where id=$1", [parent]),
    () => db.query("update public.class_seats set cancelled_at=now(),cancelled_by=$1", [coach]),
    () => db.exec("update public.class_occurrences set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'"),
  ]) await fixture(async () => {
    const id = await request(); await approve(id); await as("postgres"); await change();
    assert.deepEqual(await claim(), { skipped: true });
    assert.equal((await queued())[0].status, "skipped");
    assert.equal(await claim(), null);
  });
});

test("revoked parent access or cancelled reservation after a claim fails the pre-send check", async () => {
  for (const cancelSeat of [false, true]) await fixture(async () => {
    const id = await request(); const seat = await approve(id); const job = await claim();
    if (cancelSeat) {
      await as("authenticated", parent);
      await db.query("select public.cancel_my_class_seat($1)", [seat]);
    } else {
      await as("authenticated", coach);
      await db.query("select public.revoke_guardian_access($1,$2)", [family, parent]);
    }
    await as("service_role");
    assert.equal(await current(job), false);
    await settle(job, false, "no_longer_current");
    assert.equal((await queued())[0].status, "skipped");
  });
});

test("unconfirmed parents get no queued email, and confirmations do not depend on coach subscriptions", async () => fixture(async () => {
  const id = await request();
  await as("postgres"); await db.query("update auth.users set email_confirmed_at=null where id=$1", [parent]);
  const seat = await approve(id);
  assert.ok(seat);
  assert.equal((await queued()).length, 0);
  assert.equal((await db.query("select * from private.coach_drop_in_email_preferences")).rows.length, 0);
}));

test("parent retries keep frozen payloads and fresh leases; sent and old uncertain jobs are not resent", async () => {
  await fixture(async () => {
    const id = await request(); await approve(id);
    const first = await claim(); await settle(first);
    assert.equal(await claim(), null);
    await as("postgres");
    await db.exec("update private.drop_in_approval_notification_outbox set next_attempt_at=now()-interval '1 minute'; update public.athletes set display_name='Changed name'");
    const retry = await claim();
    assert.deepEqual(retry.payload, first.payload);
    assert.notEqual(retry.leaseToken, first.leaseToken);
    await denied(() => settle(first, true), /lease unavailable/);
    await settle(retry, true);
    assert.equal(await claim(), null);
    assert.equal((await queued())[0].status, "sent");
  });
  await fixture(async () => {
    const id = await request(); await approve(id); await claim(); await as("postgres");
    await db.exec("update private.drop_in_approval_notification_outbox set first_attempt_at=now()-interval '21 hours',lease_until=now()-interval '1 minute'");
    assert.equal(await claim(), null);
    assert.equal((await queued())[0].status, "review");
  });
});

test("real SQL request and approval flow delivers to the captured parent once and records the result", async () => fixture(async () => {
  const id = await request(); await approve(id); await as("service_role");
  const admin = { async rpc(name, args) {
    const keys = Object.keys(args);
    try {
      const row = (await db.query(`select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(",")}) as result`,
        Object.values(args))).rows[0];
      return { data: row.result, error: null };
    } catch (error) { return { data: null, error }; }
  } };
  const sends = [];
  const send = async (url, options) => { sends.push([url, options]); return Response.json({ id: "integration-id" }); };
  const config = { apiKey: "test-only", from: sender, portalUrl: portal };
  assert.deepEqual(await (await deliverApprovalNotification(admin, config, send)).json(), { status: "sent" });
  assert.deepEqual(await (await deliverApprovalNotification(admin, config, send)).json(), { status: "idle" });
  assert.equal(sends.length, 1);
  const message = JSON.parse(sends[0][1].body);
  assert.deepEqual(message.to, ["requester@example.invalid"]);
  assert.match(message.text, /place is reserved/);
  assert.ok(!message.text.includes("Other athlete"));
  assert.equal((await queued())[0].provider_message_id, "integration-id");
}));
