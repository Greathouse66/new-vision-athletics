import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase} from '../helpers/database.mjs';
import {deliverClassChangeNotification} from '../../supabase/functions/drop-in-notification-worker/class-change-delivery.mjs';
let db;
const coach='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',parent='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',guardian='cccccccc-cccc-4ccc-8ccc-cccccccccccc',stranger='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const family='11111111-1111-4111-8111-111111111111',otherFamily='22222222-2222-4222-8222-222222222222';
const athlete='33333333-3333-4333-8333-333333333333',sibling='44444444-4444-4444-8444-444444444444',other='66666666-6666-4666-8666-666666666666';
const occurrence='55555555-5555-4555-8555-555555555555';
const portal='https://newvision-athletics.com/parent/sessions.html',sender='receipts@newvision-athletics.com';
before(async()=>{db=await testDatabase();});
after(async()=>{await db?.close();});
async function as(role,user=''){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`);}
async function fails(fn,pattern){await db.exec('savepoint expected_failure');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint expected_failure;release savepoint expected_failure');}}
async function fixture(run){
  await as('postgres');await db.exec('begin');
  try{
    await db.exec(`
      insert into auth.users values ('${coach}','coach@example.invalid',now()),('${parent}','parent@example.invalid',now()),('${guardian}','guardian@example.invalid',now()),('${stranger}','stranger@example.invalid',now());
      insert into public.coach_users(user_id) values ('${coach}');
      insert into public.families(id,display_name) values ('${family}','Family'),('${otherFamily}','Other family');
      insert into public.athletes(id,family_id,display_name) values ('${athlete}','${family}','Athlete A'),('${sibling}','${family}','Sibling B'),('${other}','${otherFamily}','Other athlete');
      insert into public.family_guardians(family_id,user_id) values ('${family}','${parent}'),('${family}','${guardian}'),('${otherFamily}','${stranger}');
      insert into public.class_occurrences(id,standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
        select '${occurrence}',s.id,current_date+14,
          ((current_date+14)+time '18:00') at time zone l.time_zone,
          ((current_date+14)+time '19:00') at time zone l.time_zone,10,l.id
        from public.standing_class_slots s cross join public.class_locations l where s.class_kind='intro' limit 1;
    `);
    await as('authenticated',coach);
    await db.query('select public.confirm_coach_drop_in($1,$2)',[occurrence,athlete]);
    await run();
  }finally{await as('postgres');await db.exec('rollback');}
}
async function review(){await as('authenticated',coach);return (await db.query('select public.review_coach_class_change($1) as r',[occurrence])).rows[0].r;}
async function save(action='rescheduled',token=null,extra={}){
  const r=await review();await as('authenticated',coach);
  const next=(await db.query("select ((starts_at at time zone $2)+interval '1 day')::text as local from public.class_occurrences where id=$1",[occurrence,r.time_zone])).rows[0].local;
  const args={p_occurrence_id:occurrence,p_review_token:token??r.review_token,p_action:action,p_reason:'Gym unavailable',p_location_id:action==='closed'?null:r.occurrence.location_id,p_local_start:action==='closed'?null:next,p_duration_minutes:action==='closed'?null:60,...extra};
  return (await db.query('select public.save_coach_class_change($1,$2,$3,$4,$5,$6,$7) as r',Object.values(args))).rows[0].r;
}
async function rows(table){await as('postgres');return (await db.query('select * from '+table)).rows;}
async function claim(){await as('service_role');return (await db.query('select public.claim_class_change_notification($1,$2) as r',[portal,sender])).rows[0].r;}
async function current(job){return (await db.query('select public.class_change_notification_current($1,$2,$3) as r',[job.payload.changeId,job.payload.parentId,job.leaseToken])).rows[0].r;}
async function settle(job,sent=false,code='temporary'){return db.query('select public.settle_class_change_notification($1,$2,$3,$4,$5,$6)',[job.payload.changeId,job.payload.parentId,job.leaseToken,sent,sent?'provider-id':null,sent?null:code]);}

test('reschedule retains occurrence, original roster date, seat IDs and weekly rules; Today follows actual date',async()=>fixture(async()=>{
  const r=await review(),seats=await rows('public.class_seats'),slots=await rows('public.standing_class_slots');
  const result=await save();assert.equal(result.queued_emails,2);
  const after=(await rows('public.class_occurrences'))[0];assert.equal(after.class_date,r.occurrence.class_date);assert.equal(after.id,occurrence);
  assert.notEqual(after.starts_at,r.occurrence.starts_at);assert.equal(after.schedule_revision,2);
  assert.deepEqual(await rows('public.class_seats'),seats);assert.deepEqual(await rows('public.standing_class_slots'),slots);
  await as('authenticated',parent);assert.equal((await db.query('select * from public.list_my_cancellable_sessions()')).rows.length,1);
  await as('authenticated',coach);
  const day=(await db.query('select (starts_at at time zone $2)::date as day from public.class_occurrences where id=$1',[occurrence,r.time_zone])).rows[0].day;
  assert.equal((await db.query('select * from public.list_coach_class_day($1)',[day])).rows.length,1);
}));
test('closure releases confirmed seats, declines pending requests and hides the class from drop-ins',async()=>fixture(async()=>{
  await as('authenticated',parent);await db.query('select public.request_drop_in($1,$2)',[sibling,occurrence]);
  const r=await save('closed');assert.equal(r.queued_emails,2);
  assert.equal((await rows('public.class_seats')).filter(r=>!r.cancelled_at).length,0);
  assert.equal((await rows('public.drop_in_requests'))[0].status,'declined');
  assert.equal((await rows('public.parent_class_cancellations')).length,0);
  await as('authenticated',parent);
  assert.equal((await db.query('select * from public.list_my_cancellable_sessions()')).rows.length,0);
  assert.equal((await db.query('select * from public.list_open_drop_in_classes()')).rows.length,0);
  const updates=(await db.query('select * from public.list_my_class_changes()')).rows;
  assert.equal(updates.length,2);assert.ok(updates.every(r=>r.action==='closed'));
  await fails(()=>db.query('select public.request_drop_in($1,$2)',[sibling,occurrence]),/unavailable/);
  await as('authenticated',coach);
  await fails(()=>db.query('select public.confirm_coach_drop_in($1,$2)',[occurrence,sibling]),/closed/);
}));
test('closed classes stay closed when a new regular assignment covers their original date',async()=>fixture(async()=>{
  await save('closed');const r=await review();await as('authenticated',coach);
  await db.query('select public.add_regular_class_athlete($1,$2,$3,null)',[r.occurrence.standing_slot_id,sibling,r.occurrence.class_date]);
  assert.equal((await rows('public.regular_class_assignments')).length,1);
  assert.equal((await rows('public.class_seats')).filter(r=>!r.cancelled_at).length,0);
}));
test('changed rosters, parent contacts and repeat submissions invalidate the reviewed token',async()=>{
  for(const mutation of [
    async()=>{await as('authenticated',coach);await db.query('select public.confirm_coach_drop_in($1,$2)',[occurrence,sibling]);},
    async()=>{await as('postgres');await db.query('update auth.users set email=$1 where id=$2',['changed@example.invalid',parent]);},
    async()=>{await as('postgres');await db.query('delete from public.family_guardians where user_id=$1',[guardian]);},
  ])await fixture(async()=>{const r=await review();await mutation();await fails(()=>save('closed',r.review_token),/changed/);assert.equal((await rows('private.class_change_events')).length,0);});
  await fixture(async()=>{const r=await review();await save('closed',r.review_token);await fails(()=>save('closed',r.review_token),/changed/);assert.equal((await rows('private.class_change_events')).length,1);});
});
test('browsers cannot forge changes, read private queues or claim parent emails',async()=>fixture(async()=>{
  const r=await review();await save();
  for(const [role,user] of [['anon',''],['authenticated',parent],['authenticated',stranger]]){
    await as(role,user);
    await fails(()=>db.query('select public.review_coach_class_change($1)',[occurrence]),/permission denied|Coach access/);
    await fails(()=>db.query("select public.save_coach_class_change($1,$2,'closed','Reason',null,null,null)",[occurrence,r.review_token]),/permission denied|Coach access/);
    await fails(()=>db.query('select * from private.class_change_events'),/permission denied/);
    await fails(()=>db.query('select public.claim_class_change_notification($1,$2)',[portal,sender]),/permission denied/);
  }
  await as('authenticated',stranger);assert.equal((await db.query('select * from public.list_my_class_changes()')).rows.length,0);
}));
test('one message per verified parent covers siblings without exposing another family',async()=>fixture(async()=>{
  await as('authenticated',coach);await db.query('select public.confirm_coach_drop_in($1,$2)',[occurrence,sibling]);await db.query('select public.confirm_coach_drop_in($1,$2)',[occurrence,other]);
  const result=await save();assert.equal(result.queued_emails,3);
  const job=await claim();assert.equal(job.payload.athletes.length,2);
  assert.ok(!JSON.stringify(job.payload).includes('Other athlete'));
  await as('authenticated',stranger);const updates=(await db.query('select * from public.list_my_class_changes()')).rows;assert.equal(updates.length,1);assert.equal(updates[0].athlete_name,'Other athlete');
}));
test('unverified contacts and missing guardians are highlighted and never receive queued emails',async()=>fixture(async()=>{
  await as('postgres');await db.query('update auth.users set email_confirmed_at=null where id=$1',[parent]);await db.query('delete from public.family_guardians where user_id=$1',[guardian]);
  const r=await review();assert.equal(r.email_count,0);assert.equal(r.missing_contact_count,1);assert.equal(r.athletes[0].has_email,false);assert.ok(!JSON.stringify(r).includes('parent@example.invalid'));
  const result=await save('closed');assert.equal(result.queued_emails,0);assert.equal(result.missing_contact_count,1);
}));
test('overlapping, unchanged, past and ambiguous local times leave no partial update',async()=>{
  for(const mode of ['overlap','same','past','dst'])await fixture(async()=>{
    const r=await review();let local=r.occurrence.class_date+'T18:00:00';
    if(mode==='overlap'){
      await as('postgres');await db.exec(`insert into public.class_occurrences(standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
        select standing_slot_id,class_date+2,starts_at+interval '2 days',ends_at+interval '2 days',10,location_id from public.class_occurrences where id='${occurrence}'`);
      local=(await db.query("select ((starts_at at time zone $2)+interval '2 days')::text as t from public.class_occurrences where id=$1",[occurrence,r.time_zone])).rows[0].t;
    }else if(mode==='past')local='2020-01-01T18:00:00';
    else if(mode==='dst')local='2030-03-10T02:30:00';
    await fails(()=>save('rescheduled',r.review_token,{p_local_start:local}),/overlap|Change the time|future|daylight saving/);
    assert.equal((await rows('private.class_change_events')).length,0);assert.equal((await rows('private.class_change_notification_outbox')).length,0);
  });
});
test('already-started and closed classes reject schedule changes',async()=>{
  await fixture(async()=>{await as('postgres');await db.exec("update public.class_occurrences set starts_at=now()-interval '1 hour',ends_at=now()+interval '1 hour'");await fails(()=>save('closed'),/not started/);});
  await fixture(async()=>{await save('closed');await fails(()=>save(),/not started/);});
});
test('parent revocation, changed email and superseded events stop pending or leased emails',async()=>{
  for(const mode of ['revoked','email','superseded'])await fixture(async()=>{
    await save();const job=await claim();assert.equal(await current(job),true);await as('postgres');
    if(mode==='revoked')await db.query('delete from public.family_guardians where user_id=$1',[job.payload.parentId]);
    if(mode==='email')await db.query('update auth.users set email=$1 where id=$2',['changed@example.invalid',job.payload.parentId]);
    if(mode==='superseded')await save('closed');
    await as('service_role');assert.equal(await current(job),false);await settle(job,false,'no_longer_current');
    assert.equal((await rows('private.class_change_notification_outbox')).find(r=>r.parent_id===job.payload.parentId&&r.change_id===job.payload.changeId).status,'skipped');
  });
});
test('retries freeze payloads, rotate leases and reject old lease settlement',async()=>fixture(async()=>{
  await save();const first=await claim();await settle(first);
  await as('postgres');await db.exec("update private.class_change_notification_outbox set next_attempt_at=now()-interval '1 minute'");await db.query('update public.athletes set display_name=$1 where id=$2',['Renamed',athlete]);
  const retry=await claim();assert.deepEqual(retry.payload,first.payload);assert.notEqual(retry.leaseToken,first.leaseToken);
  await fails(()=>settle(first,true),/lease unavailable/);await settle(retry,true);
  const q=await rows('private.class_change_notification_outbox');assert.equal(q.find(r=>r.parent_id===first.payload.parentId).status,'sent');
}));
test('queue insertion failure rolls back the class, seat cancellation and audit',async()=>fixture(async()=>{
  await as('postgres');await db.exec("alter table private.class_change_notification_outbox add constraint fail_test check(recipient_email='blocked')");
  await fails(()=>save('closed'),/fail_test/);
  assert.equal((await rows('private.class_change_events')).length,0);assert.equal((await rows('public.class_occurrences'))[0].closed_at,null);
  assert.equal((await rows('public.class_seats'))[0].cancelled_at,null);
}));
test('real SQL and worker deliver each class update once to the checked parents',async()=>fixture(async()=>{
  await save('closed');await as('service_role');const sends=[];
  const admin={async rpc(name,args){try{return {data:(await db.query('select public.'+name+'('+Object.keys(args).map((k,i)=>k+' => $'+(i+1)).join(',')+') as r',Object.values(args))).rows[0].r,error:null};}catch(error){return {data:null,error};}}};
  const send=async(url,options)=>{sends.push(JSON.parse(options.body));return Response.json({id:'integration-'+sends.length});};
  const config={apiKey:'test-only',from:sender,portalUrl:portal};
  for(let i=0;i<2;i++)assert.equal((await (await deliverClassChangeNotification(admin,config,send)).json()).status,'sent');
  assert.equal((await (await deliverClassChangeNotification(admin,config,send)).json()).status,'idle');assert.equal(sends.length,2);
  assert.ok(sends.every(m=>m.text.includes('will not take place')));assert.ok(sends.every(m=>!m.text.includes('Other athlete')));
}));

test('partial multi-account revocation invalidates a frozen message containing athletes from the revoked account',async()=>fixture(async()=>{
  await as('postgres');await db.query('insert into public.family_guardians(family_id,user_id) values($1,$2)',[otherFamily,parent]);
  await as('authenticated',coach);await db.query('select public.confirm_coach_drop_in($1,$2)',[occurrence,other]);
  await save();const job=await claim();assert.equal(job.payload.parentId,parent);assert.equal(job.payload.athletes.length,2);
  await as('postgres');await db.query('delete from public.family_guardians where family_id=$1 and user_id=$2',[otherFamily,parent]);
  await as('service_role');assert.equal(await current(job),false);
}));
