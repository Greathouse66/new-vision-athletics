import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from '../helpers/database.mjs';
let db,slot,venue,group;
const coach='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',parent='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',stranger='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const family='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const athlete='33333333-3333-4333-8333-333333333333',sibling='44444444-4444-4444-8444-444444444444';
before(async()=>{db=await testDatabase();slot=(await db.query('select id from public.standing_class_slots order by id limit 1')).rows[0].id;venue=(await db.query('select id from public.class_locations limit 1')).rows[0].id;group=(await db.query('select id from public.skill_groups limit 1')).rows[0].id;});
after(async()=>{await db?.close();});
async function as(role,user=''){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);select set_config('storage.operation','storage.object.get_authenticated',false);set role ${role}`);}
async function fixture(run){await as('postgres');await db.exec('begin');try{
 await db.exec(`insert into auth.users values('${coach}','coach@example.invalid',now()),('${parent}','parent@example.invalid',now()),('${stranger}','other@example.invalid',now());
 insert into public.coach_users(user_id) values('${coach}');
 insert into public.families(id,display_name) values('${family}','Returning family'),('${other}','Other family');
 insert into public.athletes(id,family_id,display_name) values('${athlete}','${family}','Returning Athlete'),('${sibling}','${family}','Active sibling');
 insert into public.family_guardians(family_id,user_id) values('${family}','${parent}'),('${other}','${stranger}');
 insert into public.group_enrollments(athlete_id,group_id,starts_on) values('${athlete}','${group}','2026-10-01');`);
 await as('authenticated',coach);await run();
 }finally{await db.exec('rollback;reset role');}}
async function denied(fn,pattern){await db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
async function change(archived=true,revision=1,name='Returning Athlete',id=athlete){return(await db.query('select public.set_athlete_archived($1,$2,$3,$4) as result',[id,revision,archived,name])).rows[0].result;}
async function occurrence(date='2030-01-07'){
 await as('postgres');const row=(await db.query("insert into public.class_occurrences(standing_slot_id,class_date,starts_at,ends_at,capacity,location_id) values($1,$2,$2::date+time '18:00',$2::date+time '19:00',10,$3) returning id",[slot,date,venue])).rows[0];await as('authenticated',coach);return row.id;
}
async function snapshot(){await as('postgres');const result={};for(const table of ['families','family_guardians','group_enrollments','regular_class_assignments','class_occurrences','class_seats','class_attendance','class_attendance_audit','athlete_monthly_charges','payment_receipts','payment_allocations','athlete_waiver_signatures','progress_reports','progress_report_files','drop_in_requests'])result[table]=(await db.query(`select to_jsonb(t) as r from public.${table} t order by to_jsonb(t)::text`)).rows;result.storage=(await db.query('select * from storage.objects order by name')).rows;await as('authenticated',coach);return result;}

test('only saved coaches change status; direct field writes and private audit access are denied',async()=>fixture(async()=>{
 for(const [role,user] of [['anon',''],['authenticated',parent],['authenticated',stranger]]){
  await as(role,user);await denied(()=>change(),/permission denied|Coach access required/);
 }
 await as('authenticated',coach);
 await denied(()=>db.exec('update public.athletes set archived_at=now()'),/permission denied/);
 await denied(()=>db.exec('update public.athletes set archive_revision=9'),/permission denied/);
 await denied(()=>db.exec('select * from private.athlete_archive_events'),/permission denied/);
 await db.query("update public.athletes set display_name='Name corrected' where id=$1",[sibling]);
 assert.equal((await db.query('select count(*)::int as n from public.record_name_corrections')).rows[0].n,1);
}));

test('fresh revisions and matching names prevent stale archive/reactivate writes and leave siblings unchanged',async()=>fixture(async()=>{
 await denied(()=>change(true,1,'Wrong name'),/Athlete changed/);
 await denied(()=>change(null),/Choose an athlete/);
 await denied(()=>change(true,null),/Choose an athlete/);
 await denied(()=>change(true,1,'Returning Athlete',other),/Athlete changed/);
 assert.deepEqual(await change(),{athlete_id:athlete,archived:true,revision:2});
 await denied(()=>change(),/Athlete changed/);
 await denied(()=>change(false,1),/Athlete changed/);
 await denied(()=>change(true,2),/already has this status/);
 assert.deepEqual(await change(false,2),{athlete_id:athlete,archived:false,revision:3});
 await denied(()=>change(true,1),/Athlete changed/);
 const s=(await db.query('select archived_at,archive_revision from public.athletes where id=$1',[sibling])).rows[0];assert.equal(s.archived_at,null);assert.equal(s.archive_revision,1);
 await as('postgres');const events=(await db.query('select * from private.athlete_archive_events order by id')).rows;
 assert.equal(events.length,2);assert.deepEqual(events.map(e=>e.action),['archived','reactivated']);assert.ok(events.every(e=>e.actor_id===coach&&e.family_id===family));assert.equal(events[0].before_athlete.archived_at,null);assert.ok(events[0].after_athlete.archived_at);
}));

test('revoking coach membership prevents archive and reactivation',async()=>fixture(async()=>{
 await change();await as('postgres');await db.query('delete from public.coach_users where user_id=$1',[coach]);await as('authenticated',coach);await denied(()=>change(false,2),/Coach access required/);
}));

test('archive and restore preserve payments, signed waiver, published private PDF, bookings and all related history exactly',async()=>fixture(async()=>{
 const occurrenceId=await occurrence();
 const seat=(await db.query('select public.confirm_coach_drop_in($1,$2) as id',[occurrenceId,athlete])).rows[0].id;
 await as('postgres');
 await db.query("insert into public.regular_class_assignments(standing_slot_id,athlete_id,starts_on,created_by) values($1,$2,'2030-01-01',$3)",[slot,athlete,coach]);
 const charge=(await db.query("insert into public.athlete_monthly_charges(athlete_id,family_id,service_month,currency,amount_minor_units,assigned_by) values($1,$2,'2030-01-01','USD',1000,$3) returning id",[athlete,family,coach])).rows[0].id;
 const receipt=(await db.query("insert into public.payment_receipts(family_id,currency,amount_minor_units,received_at,confirmed_by,request_id) values($1,'USD',500,now(),$2,gen_random_uuid()) returning id",[family,coach])).rows[0].id;
 await db.query("insert into public.payment_allocations(payment_id,charge_id,family_id,currency,amount_minor_units) values($1,$2,$3,'USD',500)",[receipt,charge,family]);
 const version=(await db.query('select id from public.waiver_versions where is_current')).rows[0].id;
 await as('authenticated',parent);await db.query("select public.sign_athlete_waiver($1,$2,'2014-01-01','Test Parent','Contact','7015551234','Test Parent',true,true)",[athlete,version]);
 await as('authenticated',coach);const report=(await db.query("select public.create_progress_report($1,'Progress report',current_date,'Good progress') as id",[athlete])).rows[0].id;
 const file=(await db.query("select public.prepare_progress_report_file($1,1,'progress.pdf',12) as f",[report])).rows[0].f;
 await as('postgres');await db.query("insert into storage.objects(bucket_id,name,metadata) values('athlete-progress-reports',$1,$2)",[file.object_path,{mimetype:'application/pdf',size:12}]);
 await as('authenticated',coach);await db.query('select public.attach_progress_report_file($1,1,$2)',[report,file.file_id]);
 const revision=(await db.query('select revision from public.progress_reports where id=$1',[report])).rows[0].revision;
 await db.query('select public.publish_progress_report($1,$2)',[report,revision]);
 const past=await occurrence('2020-01-06');const oldSeat=(await db.query('select public.confirm_coach_drop_in($1,$2) as id',[past,athlete])).rows[0].id;
 await db.query("select public.record_class_attendance($1,'present',null)",[oldSeat]);
 await db.query("select public.record_class_attendance($1,'absent','Corrected attendance')",[oldSeat]);
 const before=await snapshot();await change();assert.deepEqual(await snapshot(),before);
 await as('authenticated',parent);
 assert.equal((await db.query('select * from public.athlete_waiver_signatures')).rows.length,1);
 assert.equal((await db.query('select * from public.progress_reports')).rows.length,1);
 assert.deepEqual((await db.query('select name from storage.objects')).rows.map(r=>r.name),[file.object_path]);
 assert.equal((await db.query('select * from public.list_my_monthly_charges()')).rows.length,1);
 assert.ok((await db.query('select * from public.list_my_upcoming_sessions()')).rows.some(r=>r.occurrence_id===occurrenceId && r.athlete_id===athlete));
 assert.equal((await db.query('select * from public.athletes where id=$1',[athlete])).rows.length,1);
 await as('authenticated',stranger);for(const table of ['athletes','athlete_waiver_signatures','progress_reports','athlete_monthly_charges'])assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await as('authenticated',coach);await change(false,2);assert.deepEqual(await snapshot(),before);
}));

test('stale parent requests, new coach bookings, regular assignments and pending approval cannot book an archived athlete',async()=>fixture(async()=>{
 const o=await occurrence();await as('authenticated',parent);const request=(await db.query('select public.request_drop_in($1,$2) as id',[athlete,o])).rows[0].id;
 await as('authenticated',coach);await change();
 await denied(()=>db.query('select public.confirm_coach_drop_in($1,$2)',[o,athlete]),/athlete is archived/);
 await denied(()=>db.query("select public.add_regular_class_athlete($1,$2,'2030-01-01',null)",[slot,athlete]),/athlete is archived/);
 await denied(()=>db.query('select public.review_drop_in_request($1,true)',[request]),/athlete is archived/);
 await as('authenticated',parent);await denied(()=>db.query('select public.request_drop_in($1,$2)',[athlete,o]),/athlete is archived/);
 // The active sibling still requests normally; history is not hidden or deleted.
 await db.query('select public.request_drop_in($1,$2)',[sibling,o]);assert.equal((await db.query('select * from public.list_my_drop_in_requests()')).rows.length,2);
 await as('authenticated',coach);await db.query('select public.review_drop_in_request($1,false)',[request]);
}));

test('regular generation skips archived athletes, keeps old seats and reserved terms, and resumes only for new dates',async()=>fixture(async()=>{
 await db.query("select public.add_regular_class_athlete($1,$2,'2030-01-01',null)",[slot,athlete]);
 const first=await occurrence('2030-01-07');await change();const during=await occurrence('2030-01-14');
 assert.equal((await db.query('select * from public.class_seats where occurrence_id=$1',[first])).rows.length,1);
 assert.equal((await db.query('select * from public.class_seats where occurrence_id=$1',[during])).rows.length,0);
 assert.equal((await db.query('select * from public.regular_class_assignments where athlete_id=$1',[athlete])).rows.length,1);
 await change(false,2);assert.equal((await db.query('select * from public.class_seats where occurrence_id=$1',[during])).rows.length,0);
 const after=await occurrence('2030-01-21');assert.equal((await db.query('select * from public.class_seats where occurrence_id=$1',[after])).rows.length,1);
}));

test('weekly schedule versioning carries archived assignments without booking them',async()=>fixture(async()=>{
 await db.query("select public.add_regular_class_athlete($1,$2,'2030-01-01',null)",[slot,athlete]);await change();
 const s=(await db.query('select * from public.standing_class_slots where id=$1',[slot])).rows[0];
 const next=(await db.query('select public.save_weekly_class($1,$2,$3,$4,$5,$6,$7,$8,$9) as id',[slot,s.revision,'2030-02-01',s.iso_weekday,s.local_start_time,s.duration_minutes,s.capacity,s.class_kind,s.group_id])).rows[0].id;
 assert.equal((await db.query('select * from public.regular_class_assignments where standing_slot_id=$1 and athlete_id=$2',[next,athlete])).rows.length,1);
}));

test('archive does not cancel existing sessions; a coach can still cancel them explicitly',async()=>fixture(async()=>{
 const o=await occurrence();const seat=(await db.query('select public.confirm_coach_drop_in($1,$2) as id',[o,athlete])).rows[0].id;await change();
 await db.query('select public.cancel_coach_class_seat($1)',[seat]);assert.ok((await db.query('select cancelled_at from public.class_seats where id=$1',[seat])).rows[0].cancelled_at);
}));

test('reactivation never grants back revoked guardian access and invalidates old deletion reviews',async()=>fixture(async()=>{
 const review=(await db.query('select public.review_unused_account_deletion($1,$2) as r',[family,athlete])).rows[0].r;
 await change();await denied(()=>db.query('select public.delete_unused_account_record($1,$2,$3,$4)',[family,athlete,review.review_token,review.confirmation_name]),/changed since review/);
 await db.query('select public.revoke_guardian_access($1,$2)',[family,parent]);await change(false,2);
 await as('authenticated',parent);assert.equal((await db.query('select * from public.athletes')).rows.length,0);
}));
