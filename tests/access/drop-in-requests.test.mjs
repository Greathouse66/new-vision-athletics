import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "../helpers/database.mjs";

let db;
const coach = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const stranger = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const family = "11111111-1111-4111-8111-111111111111";
const otherFamily = "22222222-2222-4222-8222-222222222222";
const athlete = "33333333-3333-4333-8333-333333333333";
const otherAthlete = "44444444-4444-4444-8444-444444444444";
const occurrence = "55555555-5555-4555-8555-555555555555";
before(async () => { db = await testDatabase(); });
after(async () => { await db?.close(); });

async function as(role, user = "") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
}
async function denied(action, pattern) {
  await db.exec("savepoint expected_failure");
  try { await assert.rejects(action, pattern); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}
async function fixture(run, group = "Advanced", classLevel = "Foundational") {
  await db.exec("begin");
  try {
    await db.exec(`
      insert into auth.users values ('${coach}', 'coach@example.invalid', now()),
        ('${parent}', 'parent@example.invalid', now()), ('${stranger}', 'other@example.invalid', now());
      insert into public.coach_users(user_id) values ('${coach}');
      insert into public.families(id, display_name) values ('${family}', 'Linked family'), ('${otherFamily}', 'Other family');
      insert into public.athletes(id, family_id, display_name) values
        ('${athlete}', '${family}', 'Linked athlete'), ('${otherAthlete}', '${otherFamily}', 'Other athlete');
      insert into public.family_guardians(family_id, user_id) values ('${family}', '${parent}'), ('${otherFamily}', '${stranger}');
    `);
    if (group) await db.query(`insert into public.group_enrollments(athlete_id,group_id,starts_on)
      select $1,id,current_date from public.skill_groups where name=$2`, [athlete, group]);
    await db.query(`insert into public.class_occurrences(id,standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
      select $1,s.id,current_date+7,now()+interval '7 days',now()+interval '7 days 1 hour',1,l.id
      from public.standing_class_slots s left join public.skill_groups g on g.id=s.group_id
      cross join public.class_locations l where g.name=$2 or ($2='Intro' and s.class_kind='intro') limit 1`,
    [occurrence, classLevel]);
    await run();
  } finally { await db.exec("reset role; rollback"); }
}
async function request(id = athlete) {
  return (await db.query("select public.request_drop_in($1,$2) as id", [id, occurrence])).rows[0].id;
}

test("all skill levels can request and receive coach approval without changing group or regular assignments", async () => {
  for (const [group, level] of [["Advanced", "Foundational"], ["Foundational", "Advanced"],
    ["Post-Bigs", "Advanced"], ["Advanced", "Advanced"], ["Advanced", "Intro"], [null, "Foundational"]]) {
    await fixture(async () => {
      await as("authenticated", coach);
      await db.query("select public.set_my_drop_in_email_preference(true)");
      const before = (await db.query("select * from public.group_enrollments order by id")).rows;
      const regularBefore = (await db.query("select * from public.regular_class_assignments order by id")).rows;
      await as("authenticated", parent);
      const available = (await db.query("select * from public.list_open_drop_in_classes()")).rows;
      assert.ok(available.some(row => row.occurrence_id === occurrence && row.class_label === level && row.places_left === 1));
      const id = await request();
      assert.equal(await request(), id);
      await as("postgres");
      assert.equal((await db.query("select * from public.class_seats")).rows.length, 0);
      assert.equal((await db.query("select * from private.drop_in_notification_outbox")).rows.length, 1);
      await as("authenticated", parent);
      await denied(() => db.query("select public.review_drop_in_request($1,true)", [id]), /Coach access required/);
      await as("authenticated", coach);
      const seat = (await db.query("select public.review_drop_in_request($1,true) as seat", [id])).rows[0].seat;
      assert.ok(seat);
      assert.deepEqual((await db.query("select * from public.group_enrollments order by id")).rows, before);
      assert.deepEqual((await db.query("select * from public.regular_class_assignments order by id")).rows, regularBefore);
      await as("postgres");
      assert.equal((await db.query("select * from public.class_seats where id=$1 and seat_kind='drop_in'", [seat])).rows.length, 1);
      assert.equal((await db.query("select * from private.drop_in_approval_notification_outbox")).rows.length, 1);
    }, group, level);
  }
});

test("cross-level requests still require the caller's current family access", async () => fixture(async () => {
  await as("anon");
  await denied(() => request(), /permission denied/);
  await as("authenticated", stranger);
  await denied(() => request(), /Guardian access required/);
  await as("authenticated", parent);
  await denied(() => request(otherAthlete), /Guardian access required/);
  await as("postgres");
  await db.query("delete from public.family_guardians where user_id=$1", [parent]);
  await as("authenticated", parent);
  await denied(() => request(), /Guardian access required/);
}));

test("past or full classes and existing seats still reject cross-level requests", async () => {
  for (const change of [
    async () => db.exec("update public.class_occurrences set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'"),
    async () => { await as("authenticated", coach); await db.query("select public.confirm_coach_drop_in($1,$2)", [occurrence, otherAthlete]); },
    async () => { await as("authenticated", coach); await db.query("select public.confirm_coach_drop_in($1,$2)", [occurrence, athlete]); },
  ]) await fixture(async () => {
    await change();
    await as("authenticated", parent);
    await denied(() => request(), /unavailable|No places|already has a confirmed place/);
  });
});

test("approval rechecks capacity and revoked parent access after a cross-level request", async () => {
  for (const revoke of [false, true]) await fixture(async () => {
    await as("authenticated", parent);
    const id = await request();
    await as("authenticated", coach);
    if (revoke) await db.query("select public.revoke_guardian_access($1,$2)", [family, parent]);
    else await db.query("select public.confirm_coach_drop_in($1,$2)", [occurrence, otherAthlete]);
    await denied(() => db.query("select public.review_drop_in_request($1,true)", [id]), /full|no longer has athlete access/);
    await as("postgres");
    assert.equal((await db.query("select * from private.drop_in_approval_notification_outbox")).rows.length, 0);
    assert.equal((await db.query("select status from public.drop_in_requests where id=$1", [id])).rows[0].status, "pending");
  });
});

test("a declined cross-level request cannot be resubmitted or reserve a seat", async () => fixture(async () => {
  await as("authenticated", parent);
  const id = await request();
  await as("authenticated", coach);
  await db.query("select public.review_drop_in_request($1,false)", [id]);
  await as("authenticated", parent);
  await denied(() => request(), /already declined/);
  await as("postgres");
  assert.equal((await db.query("select * from public.class_seats")).rows.length, 0);
  assert.equal((await db.query("select * from private.drop_in_approval_notification_outbox")).rows.length, 0);
}));
