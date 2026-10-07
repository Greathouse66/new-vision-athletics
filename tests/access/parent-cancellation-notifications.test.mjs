import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../helpers/database.mjs";
import { deliverCancellationNotification } from "../../supabase/functions/drop-in-notification-worker/cancellation-delivery.mjs";

let db;
const coach = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const coach2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const stranger = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const pending = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const family = "11111111-1111-4111-8111-111111111111";
const athlete = "33333333-3333-4333-8333-333333333333";
const occurrence = "55555555-5555-4555-8555-555555555555";
const review = "https://newvision-athletics.com/coach/cancellations.html";
const sender = "receipts@newvision-athletics.com";
before(async () => { db = await testDatabase(); });
after(async () => { await db?.close(); });
async function as(role, user = "") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
}
async function denied(fn, regex = /permission denied|Coach access required/) {
  await db.exec("savepoint expected_failure");
  try { await assert.rejects(fn, regex); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}
async function fixture(run) {
  await db.exec("begin");
  try {
    await db.exec(`
      insert into auth.users values ('${coach}', 'coach@example.invalid', now()),
        ('${parent}', 'parent@example.invalid', now()), ('${coach2}', 'second@example.invalid', now()),
        ('${stranger}', 'stranger@example.invalid', now()), ('${pending}', 'pending@example.invalid', null);
      insert into public.coach_users(user_id) values ('${coach}'), ('${coach2}'), ('${pending}');
      insert into public.families(id, display_name) values ('${family}', 'Cancellation family');
      insert into public.athletes(id, family_id, display_name) values ('${athlete}', '${family}', 'Test athlete');
      insert into public.family_guardians(family_id, user_id) values ('${family}', '${parent}');
      insert into public.class_occurrences(id, standing_slot_id, class_date, starts_at, ends_at, capacity, location_id)
        select '${occurrence}', s.id, current_date + 7, now() + interval '7 days',
          now() + interval '7 days 1 hour', 10, l.id from public.standing_class_slots s
          cross join public.class_locations l where s.class_kind = 'intro' limit 1;
    `);
    await run();
  } finally { await db.exec("rollback; reset role"); }
}
async function subscribe(user = coach, enabled = true) {
  await as("authenticated", user);
  await db.query("select public.set_my_cancellation_email_preference($1)", [enabled]);
}
async function book(regular = false) {
  await as("authenticated", coach);
  if (!regular) return (await db.query("select public.confirm_coach_drop_in($1,$2) as id", [occurrence, athlete])).rows[0].id;
  const row = (await db.query("select standing_slot_id,class_date from public.class_occurrences where id=$1", [occurrence])).rows[0];
  await db.query("select public.add_regular_class_athlete($1,$2,$3)", [row.standing_slot_id, athlete, row.class_date]);
  return (await db.query("select id from public.class_seats where occurrence_id=$1 and athlete_id=$2 and cancelled_at is null", [occurrence, athlete])).rows[0].id;
}
async function cancel(seat) {
  await as("authenticated", parent);
  return (await db.query("select public.cancel_my_class_seat($1) as id", [seat])).rows[0].id;
}
async function queued() {
  await as("postgres");
  return (await db.query("select * from private.parent_cancellation_notification_outbox")).rows;
}
async function claim() {
  await as("service_role");
  return (await db.query("select public.claim_parent_cancellation_notification($1,$2) as job", [review, sender])).rows[0].job;
}
async function current(job) {
  return (await db.query("select public.parent_cancellation_notification_current($1,$2,$3) as ok",
    [job.payload.seatId, job.payload.coachId, job.leaseToken])).rows[0].ok;
}
async function settle(job, sent = false, failure = "temporary") {
  return db.query("select public.settle_parent_cancellation_notification($1,$2,$3,$4,$5,$6)",
    [job.payload.seatId, job.payload.coachId, job.leaseToken, sent, sent ? "provider-id" : null, sent ? null : failure]);
}

test("coach cancellation preference requires a verified coach and remains independent of drop-in alerts", async () => fixture(async () => {
  await as("anon"); await denied(() => db.query("select * from public.my_cancellation_email_preference()"));
  await as("authenticated", parent); await denied(() => db.query("select public.set_my_cancellation_email_preference(true)"));
  await as("authenticated", pending);
  await denied(() => db.query("select public.set_my_cancellation_email_preference(true)"), /Verified coach email required/);
  await as("authenticated", coach);
  assert.equal((await db.query("select * from public.my_cancellation_email_preference()")).rows[0].enabled, false);
  await db.query("select public.set_my_drop_in_email_preference(true)");
  assert.equal((await db.query("select * from public.my_cancellation_email_preference()")).rows[0].enabled, false);
  await subscribe();
  assert.deepEqual((await db.query("select * from public.my_cancellation_email_preference()")).rows,
    [{ enabled: true, email: "coach@example.invalid" }]);
  await db.query("select public.set_my_drop_in_email_preference(false)");
  assert.equal((await db.query("select * from public.my_cancellation_email_preference()")).rows[0].enabled, true);
  await subscribe(coach, false);
  await db.query("select public.set_my_drop_in_email_preference(true)");
  assert.equal((await db.query("select * from public.my_drop_in_email_preference()")).rows[0].enabled, true);
  await as("authenticated", coach2);
  assert.equal((await db.query("select * from public.my_cancellation_email_preference()")).rows[0].enabled, false);
}));

test("parent cancellation of regular and drop-in seats queues once per subscribed coach without ending assignments", async () => {
  for (const regular of [false, true]) await fixture(async () => {
    await subscribe(); await subscribe(coach2);
    const seat = await book(regular);
    assert.equal(await cancel(seat), seat);
    assert.equal(await cancel(seat), seat);
    const rows = await queued();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.recipient_email).sort(), ["coach@example.invalid", "second@example.invalid"]);
    const first = await claim(); const second = await claim();
    assert.notEqual(first.payload.coachId, second.payload.coachId);
    assert.equal(first.payload.seatId, seat);
    assert.equal(first.payload.seatKind, regular ? "regular" : "drop_in");
    assert.equal(first.payload.athleteName, "Test athlete");
    assert.ok(first.payload.cancelledAt);
    assert.equal(await current(first), true);
    assert.equal(await claim(), null);
    await settle(first, true); await settle(second, true);
    assert.equal(await claim(), null);
    await as("postgres");
    assert.equal((await db.query("select count(*)::int as n from public.class_seats where cancelled_at is null")).rows[0].n, 0);
    if (regular) assert.equal((await db.query("select ends_on from public.regular_class_assignments")).rows[0].ends_on, null);
  });
});

