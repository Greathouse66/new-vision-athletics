import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../helpers/database.mjs';
let db,base,effective,slot,venue,post,advanced,foundational;
const coach='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',parent='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const family='11111111-1111-4111-8111-111111111111',a='33333333-3333-4333-8333-333333333333',b='44444444-4444-4444-8444-444444444444';
function shift(value,days){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
before(async()=>{
 db=await testDatabase();
 base=(await db.query("select to_char(current_date+((8-extract(isodow from current_date)::integer)%7)+14,'YYYY-MM-DD') as d")).rows[0].d;effective=shift(base,7);
 for(const [name,key] of [['Post-Bigs','post'],['Advanced','advanced'],['Foundational','foundational']]){
  const id=(await db.query('select id from public.skill_groups where name=$1',[name])).rows[0].id;
  if(key==='post')post=id;if(key==='advanced')advanced=id;if(key==='foundational')foundational=id;
 }
 slot=(await db.query("select id from public.standing_class_slots where group_id=$1 and iso_weekday=1 and local_start_time='18:00'",[post])).rows[0].id;
 venue=(await db.query('select id from public.class_locations limit 1')).rows[0].id;
});
after(async()=>{await db?.close();});
async function as(role,user=''){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`);}
async function denied(fn,pattern){await db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
async function fixture(run){
 await db.exec('begin');try{
  await db.exec(`insert into auth.users values ('${coach}','coach@example.invalid',now()),('${parent}','parent@example.invalid',now());
   insert into public.coach_users(user_id) values ('${coach}');
   insert into public.families(id,display_name) values ('${family}','Schedule test');
   insert into public.athletes(id,family_id,display_name) values ('${a}','${family}','First athlete'),('${b}','${family}','Future athlete');
   insert into public.family_guardians(family_id,user_id) values ('${family}','${parent}');
   insert into public.group_enrollments(athlete_id,group_id,starts_on) values ('${a}','${post}','${base}');`);
  await as('authenticated',coach);await run();
 }finally{await db.exec('reset role;rollback');}
}
async function snapshot(){return (await db.query('select public.coach_weekly_schedule() as s')).rows[0].s;}
async function save(overrides={}){
 const input={slot_id:slot,revision:1,effective_from:effective,iso_weekday:1,local_start_time:'17:00',duration_minutes:60,capacity:10,class_kind:'skill_group',group_id:post,...overrides};
 return (await db.query(`select public.save_weekly_class(${Object.keys(input).map((k,i)=>`p_${k}=>$${i+1}`).join(',')}) as id`,Object.values(input))).rows[0].id;
}
async function regular(athlete=a,start=base,end=null,source=slot){return (await db.query('select public.add_regular_class_athlete($1,$2,$3,$4) as id',[source,athlete,start,end])).rows[0].id;}
async function generate(monday,dates=[monday],revision=null){
 await db.query('select public.set_class_week_venue($1,$2)',[monday,venue]);
 if(revision===null)return (await db.query('select public.create_dated_classes($1,$2) as n',[monday,dates])).rows[0].n;
 return (await db.query('select public.create_reviewed_dated_classes($1,$2,$3) as n',[monday,dates,revision])).rows[0].n;
}

test('only coaches can read/edit schedules or generate reviewed dates; browser direct writes stay denied',async()=>fixture(async()=>{
 for(const [role,user] of [['anon',''],['authenticated',parent]]){
  await as(role,user);await denied(()=>snapshot(),/permission denied|Coach access required/);await denied(()=>save(),/permission denied|Coach access required/);
  await denied(()=>db.query('select public.create_reviewed_dated_classes($1,$2,1)',[base,[base]]),/permission denied|Coach access required/);
 }
 await as('authenticated',coach);
 await denied(()=>db.exec("update public.standing_class_slots set local_start_time='12:00'"),/permission denied/);
 await denied(()=>db.exec('select * from private.weekly_schedule_changes'),/permission denied/);
 await denied(()=>db.query('select private.add_regular_class_term($1,$2,$3,null)',[slot,a,base]),/permission denied/);
 assert.equal((await snapshot()).classes.length,8);
}));

test('effective-date revision preserves saved classes, seats, labels, venue, requests and athlete skill groups',async()=>fixture(async()=>{
 await regular();await generate(base);
 const oldClasses=(await db.query('select * from public.class_occurrences order by id')).rows;
 const oldSeats=(await db.query('select * from public.class_seats order by id')).rows;
 const groups=(await db.query('select * from public.group_enrollments order by id')).rows;
 await as('authenticated',parent);
 const beforeSessions=(await db.query('select * from public.list_my_upcoming_sessions()')).rows;
 assert.equal(beforeSessions[0].class_label,'Post-Bigs');
 const occurrence=oldClasses.find(o=>o.standing_slot_id===slot).id;
 await db.query('select public.request_drop_in($1,$2)',[b,occurrence]);
 await as('authenticated',coach);
 const requests=(await db.query('select * from public.list_coach_drop_in_requests()')).rows;
 const next=await save({group_id:foundational,duration_minutes:45,capacity:8});
 const rows=(await snapshot()).classes;const old=rows.find(r=>r.id===slot),updated=rows.find(r=>r.id===next);
 assert.equal(old.class_label,'Post-Bigs');assert.equal(old.local_start_time,'18:00:00');assert.equal(old.active_until,effective);
 assert.equal(updated.active_from,effective);assert.equal(updated.replaces_slot_id,slot);assert.equal(updated.class_label,'Foundational');
 assert.equal(updated.capacity,8);assert.equal(updated.duration_minutes,45);
 assert.deepEqual((await db.query('select * from public.class_occurrences order by id')).rows,oldClasses);
 assert.deepEqual((await db.query('select * from public.class_seats order by id')).rows,oldSeats);
 assert.deepEqual((await db.query('select * from public.group_enrollments order by id')).rows,groups);
 assert.deepEqual((await db.query('select * from public.list_coach_drop_in_requests()')).rows,requests);
 await as('authenticated',parent);assert.deepEqual((await db.query('select * from public.list_my_upcoming_sessions()')).rows,beforeSessions);
}));

test('active terms split and future-starting regular terms carry over without changing their dates',async()=>fixture(async()=>{
 const activeId=await regular();const start=shift(effective,7),end=shift(effective,28);const futureId=await regular(b,start,end);
 await generate(base);const next=await save();
 const terms=(await db.query('select * from public.regular_class_assignments order by starts_on,id')).rows;
 assert.equal(terms.find(t=>t.id===activeId).ends_on.toISOString().slice(0,10),effective);
 const carried=terms.find(t=>t.athlete_id===a&&t.standing_slot_id===next);assert.ok(carried);assert.equal(carried.starts_on.toISOString().slice(0,10),effective);assert.equal(carried.ends_on,null);
 const future=terms.find(t=>t.id===futureId);assert.equal(future.standing_slot_id,next);assert.equal(future.starts_on.toISOString().slice(0,10),start);assert.equal(future.ends_on.toISOString().slice(0,10),end);
 await generate(effective);
 assert.equal((await db.query('select * from public.class_seats s join public.class_occurrences o on o.id=s.occurrence_id where o.standing_slot_id=$1',[next])).rows.length,1);
}));

test('ongoing athletes added after a planned change follow the version chain and reserve future seats',async()=>fixture(async()=>{
 const next=await save();await generate(base);await generate(effective);
 await regular(a,base,null,slot);
 const terms=(await db.query('select * from public.regular_class_assignments where athlete_id=$1',[a])).rows;
 assert.equal(terms.length,2);assert.ok(terms.some(t=>t.standing_slot_id===slot));assert.ok(terms.some(t=>t.standing_slot_id===next));
 assert.equal((await db.query('select * from public.class_seats where athlete_id=$1 and cancelled_at is null',[a])).rows.length,2);
}));

test('capacity failure in a later version rolls back an entire new regular assignment and its seats',async()=>fixture(async()=>{
 const next=await save({capacity:1});await regular(b,effective,null,next);await generate(base);await generate(effective);
 const seats=(await db.query('select * from public.class_seats order by id')).rows;
 await denied(()=>regular(a),/No regular places/);
 assert.equal((await db.query('select * from public.regular_class_assignments where athlete_id=$1',[a])).rows.length,0);
 assert.deepEqual((await db.query('select * from public.class_seats order by id')).rows,seats);
}));

test('created classes on source or target weekdays prevent retroactive template changes',async()=>fixture(async()=>{
 await generate(base,[base,shift(base,1)]);
 await denied(()=>save({effective_from:base}),/Created classes are preserved/);
 await denied(()=>save({effective_from:shift(base,1),iso_weekday:2}),/already created on that weekday/);
 await denied(()=>save({slot_id:null,revision:null,effective_from:shift(base,1),iso_weekday:2,local_start_time:'16:00'}),/already created on that weekday/);
 assert.equal((await snapshot()).classes.length,8);
 assert.equal((await snapshot()).last_created_by_day['2'],shift(base,1));
}));

test('lower capacity cannot displace existing regular athletes; schedule remains unchanged on failure',async()=>fixture(async()=>{
 await regular(a);await regular(b);
 const before=await snapshot();await denied(()=>save({capacity:1}),/Capacity cannot be below/);assert.deepEqual(await snapshot(),before);
}));

test('an unused planned revision can be corrected at its start date and stale writes fail',async()=>fixture(async()=>{
 const next=await save();const same=await save({slot_id:next,revision:1,local_start_time:'16:30'});assert.equal(same,next);
 const planned=(await snapshot()).classes.find(c=>c.id===next);assert.equal(planned.revision,2);assert.equal(planned.local_start_time,'16:30:00');
 await denied(()=>save({slot_id:next,revision:1}),/changed/);await denied(()=>save(),/changed/);
 await as('postgres');assert.equal((await db.query('select * from private.weekly_schedule_changes')).rows.length,2);
}));

test('new weekly classes and generation support Saturday/Sunday with saved Minot times and capacity',async()=>fixture(async()=>{
 const saturday=await save({slot_id:null,revision:null,iso_weekday:6,group_id:advanced,local_start_time:'10:30',duration_minutes:90,capacity:6});
 const sunday=await save({slot_id:null,revision:null,iso_weekday:7,group_id:null,class_kind:'intro',local_start_time:'11:00'});
 const rev=(await snapshot()).revision;assert.equal(await generate(effective,[shift(effective,5),shift(effective,6)],rev),2);
 const rows=(await db.query("select standing_slot_id,capacity,to_char(starts_at at time zone 'America/Chicago','HH24:MI') as local_time,extract(epoch from ends_at-starts_at)/60 as minutes from public.class_occurrences order by class_date")).rows;
 assert.equal(rows[0].standing_slot_id,saturday);assert.equal(rows[0].capacity,6);assert.equal(rows[0].local_time,'10:30');assert.equal(Number(rows[0].minutes),90);assert.equal(rows[1].standing_slot_id,sunday);
}));

test('stale reviewed generation and a mixed date selection with no class fail without partial rows',async()=>fixture(async()=>{
 const rev=(await snapshot()).revision;
 await save({slot_id:null,revision:null,iso_weekday:6,group_id:advanced,local_start_time:'10:00'});
 await db.query('select public.set_class_week_venue($1,$2)',[effective,venue]);
 await denied(()=>db.query('select public.create_reviewed_dated_classes($1,$2,$3)',[effective,[shift(effective,5)],rev]),/schedule changed/);
 await denied(()=>db.query('select public.create_dated_classes($1,$2)',[effective,[shift(effective,5),shift(effective,6)]]),/No standing classes/);
 assert.equal((await db.query('select * from public.class_occurrences')).rows.length,0);
}));

test('invalid inputs, inactive groups and duplicate weekly rules cannot alter the schedule',async()=>fixture(async()=>{
 for(const change of [{effective_from:'2020-01-01'},{iso_weekday:0},{iso_weekday:8},{capacity:0},{capacity:11},{duration_minutes:0},{duration_minutes:361},
  {local_start_time:'23:30',duration_minutes:90},{local_start_time:'17:00:30'},{class_kind:'intro',group_id:post},{class_kind:'skill_group',group_id:null}])await denied(()=>save(change),/Choose a current\/future/);
 await denied(()=>save({slot_id:null,revision:null,iso_weekday:2,local_start_time:'18:00',group_id:foundational}),/already has a weekly rule/);
 await as('postgres');await db.query('update public.skill_groups set is_active=false where id=$1',[post]);await as('authenticated',coach);
 await denied(()=>save(),/active skill group/);assert.equal((await snapshot()).classes.length,8);
}));

test('multiple planned versions split bounded assignments at each boundary and skip expired versions',async()=>fixture(async()=>{
 const second=await save(),thirdDate=shift(effective,14);
 const third=await save({slot_id:second,revision:1,effective_from:thirdDate,local_start_time:'16:00'});
 const end=shift(thirdDate,14);await regular(a,base,end,slot);await regular(b,shift(thirdDate,1),end,slot);
 const terms=(await db.query("select athlete_id,standing_slot_id,to_char(starts_on,'YYYY-MM-DD') as starts,to_char(ends_on,'YYYY-MM-DD') as ends from public.regular_class_assignments order by starts_on")).rows;
 assert.deepEqual(terms.filter(t=>t.athlete_id===a).map(t=>[t.standing_slot_id,t.starts,t.ends]),[[slot,base,effective],[second,effective,thirdDate],[third,thirdDate,end]]);
 assert.equal(terms.find(t=>t.athlete_id===b).standing_slot_id,third);
}));

test('weekend generation rejects missing and repeated Minot daylight-saving times atomically',async()=>fixture(async()=>{
 const year=Number(base.slice(0,4))+2;
 for(const [month,time] of [[3,'02:30'],[11,'01:30']]){
  const first=new Date(Date.UTC(year,month-1,1,12));
  const sunday=new Date(first);sunday.setUTCDate(1+(7-first.getUTCDay())%7+(month===3?7:0));
  const date=sunday.toISOString().slice(0,10),monday=shift(date,-6);
  await save({slot_id:null,revision:null,effective_from:monday,iso_weekday:7,class_kind:'intro',group_id:null,local_start_time:time,duration_minutes:15});
  await db.query('select public.set_class_week_venue($1,$2)',[monday,venue]);
  await denied(()=>db.query('select public.create_dated_classes($1,$2)',[monday,[monday,date]]),/Ambiguous or missing local/);
  assert.equal((await db.query('select * from public.class_occurrences')).rows.length,0);
 }
}));
