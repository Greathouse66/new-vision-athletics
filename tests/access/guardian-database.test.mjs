import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

// Real PostgreSQL functions and RLS in an isolated, disposable WASM database.
// Supabase Auth is represented only by its ID/email/confirmation columns.
let db;
const coach = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const parent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const stranger = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const unconfirmed = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const family = "11111111-1111-4111-8111-111111111111";
const otherFamily = "22222222-2222-4222-8222-222222222222";
const athlete = "33333333-3333-4333-8333-333333333333";
const otherAthlete = "44444444-4444-4444-8444-444444444444";

before(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth; create schema extensions;
    grant usage on schema auth to anon, authenticated, service_role;
    create table auth.users(id uuid primary key, email varchar(255), email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
  `);
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    // Network/cron extensions belong to the hosted scheduler, not family permissions.
    if (file.includes("receipt_scheduler_extensions")) continue;
    if (file.includes("weekly_slots_and_dated_classes")) {
      await db.exec("insert into public.skill_groups(name) values ('Foundational'), ('Post-Bigs'), ('Advanced')");
    }
    await db.exec(await readFile(new URL(file, directory), "utf8"));
  }
});
after(async () => { await db?.close(); });

async function as(role, user = "") {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role ${role};`);
}
async function fixture(run) {
  await db.exec("begin");
  try {
    await db.exec(`
      insert into auth.users values
        ('${coach}', 'coach@example.invalid', now()), ('${parent}', 'parent@example.invalid', now()),
        ('${stranger}', 'other@example.invalid', now()), ('${unconfirmed}', 'pending@example.invalid', null);
      insert into public.coach_users(user_id) values ('${coach}');
      insert into public.families(id, display_name) values ('${family}', 'Linked family'), ('${otherFamily}', 'Other family');
      insert into public.athletes(id, family_id, display_name) values
        ('${athlete}', '${family}', 'Linked athlete'), ('${otherAthlete}', '${otherFamily}', 'Other athlete');
    `);
    await run();
  } finally { await db.exec("reset role; rollback"); }
}
async function reserve(email = "parent@example.invalid", id = family) {
  return (await db.query("select * from public.reserve_guardian_invitation_email($1, $2)", [id, email])).rows[0];
}
async function accept(id) { await db.query("select public.accept_guardian_invitation($1)", [id]); }
async function rejected(action, pattern) {
  await db.exec("savepoint expected_failure");
  await assert.rejects(action, pattern);
  await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure");
}
async function ageDelivery() {
  await as("postgres");
  await db.exec("update private.guardian_invitation_deliveries set attempted_at = now() - interval '3 minutes'");
  await as("authenticated", coach);
}

test("only coaches reserve emails; clients cannot read delivery state or forge success", async () => fixture(async () => {
  await as("anon"); await rejected(() => reserve(), /permission denied/);
  await as("authenticated", stranger); await rejected(() => reserve(), /Coach access required/);
  await as("authenticated", coach);
  const invitation = await reserve();
  await rejected(() => db.query("select * from private.guardian_invitation_deliveries"), /permission denied/);
  await rejected(() => db.query("select public.finish_guardian_invitation_email($1, true)", [invitation.attempt_id]), /permission denied/);
  await as("service_role");
  await db.query("select public.finish_guardian_invitation_email($1, true)", [invitation.attempt_id]);
  await as("postgres");
  assert.equal((await db.query("select outcome from private.guardian_invitation_deliveries")).rows[0].outcome, "sent");
}));

test("duplicate sends are throttled across families; resend reuses approval without extending expiry", async () => fixture(async () => {
  await as("authenticated", coach);
  const first = await reserve(" Parent@Example.invalid ");
  await rejected(() => reserve(), /still being sent/);
  await as("service_role");
  await db.query("select public.finish_guardian_invitation_email($1, true)", [first.attempt_id]);
  await as("authenticated", coach);
  await rejected(() => reserve(), /wait before resending/);
  await rejected(() => reserve("parent@example.invalid", otherFamily), /wait before resending/);
  const expiry = (await db.query("select expires_at from public.guardian_invitations")).rows[0].expires_at;
  await ageDelivery();
  const resent = await reserve();
  assert.equal(resent.invitation_id, first.invitation_id);
  assert.notEqual(resent.attempt_id, first.attempt_id);
  assert.deepEqual((await db.query("select expires_at from public.guardian_invitations")).rows[0].expires_at, expiry);
  await as("service_role");
  await db.query("select public.finish_guardian_invitation_email($1, true)", [first.attempt_id]);
  await as("postgres");
  assert.equal((await db.query("select outcome from private.guardian_invitation_deliveries")).rows[0].outcome, "sending");
}));

test("wrong or unconfirmed emails cannot accept; sending never creates membership", async () => fixture(async () => {
  await as("authenticated", coach);
  const invitation = await reserve();
  const pendingEmail = await reserve("pending@example.invalid");
  await as("authenticated", stranger);
  assert.deepEqual((await db.query("select * from public.list_my_guardian_invitations()")).rows, []);
  await rejected(() => accept(invitation.invitation_id), /Invitation unavailable/);
  await rejected(() => db.query("insert into public.family_guardians values ($1, $2, now())", [family, stranger]), /permission denied/);
  await as("authenticated", unconfirmed);
  assert.deepEqual((await db.query("select * from public.list_my_guardian_invitations()")).rows, []);
  await rejected(() => accept(pendingEmail.invitation_id), /Verified sign-in required/);
  await as("authenticated", parent);
  assert.equal((await db.query("select * from public.list_my_guardian_invitations()")).rows.length, 1);
  assert.deepEqual((await db.query("select * from public.family_guardians")).rows, []);
  await accept(invitation.invitation_id);
  assert.equal((await db.query("select family_id from public.family_guardians")).rows[0].family_id, family);
  await rejected(() => accept(invitation.invitation_id), /Invitation unavailable/);
}));

