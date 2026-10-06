import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../helpers/database.mjs";

let db;
const coach = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const coach2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const unconfirmed = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const family = "11111111-1111-4111-8111-111111111111";
const athlete = "33333333-3333-4333-8333-333333333333";
const occurrence = "55555555-5555-4555-8555-555555555555";
const review = "https://newvision-athletics.com/coach/drop-ins.html";
const sender = "receipts@newvision-athletics.com";
before(async () => { db = await testDatabase(); });
after(async () => { await db?.close(); });
async function as(role, user = "") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
}
async function denied(fn, regex = /permission denied|Coach access required/) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(fn, regex);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}
async function fixture(fn) {
  await db.exec("begin");
  try {
    await db.exec(`
      insert into auth.users values ('${coach}', 'coach@example.invalid', now()),
        ('${parent}', 'parent@example.invalid', now()), ('${coach2}', 'second@example.invalid', now()),
        ('${unconfirmed}', 'pending@example.invalid', null);
      insert into public.coach_users(user_id) values ('${coach}'), ('${coach2}'), ('${unconfirmed}');
      insert into public.families(id, display_name) values ('${family}', 'Notification test family');
      insert into public.athletes(id, family_id, display_name) values ('${athlete}', '${family}', 'Test athlete');
      insert into public.family_guardians(family_id, user_id) values ('${family}', '${parent}');
      insert into public.class_occurrences(id, standing_slot_id, class_date, starts_at, ends_at, capacity, location_id)
        select '${occurrence}', s.id, current_date + 7, now() + interval '7 days',
          now() + interval '7 days 1 hour', 10, l.id from public.standing_class_slots s
          cross join public.class_locations l where s.class_kind = 'intro' limit 1;
    `);
    await fn();
  } finally { await db.exec("rollback; reset role"); }
}
async function subscribe(user = coach, enabled = true) {
  await as("authenticated", user);
  await db.query("select public.set_my_drop_in_email_preference($1)", [enabled]);
}
async function request() {
  await as("authenticated", parent);
  return (await db.query("select public.request_drop_in($1, $2) as id", [athlete, occurrence])).rows[0].id;
}
async function claim() {
  await as("service_role");
  return (await db.query("select public.claim_drop_in_notification($1, $2) as job", [review, sender])).rows[0].job;
}
async function current(job) {
  return (await db.query("select public.drop_in_notification_current($1, $2, $3) as ok",
    [job.payload.requestId, job.payload.coachId, job.leaseToken])).rows[0].ok;
}
async function settle(job, sent = false, failure = "temporary") {
  return db.query("select public.settle_drop_in_notification($1,$2,$3,$4,$5,$6)",
    [job.payload.requestId, job.payload.coachId, job.leaseToken, sent, sent ? "message-id" : null, sent ? null : failure]);
}

test("preference belongs to the verified coach, with no parent access or arbitrary recipient", async () => fixture(async () => {
  await as("anon"); await denied(() => db.query("select * from public.my_drop_in_email_preference()"));
  await as("authenticated", parent); await denied(() => db.query("select public.set_my_drop_in_email_preference(true)"));
  await as("authenticated", unconfirmed);
  await denied(() => db.query("select public.set_my_drop_in_email_preference(true)"), /Verified coach email required/);
  await subscribe();
  assert.deepEqual((await db.query("select * from public.my_drop_in_email_preference()")).rows,
    [{ enabled: true, email: "coach@example.invalid" }]);
  await as("authenticated", coach2);
  assert.deepEqual((await db.query("select * from public.my_drop_in_email_preference()")).rows,
    [{ enabled: false, email: "second@example.invalid" }]);
  await denied(() => db.query("select * from private.drop_in_notification_outbox"));
  await denied(() => db.query("select public.claim_drop_in_notification($1,$2)", [review, sender]));
}));

test("one new request queues one email per subscribed coach; repeated parent submission does not duplicate it", async () => fixture(async () => {
  await subscribe(); await subscribe(coach2);
  const id = await request();
  assert.equal(await request(), id);
  await as("postgres");
  assert.equal((await db.query("select * from private.drop_in_notification_outbox")).rows.length, 2);
  assert.equal((await db.query("select * from public.class_seats")).rows.length, 0);
  const first = await claim();
  assert.equal(first.payload.requestId, id);
  assert.equal(first.payload.athleteName, "Test athlete");
  assert.equal(await current(first), true);
  const second = await claim();
  assert.notEqual(first.payload.coachId, second.payload.coachId);
  assert.equal(await claim(), null);
  await settle(first, true); await settle(second, true);
  assert.equal(await claim(), null);
}));

test("requests made before subscribing are not backfilled and browser roles cannot claim or settle mail", async () => fixture(async () => {
  await request(); await subscribe();
  await as("authenticated", coach);
  await denied(() => db.query("select public.claim_drop_in_notification($1,$2)", [review, sender]));
  await denied(() => db.query("select public.settle_drop_in_notification($1,$2,$3,true,'id',null)", [occurrence, coach, occurrence]));
  assert.equal(await claim(), null);
}));

test("turning alerts off, changing email, or reviewing the request skips queued notifications", async () => {
  for (const change of [
    async () => subscribe(coach, false),
    async () => { await as("postgres"); await db.query("update auth.users set email='new@example.invalid' where id=$1", [coach]); },
    async () => {
      await as("postgres");
      const id = (await db.query("select id from public.drop_in_requests")).rows[0].id;
      await as("authenticated", coach);
      await db.query("select public.review_drop_in_request($1,false)", [id]);
    },
  ]) await fixture(async () => {
    await subscribe(); await request(); await change();
    assert.deepEqual(await claim(), { skipped: true });
    assert.equal(await claim(), null);
  });
});

test("revoked guardian or coach access prevents delivery, including after a claim", async () => {
  for (const revokeCoach of [false, true]) await fixture(async () => {
    await subscribe(); await request();
    const job = await claim();
    await as("postgres");
    if (revokeCoach) await db.query("delete from public.coach_users where user_id=$1", [coach]);
    else await db.query("delete from public.family_guardians where family_id=$1 and user_id=$2", [family, parent]);
    await as("service_role");
    assert.equal(await current(job), false);
    if (!revokeCoach) {
      await settle(job, false, "no_longer_current");
      await as("postgres");
      assert.equal((await db.query("select status from private.drop_in_notification_outbox")).rows[0].status, "skipped");
    }
    assert.equal(await claim(), null);
  });
});

test("retry keeps its original payload; stale settlement cannot overwrite a new lease", async () => fixture(async () => {
  await subscribe(); await request();
  const first = await claim(); await settle(first);
  assert.equal(await claim(), null);
  await as("postgres");
  await db.exec("update private.drop_in_notification_outbox set next_attempt_at=now()-interval '1 minute'; update public.athletes set display_name='Corrected name'");
  const retry = await claim();
  assert.deepEqual(retry.payload, first.payload);
  assert.notEqual(retry.leaseToken, first.leaseToken);
  await denied(() => settle(first, true), /Notification lease unavailable/);
  await settle(retry, true);
  assert.equal(await claim(), null);
}));

test("uncertain sends beyond the retry window require review instead of resending", async () => fixture(async () => {
  await subscribe(); await request(); await claim();
  await as("postgres");
  await db.exec("update private.drop_in_notification_outbox set first_attempt_at=now()-interval '21 hours', lease_until=now()-interval '1 minute'");
  assert.equal(await claim(), null);
  await as("postgres");
  assert.equal((await db.query("select status from private.drop_in_notification_outbox")).rows[0].status, "review");
}));
