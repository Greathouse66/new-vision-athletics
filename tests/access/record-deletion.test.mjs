import { before,after,test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../helpers/database.mjs';
let db,group,slot,venue;
const coach='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',parent='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const family='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const athlete='33333333-3333-4333-8333-333333333333',sibling='44444444-4444-4444-8444-444444444444';
before(async()=>{db=await testDatabase();group=(await db.query('select id from public.skill_groups limit 1')).rows[0].id;slot=(await db.query('select id from public.standing_class_slots limit 1')).rows[0].id;venue=(await db.query('select id from public.class_locations limit 1')).rows[0].id;});
after(async()=>{await db?.close();});
async function as(role,user=''){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role}`);}
async function fixture(run){await as('postgres');await db.exec('begin');try{
 await db.exec(`insert into auth.users values('${coach}','coach@example.invalid',now()),('${parent}','parent@example.invalid',now());
 insert into public.coach_users(user_id) values('${coach}');
 insert into public.families(id,display_name) values('${family}','Accidental account'),('${other}','Keep account');
 insert into public.athletes(id,family_id,display_name) values('${athlete}','${family}','Accidental Athlete');
 insert into public.group_enrollments(athlete_id,group_id,starts_on) values('${athlete}','${group}',current_date);`);
 await as('authenticated',coach);await run();
 }finally{await db.exec('rollback;reset role');}}
async function denied(fn,pattern){await db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
async function review(a=null,f=family){return(await db.query('select public.review_unused_account_deletion($1,$2) as r',[f,a])).rows[0].r;}
async function remove(r,overrides={}){const p={family_id:r.family.id,athlete_id:r.athlete_id,review_token:r.review_token,confirmation_name:r.confirmation_name,...overrides};return(await db.query('select public.delete_unused_account_record($1,$2,$3,$4) as result',Object.values(p))).rows[0].result;}
async function siblingRow(){await as('postgres');await db.query("insert into public.athletes(id,family_id,display_name) values($1,$2,'Keep Sibling')",[sibling,family]);await db.query('insert into public.group_enrollments(athlete_id,group_id,starts_on) values($1,$2,current_date)',[sibling,group]);await as('authenticated',coach);}
async function occurrence(){return(await db.query("insert into public.class_occurrences(standing_slot_id,class_date,starts_at,ends_at,capacity,location_id) values($1,'2030-01-07','2030-01-08T00:00:00Z','2030-01-08T01:00:00Z',10,$2) returning id",[slot,venue])).rows[0].id;}

test('deletion review and write require saved coach membership; raw deletes and audit access stay denied',async()=>fixture(async()=>{
 const r=await review();
 for(const [role,user] of [['anon',''],['authenticated',parent]]){
  await as(role,user);await denied(()=>review(),/permission denied|Coach access required/);await denied(()=>remove(r),/permission denied|Coach access required/);
 }
 await as('authenticated',coach);
 for(const table of ['athletes','families','group_enrollments'])await denied(()=>db.exec(`delete from public.${table}`),/permission denied/);
 await denied(()=>db.exec('select * from private.record_deletion_events'),/permission denied/);
 await denied(()=>db.query('select private.account_deletion_review($1,null)',[family]),/permission denied/);
}));

test('unused solo account deletion removes initial group setup atomically and retains a private server audit',async()=>fixture(async()=>{
 const r=await review();assert.equal(r.can_delete,true);assert.equal(r.confirmation_name,'Accidental account');assert.equal(r.athletes.length,1);
 const result=await remove(r);assert.deepEqual(result,{deleted_athletes:1,deleted_account:true});
 await denied(()=>remove(r),/Account no longer exists/);
 await as('postgres');assert.equal((await db.query('select * from public.athletes where id=$1',[athlete])).rows.length,0);assert.equal((await db.query('select * from public.group_enrollments where athlete_id=$1',[athlete])).rows.length,0);
 assert.deepEqual((await db.query('select id from public.families')).rows.map(r=>r.id),[other]);assert.equal((await db.query('select * from auth.users')).rows.length,2);
 const events=(await db.query('select * from private.record_deletion_events')).rows;assert.equal(events.length,1);assert.equal(events[0].actor_id,coach);assert.equal(events[0].record_type,'account');assert.equal(events[0].snapshot.athletes[0].id,athlete);assert.equal(events[0].snapshot.group_enrollments.length,1);assert.ok(Math.abs(Date.now()-new Date(events[0].deleted_at).getTime())<60000);
}));

test('athlete-only deletion keeps siblings, parent access, sibling charges and the family account',async()=>fixture(async()=>{
 await siblingRow();await as('postgres');
 await db.query('insert into public.family_guardians(family_id,user_id) values($1,$2)',[family,parent]);
 await db.query("insert into public.athlete_monthly_charges(athlete_id,family_id,service_month,currency,amount_minor_units,assigned_by) values($1,$2,'2030-01-01','USD',1000,$3)",[sibling,family,coach]);
 await as('authenticated',coach);assert.equal((await review()).can_delete,false);
 const r=await review(athlete);assert.equal(r.can_delete,true);await remove(r);
 await as('authenticated',parent);assert.deepEqual((await db.query('select id from public.athletes')).rows.map(r=>r.id),[sibling]);assert.equal((await db.query('select * from public.families')).rows.length,1);
 await as('postgres');assert.equal((await db.query('select * from public.family_guardians')).rows.length,1);assert.equal((await db.query('select * from public.athlete_monthly_charges')).rows.length,1);
}));

test('account deletion previews all unused siblings and removes exactly the reviewed IDs',async()=>fixture(async()=>{
 await siblingRow();const r=await review();assert.equal(r.athletes.length,2);assert.equal(r.group_enrollments.length,2);assert.equal(r.can_delete,true);
 assert.deepEqual(await remove(r),{deleted_athletes:2,deleted_account:true});
 await as('postgres');assert.equal((await db.query('select * from private.record_deletion_events')).rows[0].snapshot.athletes.length,2);
}));

test('an empty account can be removed after deleting its sole unused athlete',async()=>fixture(async()=>{
 await remove(await review(athlete));const r=await review();assert.equal(r.can_delete,true);assert.deepEqual(r.athletes,[]);assert.deepEqual(await remove(r),{deleted_athletes:0,deleted_account:true});
}));

const activityCases=[
 ['Monthly charges',async()=>db.query("insert into public.athlete_monthly_charges(athlete_id,family_id,service_month,currency,amount_minor_units,assigned_by) values($1,$2,'2030-01-01','USD',0,$3)",[athlete,family,coach])],
 ['Regular class assignments',async()=>db.query("insert into public.regular_class_assignments(standing_slot_id,athlete_id,starts_on,ends_on,created_by) values($1,$2,'2026-10-05','2026-10-06',$3)",[slot,athlete,coach])],
 ['Class bookings',async()=>{const o=await occurrence();await db.query("insert into public.class_seats(occurrence_id,athlete_id,seat_kind,confirmed_by,cancelled_by,cancelled_at) values($1,$2,'drop_in',$3,$3,now())",[o,athlete,coach]);}],
 ['Drop-in request history',async()=>{const o=await occurrence();await db.query("insert into public.drop_in_requests(athlete_id,occurrence_id,requested_by,status,reviewed_by,reviewed_at) values($1,$2,$3,'declined',$4,now())",[athlete,o,parent,coach]);}],
 ['Progress reports',async()=>db.query("insert into public.progress_reports(athlete_id,title,report_date,created_by) values($1,'Draft report',current_date,$2)",[athlete,coach])],
 ['Signed waivers',async()=>{await db.query('insert into public.family_guardians(family_id,user_id) values($1,$2)',[family,parent]);const v=(await db.query('select id from public.waiver_versions where is_current')).rows[0].id;await as('authenticated',parent);await db.query("select public.sign_athlete_waiver($1,$2,'2014-01-01','Test Parent','Contact','7015551234','Test Parent',true,true)",[athlete,v]);}],
];
for(const [reason,seed] of activityCases)test(`${reason} blocks athlete and whole-account deletion, including inactive history`,async()=>fixture(async()=>{
 await as('postgres');await seed();await as('authenticated',coach);
 for(const a of [athlete,null]){const r=await review(a);assert.equal(r.can_delete,false);assert.ok(r.blockers.some(b=>b.startsWith(reason)));await denied(()=>remove(r),/Deletion blocked/);}
 await as('postgres');assert.equal((await db.query('select * from public.athletes where id=$1',[athlete])).rows.length,1);assert.equal((await db.query('select * from public.group_enrollments where athlete_id=$1',[athlete])).rows.length,1);assert.equal((await db.query('select * from private.record_deletion_events')).rows.length,0);
}));

const accountCases=[
 ['Linked parent access',async()=>db.query('insert into public.family_guardians(family_id,user_id) values($1,$2)',[family,parent])],
 ['Parent invitations',async()=>db.query("insert into public.guardian_invitations(family_id,email,invited_by,created_at,expires_at,revoked_by,revoked_at) values($1,'parent@example.invalid',$2,now()-interval '3 days',now()-interval '2 days',$2,now())",[family,coach])],
 ['Parent access history',async()=>db.query("insert into public.guardian_access_events(family_id,user_id,actor_user_id,action) values($1,$2,$3,'revoked')",[family,parent,coach])],
 ['Billing contact history',async()=>db.query("insert into public.family_billing_contacts(family_id,email,approved_by,revoked_by,revoked_at) values($1,'parent@example.invalid',$2,$2,now())",[family,coach])],
 ['Payment receipts',async()=>db.query("insert into public.payment_receipts(family_id,currency,amount_minor_units,received_at,confirmed_by,request_id) values($1,'USD',100,now(),$2,gen_random_uuid())",[family,coach])],
];
for(const [reason,seed] of accountCases)test(`${reason} protects a parent account even when it has no athletes`,async()=>fixture(async()=>{
 await remove(await review(athlete));await as('postgres');await seed();await as('authenticated',coach);
 const r=await review();assert.equal(r.can_delete,false);assert.ok(r.blockers.some(b=>b.startsWith(reason)));await denied(()=>remove(r),/Deletion blocked/);
 assert.equal((await db.query('select * from public.families where id=$1',[family])).rows.length,1);
}));

test('typed names, matching account/athlete IDs, and a fresh review token are required server-side',async()=>fixture(async()=>{
 const r=await review(athlete);
 await denied(()=>remove(r,{confirmation_name:'accidental athlete'}),/Type the exact/);
 await denied(()=>remove(r,{confirmation_name:null}),/Type the exact/);
 await denied(()=>remove(r,{review_token:null}),/changed since review/);
 await denied(()=>remove(r,{family_id:other}),/Athlete or account changed/);
 await denied(()=>review(sibling),/Athlete or account changed/);
 await denied(()=>remove(r,{athlete_id:null}),/changed since review/);
 await db.query("update public.athletes set display_name='Renamed athlete' where id=$1",[athlete]);
 await denied(()=>remove(r),/changed since review/);assert.equal((await review(athlete)).confirmation_name,'Renamed athlete');
}));

test('new athletes, changed group setup and newly linked history invalidate prior reviews',async()=>fixture(async()=>{
 const account=await review();await siblingRow();await denied(()=>remove(account),/changed since review/);
 const first=await review(athlete);await as('postgres');await db.query('update public.group_enrollments set starts_on=current_date+1 where athlete_id=$1',[athlete]);await as('authenticated',coach);await denied(()=>remove(first),/changed since review/);
 const second=await review(athlete);await as('postgres');await activityCases[4][1]();await as('authenticated',coach);await denied(()=>remove(second),/changed since review/);
 assert.equal((await review(athlete)).can_delete,false);
}));

test('revoking a coach after review prevents deletion',async()=>fixture(async()=>{
 const r=await review();await as('postgres');await db.query('delete from public.coach_users where user_id=$1',[coach]);await as('authenticated',coach);await denied(()=>remove(r),/Coach access required/);
}));

test('unexpected future FK dependencies roll back group cleanup and the audit together',async()=>fixture(async()=>{
 await as('postgres');await db.exec('create table private.future_athlete_history(athlete_id uuid references public.athletes(id))');await db.query('insert into private.future_athlete_history values($1)',[athlete]);await as('authenticated',coach);
 const r=await review(athlete);assert.equal(r.can_delete,true);await denied(()=>remove(r),/Linked records prevent deletion/);
 await as('postgres');assert.equal((await db.query('select * from public.group_enrollments where athlete_id=$1',[athlete])).rows.length,1);assert.equal((await db.query('select * from public.athletes where id=$1',[athlete])).rows.length,1);assert.equal((await db.query('select * from private.record_deletion_events')).rows.length,0);
}));