test("cancelled and expired approvals cannot grant access; expired approval is replaced for a new send", async () => fixture(async () => {
  await as("authenticated", coach);
  const cancelled = await reserve();
  await db.query("select public.revoke_guardian_invitation($1)", [cancelled.invitation_id]);
  await as("authenticated", parent);
  await rejected(() => accept(cancelled.invitation_id), /Invitation unavailable/);
  await ageDelivery();
  await as("service_role");
  await db.query("select public.finish_guardian_invitation_email($1, false)", [cancelled.attempt_id]);
  await as("authenticated", coach);
  const expiring = await reserve();
  await as("postgres");
  await db.query("update public.guardian_invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = $1", [expiring.invitation_id]);
  await as("authenticated", parent);
  await rejected(() => accept(expiring.invitation_id), /Invitation unavailable/);
  await ageDelivery();
  await as("postgres");
  await db.exec("update private.guardian_invitation_deliveries set attempted_at = now() - interval '6 minutes'");
  await as("authenticated", coach);
  const replacement = await reserve();
  assert.notEqual(replacement.invitation_id, expiring.invitation_id);
}));

test("a second parent accepts independently without replacing the first parent's access", async () => fixture(async () => {
  await as("authenticated", coach);
  const first = await reserve();
  const second = await reserve("other@example.invalid");
  await as("authenticated", parent);
  await accept(first.invitation_id);
  await rejected(() => accept(second.invitation_id), /Invitation unavailable/);
  await as("authenticated", stranger);
  assert.deepEqual((await db.query("select invitation_id from public.list_my_guardian_invitations()")).rows,
    [{ invitation_id: second.invitation_id }]);
  await accept(second.invitation_id);
  assert.deepEqual((await db.query("select id from public.athletes")).rows.map((r) => r.id), [athlete]);
  await as("postgres");
  assert.equal((await db.query("select * from public.family_guardians where family_id = $1", [family])).rows.length, 2);
}));

test("acceptance isolates athletes, balances and sessions; revocation removes all three", async () => fixture(async () => {
  await as("postgres");
  await db.exec(`
    insert into public.athlete_monthly_charges(family_id, athlete_id, service_month, currency, amount_minor_units, assigned_by)
      values ('${family}', '${athlete}', '2026-10-01', 'USD', 100, '${coach}'),
             ('${otherFamily}', '${otherAthlete}', '2026-10-01', 'USD', 99900, '${coach}');
  `);
  const occurrence = (await db.query(`
    insert into public.class_occurrences(standing_slot_id, class_date, starts_at, ends_at, capacity, location_id)
    select s.id, current_date + 7, now() + interval '7 days', now() + interval '7 days 1 hour', 10, l.id
    from public.standing_class_slots s cross join public.class_locations l limit 1 returning id
  `)).rows[0].id;
  await as("authenticated", coach);
  await db.query("select public.confirm_coach_drop_in($1, $2)", [occurrence, athlete]);
  await db.query("select public.confirm_coach_drop_in($1, $2)", [occurrence, otherAthlete]);
  const invitation = await reserve();
  await as("authenticated", parent);
  assert.deepEqual((await db.query("select * from public.athletes")).rows, []);
  assert.deepEqual((await db.query("select * from public.list_my_monthly_charges()")).rows, []);
  assert.deepEqual((await db.query("select * from public.list_my_upcoming_sessions()")).rows, []);
  await accept(invitation.invitation_id);
  assert.deepEqual((await db.query("select id from public.athletes")).rows.map((r) => r.id), [athlete]);
  assert.deepEqual((await db.query("select family_id from public.list_my_monthly_charges()")).rows.map((r) => r.family_id), [family]);
  assert.deepEqual((await db.query("select athlete_id from public.list_my_upcoming_sessions()")).rows.map((r) => r.athlete_id), [athlete]);
  assert.deepEqual((await db.query("select * from public.athletes where family_id = $1", [otherFamily])).rows, []);
  await as("authenticated", coach);
  await ageDelivery();
  await rejected(() => reserve(), /already has family access/);
  await db.query("select public.revoke_guardian_access($1, $2)", [family, parent]);
  await as("authenticated", parent);
  assert.deepEqual((await db.query("select * from public.athletes")).rows, []);
  assert.deepEqual((await db.query("select * from public.list_my_monthly_charges()")).rows, []);
  assert.deepEqual((await db.query("select * from public.list_my_upcoming_sessions()")).rows, []);
  await rejected(() => accept(invitation.invitation_id), /Invitation unavailable/);
  await as("postgres");
  assert.deepEqual((await db.query("select action from public.guardian_access_events order by id")).rows.map((r) => r.action), ["granted", "revoked"]);
}));