test("old cancellations are not backfilled; coach cancellations and unauthorized parent attempts send nothing", async () => {
  await fixture(async () => {
    const seat = await book(); await cancel(seat); await subscribe();
    assert.equal((await queued()).length, 0);
  });
  await fixture(async () => {
    await subscribe(); const seat = await book();
    await as("authenticated", stranger);
    await denied(() => db.query("select public.cancel_my_class_seat($1)", [seat]), /Guardian access required/);
    await as("authenticated", coach); await db.query("select public.cancel_coach_class_seat($1)", [seat]);
    assert.equal((await queued()).length, 0);
    assert.equal((await db.query("select * from public.parent_class_cancellations")).rows.length, 0);
  });
});

test("browser roles cannot read, alter, claim or settle cancellation mail", async () => fixture(async () => {
  await subscribe(); const seat = await book(); await cancel(seat);
  for (const [role, user] of [["anon", ""], ["authenticated", parent], ["authenticated", stranger], ["authenticated", coach]]) {
    await as(role, user);
    await denied(() => db.query("select * from private.parent_cancellation_notification_outbox"));
    await denied(() => db.query("update private.parent_cancellation_notification_outbox set recipient_email='wrong@example.invalid'"));
    await denied(() => db.query("select public.claim_parent_cancellation_notification($1,$2)", [review, sender]));
    await denied(() => db.query("select public.parent_cancellation_notification_current($1,$2,$3)", [seat, coach, occurrence]));
    await denied(() => db.query("select public.settle_parent_cancellation_notification($1,$2,$3,true,'id',null)", [seat, coach, occurrence]));
  }
}));

test("coach opt-out, email changes, confirmation loss and coach revocation prevent sending even after claim", async () => {
  for (const change of [
    () => db.query("update private.coach_drop_in_email_preferences set cancellations_enabled=false where user_id=$1", [coach]),
    () => db.query("update auth.users set email='changed@example.invalid' where id=$1", [coach]),
    () => db.query("update auth.users set email_confirmed_at=null where id=$1", [coach]),
    () => db.query("delete from public.coach_users where user_id=$1", [coach]),
  ]) await fixture(async () => {
    await subscribe(); const seat = await book(); await cancel(seat); const job = await claim();
    await as("postgres"); await change(); await as("service_role");
    assert.equal(await current(job), false);
  });
  await fixture(async () => {
    await subscribe(); const seat = await book(); await cancel(seat); await subscribe(coach, false);
    assert.deepEqual(await claim(), { skipped: true });
    assert.equal((await queued())[0].status, "skipped");
  });
});

test("coach cancellation history still notifies after parent revocation, a replacement booking or the class start", async () => fixture(async () => {
  await subscribe(); const seat = await book(); await cancel(seat);
  await as("authenticated", coach); await db.query("select public.revoke_guardian_access($1,$2)", [family, parent]);
  const replacement = await book(); assert.notEqual(replacement, seat);
  await as("postgres");
  await db.exec("update public.class_occurrences set starts_at=now()-interval '2 hours', ends_at=now()-interval '1 hour'");
  const job = await claim();
  assert.equal(job.payload.seatId, seat);
  assert.equal(await current(job), true);
}));

test("cancellation retries freeze their payload and leases; sent and older uncertain jobs do not resend", async () => {
  await fixture(async () => {
    await subscribe(); const seat = await book(); await cancel(seat); const first = await claim(); await settle(first);
    assert.equal(await claim(), null);
    await as("postgres");
    await db.exec("update private.parent_cancellation_notification_outbox set next_attempt_at=now()-interval '1 minute'; update public.athletes set display_name='Changed name'");
    const retry = await claim();
    assert.deepEqual(retry.payload, first.payload); assert.notEqual(retry.leaseToken, first.leaseToken);
    await denied(() => settle(first, true), /lease unavailable/);
    await settle(retry, true); assert.equal(await claim(), null);
  });
  await fixture(async () => {
    await subscribe(); const seat = await book(); await cancel(seat); await claim(); await as("postgres");
    await db.exec("update private.parent_cancellation_notification_outbox set first_attempt_at=now()-interval '21 hours', lease_until=now()-interval '1 minute'");
    assert.equal(await claim(), null); assert.equal((await queued())[0].status, "review");
  });
});

test("real SQL cancellation delivers to the captured coach once and records its provider result", async () => fixture(async () => {
  await subscribe(); const seat = await book(); await cancel(seat); await as("service_role");
  const admin = { async rpc(name, args) {
    const keys = Object.keys(args);
    const row = (await db.query(`select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(",")}) as result`, Object.values(args))).rows[0];
    return { data: row.result };
  } };
  const sends = [];
  const send = async (url, args) => { sends.push([url, args]); return Response.json({ id: "integration-id" }); };
  const config = { apiKey: "test-only", from: sender, reviewUrl: review };
  assert.deepEqual(await (await deliverCancellationNotification(admin, config, send)).json(), { status: "sent" });
  assert.deepEqual(await (await deliverCancellationNotification(admin, config, send)).json(), { status: "idle" });
  assert.equal(sends.length, 1);
  assert.deepEqual(JSON.parse(sends[0][1].body).to, ["coach@example.invalid"]);
  assert.equal(sends[0][1].headers["Idempotency-Key"], `nva-parent-cancelled-${seat}-${coach}`);
  assert.equal((await queued())[0].provider_message_id, "integration-id");
}));
