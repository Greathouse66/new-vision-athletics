import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../helpers/database.mjs';
import { deliverReportNotification } from '../../supabase/functions/drop-in-notification-worker/report-delivery.mjs';
let db;
const coach='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', parent='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const second='cccccccc-cccc-4ccc-8ccc-cccccccccccc', stranger='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const family='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const athlete='33333333-3333-4333-8333-333333333333', sibling='44444444-4444-4444-8444-444444444444';
const portal='https://newvision-athletics.com/parent/reports.html', sender='receipts@example.invalid';
before(async()=>{db=await testDatabase()}); after(async()=>{await db?.close()});
async function as(role,user=''){await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); select set_config('storage.operation','storage.object.get_authenticated',false); select set_config('request.method','',false); select set_config('request.path','',false); set role ${role}`)}
async function denied(fn,pattern=/permission denied|Coach access required|row-level security/){
 await db.exec('savepoint denied');try{await assert.rejects(fn,pattern)}finally{await db.exec('rollback to savepoint denied; release savepoint denied')}
}
async function fixture(run){await as('postgres');await db.exec('begin');try{
 await db.exec(`insert into auth.users values ('${coach}','coach@example.invalid',now()),('${parent}','parent@example.invalid',now()),('${second}','second@example.invalid',now()),('${stranger}','stranger@example.invalid',now());
 insert into public.coach_users(user_id) values('${coach}');
 insert into public.families(id,display_name) values('${family}','Linked'),('${other}','Other');
 insert into public.athletes(id,family_id,display_name) values('${athlete}','${family}','Athlete'),('${sibling}','${family}','Sibling');
 insert into public.family_guardians(family_id,user_id) values('${family}','${parent}'),('${family}','${second}'),('${other}','${stranger}');`);
 await run();
 }finally{await db.exec('rollback; reset role')}}
async function create(who=athlete){await as('authenticated',coach);return(await db.query("select public.create_progress_report($1,'October report',current_date,'Well done') as id",[who])).rows[0].id}
async function row(id){return(await db.query('select * from public.progress_reports where id=$1',[id])).rows[0]}
async function upload(id, {complete=true,mime='application/pdf',size=12}={}){
 await as('authenticated',coach);const r=await row(id);
 const file=(await db.query("select public.prepare_progress_report_file($1,$2,'progress.pdf',12) as f",[id,r.revision])).rows[0].f;
 // Storage normally writes metadata as its server role after uploading bytes.
 if(complete){await as('postgres');await db.query("insert into storage.objects(bucket_id,name,metadata) values('athlete-progress-reports',$1,$2)",[file.object_path,{mimetype:mime,size}])}
 await as('authenticated',coach);return file;
}
async function attach(id,f){return db.query('select public.attach_progress_report_file($1,$2,$3)',[id,(await row(id)).revision,f.file_id])}
async function publish(id){await as('authenticated',coach);await db.query('select public.publish_progress_report($1,$2)',[id,(await row(id)).revision])}
async function unpublish(id){await as('authenticated',coach);await db.query('select public.unpublish_progress_report($1,$2)',[id,(await row(id)).revision])}
async function ready(who=athlete){const id=await create(who);const file=await upload(id);await attach(id,file);return {id,file}}
async function queue(){await as('postgres');return(await db.query('select * from private.progress_report_notification_outbox order by parent_id,publication')).rows}
async function claim(){await as('service_role');return(await db.query('select public.claim_progress_report_notification($1,$2) as job',[portal,sender])).rows[0].job}
async function current(j){return(await db.query('select public.progress_report_notification_current($1,$2,$3,$4) as ok',[j.payload.reportId,j.payload.publication,j.payload.parentId,j.leaseToken])).rows[0].ok}
async function settle(j,sent=false,failure='temporary'){return db.query('select public.settle_progress_report_notification($1,$2,$3,$4,$5,$6,$7)',[j.payload.reportId,j.payload.publication,j.payload.parentId,j.leaseToken,sent,sent?'provider-id':null,sent?null:failure])}

test('drafts and PDFs stay private; publishing isolates families and siblings; unpublishing removes access',async()=>fixture(async()=>{
 const {id,file}=await ready(); const s=await ready(sibling);
 await as('authenticated',parent);assert.equal((await db.query('select * from public.progress_reports')).rows.length,0);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await publish(id);
 await as('authenticated',parent);assert.deepEqual((await db.query('select id from public.progress_reports')).rows.map(r=>r.id),[id]);
 assert.deepEqual((await db.query('select name from storage.objects')).rows.map(r=>r.name),[file.object_path]);
 assert.equal((await db.query('select * from public.progress_report_files')).rows.length,1);
 await as('authenticated',stranger);assert.equal((await db.query('select * from public.progress_reports')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await unpublish(id);await as('authenticated',parent);assert.equal((await db.query('select * from public.progress_reports')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 assert.notEqual(s.id,id);
}));

test('parents and anonymous users cannot create, attach, publish, forge metadata, upload or send reports',async()=>fixture(async()=>{
 const {id,file}=await ready();
 for(const [role,user] of [['anon',''],['authenticated',parent],['authenticated',stranger]]){
  await as(role,user);
  await denied(async()=>db.query('select public.create_progress_report($1,$2,current_date,$3)',[athlete,'Fake','']));
  await denied(async()=>db.query('select public.publish_progress_report($1,1)',[id]));
  await denied(async()=>db.query('select public.attach_progress_report_file($1,1,$2)',[id,file.file_id]));
  await denied(async()=>db.query("insert into storage.objects(bucket_id,name) values('athlete-progress-reports','forged.pdf')"));
  await denied(async()=>db.query("update public.progress_reports set status='published'"));
  await denied(async()=>db.query('select * from private.progress_report_notification_outbox'));
  await denied(async()=>db.query('select public.claim_progress_report_notification($1,$2)',[portal,sender]));
 }
}));

test('only reserved coach uploads work; broad unrelated Storage policies cannot expose or overwrite reports',async()=>fixture(async()=>{
 const id=await create();const file=await upload(id,{complete:false});
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('athlete-progress-reports',$1,$2)",[file.object_path,{mimetype:'application/pdf',size:12}]);await attach(id,file);await publish(id);
 await as('postgres');await db.exec(`create policy test_broad_storage_read on storage.objects for select to public using(true);
 create policy test_broad_storage_write on storage.objects for all to public using(true) with check(true);`);
 await as('anon');assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await as('authenticated',stranger);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await denied(async()=>db.query("insert into storage.objects(bucket_id,name) values('athlete-progress-reports','evil.pdf')"));
 await as('authenticated',coach);assert.equal((await db.query("update storage.objects set metadata='{}' returning id")).rows.length,0);
 assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0);
 await as('postgres');await db.exec("insert into storage.buckets(id,name,public) values('unrelated','unrelated',true); insert into storage.objects(bucket_id,name) values('unrelated','public.txt');");
 await as('anon');assert.deepEqual((await db.query('select name from storage.objects')).rows.map(r=>r.name),['public.txt']);
}));

test('missing, mismatched and non-PDF uploads cannot attach or publish; stale saves cannot overwrite newer edits',async()=>fixture(async()=>{
 const id=await create();const revision=(await row(id)).revision;
 for(const config of [{complete:false},{mime:'text/html'},{size:11}]){const file=await upload(id,config);await denied(()=>attach(id,file),/complete PDF upload/)}
 await denied(()=>publish(id),/complete PDF/);
 const foreign=await ready(sibling);await as('authenticated',coach);await denied(()=>attach(id,foreign.file),/complete PDF upload/);
 await db.query("select public.update_progress_report($1,$2,'Updated',current_date,'')",[id,revision]);
 await denied(async()=>db.query("select public.update_progress_report($1,$2,'Stale',current_date,'')",[id,revision]),/Report changed/);
 assert.equal((await row(id)).title,'Updated');
 await denied(async()=>db.query("select public.prepare_progress_report_file($1,$2,'huge.pdf',10485761)",[id,(await row(id)).revision]),/check constraint/);
}));

test('replacement is reviewed as a draft; old file access disappears and athlete association stays immutable',async()=>fixture(async()=>{
 const {id,file}=await ready();await publish(id);
 await denied(async()=>db.query("select public.prepare_progress_report_file($1,$2,'replacement.pdf',12)",[id,(await row(id)).revision]),/unpublished/);
 await unpublish(id);const replacement=await upload(id);await attach(id,replacement);await publish(id);
 await as('authenticated',parent);assert.deepEqual((await db.query('select name from storage.objects')).rows.map(r=>r.name),[replacement.object_path]);
 assert.notEqual(replacement.object_path,file.object_path);
 await as('authenticated',coach);await denied(async()=>db.query('update public.progress_reports set athlete_id=$1 where id=$2',[sibling,id]));
}));

test('revoking a parent removes both report metadata and PDF access; other parent retains access',async()=>fixture(async()=>{
 const {id}=await ready();await publish(id);
 await as('authenticated',coach);await db.query('select public.revoke_guardian_access($1,$2)',[family,parent]);
 await as('authenticated',parent);assert.equal((await db.query('select * from public.progress_reports')).rows.length,0);assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await as('authenticated',second);assert.equal((await db.query('select * from public.progress_reports')).rows.length,1);assert.equal((await db.query('select * from storage.objects')).rows.length,1);
}));

test('publishing queues each confirmed linked parent once; repeated publish and later invitations do not backfill',async()=>fixture(async()=>{
 const {id}=await ready();assert.equal((await queue()).length,0);await publish(id);await publish(id);
 assert.deepEqual((await queue()).map(q=>q.parent_id),[parent,second]);
 await as('postgres');await db.query('insert into public.family_guardians(family_id,user_id) values($1,$2)',[family,stranger]);assert.equal((await queue()).length,2);
 const job=await claim();assert.equal(await current(job),true);assert.equal(job.payload.publication,1);assert.equal(job.payload.athleteName,undefined);await settle(job,true);
 const next=await claim();await settle(next,true);assert.equal(await claim(),null);
}));

test('unpublish, revocation, email changes and confirmation loss skip queued report notifications',async()=>{
 for(const change of [()=>db.query("update public.progress_reports set status='draft'"),()=>db.query('delete from public.family_guardians where user_id=$1',[parent]),()=>db.query("update auth.users set email='changed@example.invalid' where id=$1",[parent]),()=>db.query('update auth.users set email_confirmed_at=null where id=$1',[parent])])await fixture(async()=>{
  const {id}=await ready();await publish(id);await as('postgres');await change();assert.deepEqual(await claim(),{skipped:true});
 });
});

test('pre-send authorization catches revoked access; leases preserve payloads and enforce retry limits',async()=>fixture(async()=>{
 const {id}=await ready();await publish(id);const first=await claim();await settle(first);
 await as('postgres');await db.query("update private.progress_report_notification_outbox set next_attempt_at=now()-interval '1 minute' where parent_id=$1",[first.payload.parentId]);
 const retry=await claim();assert.deepEqual(retry.payload,first.payload);assert.notEqual(retry.leaseToken,first.leaseToken);
 await denied(()=>settle(first,true),/lease unavailable/);
 await as('postgres');await db.query('delete from public.family_guardians where user_id=$1',[retry.payload.parentId]);await as('service_role');assert.equal(await current(retry),false);await settle(retry,false,'no_longer_current');
 const remaining=await claim();await as('postgres');await db.query("update private.progress_report_notification_outbox set first_attempt_at=now()-interval '21 hours',lease_until=now()-interval '1 minute' where parent_id=$1",[remaining.payload.parentId]);
 assert.equal(await claim(),null);assert.equal((await queue()).find(q=>q.parent_id===remaining.payload.parentId).status,'review');
}));

test('the actual SQL queue delivers a minimal portal email through the existing provider flow',async()=>fixture(async()=>{
 const {id}=await ready();await publish(id);await as('service_role');
 const calls=[];
 const admin={async rpc(name,args){
  const names=Object.keys(args),values=Object.values(args);
  const sql=`select public.${name}(${names.map((n,i)=>`${n} => $${i+1}`).join(',')}) as result`;
  return {data:(await db.query(sql,values)).rows[0].result};
 }};
 const response=await deliverReportNotification(admin,{apiKey:'test',from:sender,portalUrl:portal},async(url,opts)=>{calls.push(opts);return Response.json({id:'provider-report-id'})},{error(){}});
 assert.deepEqual(await response.json(),{status:'sent'});
 const body=JSON.parse(calls[0].body);assert.match(body.text,/parent\/reports.html/);assert.equal(body.attachments,undefined);assert.ok(!body.text.includes('Well done'));
 assert.match(calls[0].headers['Idempotency-Key'],/^nva-report-/);
 assert.equal((await queue()).filter(q=>q.status==='sent').length,1);
}));


test('retrying a draft creation key returns the same draft without overwriting an existing record',async()=>fixture(async()=>{
 await as('authenticated',coach);const key='99999999-9999-4999-8999-999999999999';
 const args=[athlete,'Retry-safe report','2026-10-08','',key];
 const sql='select public.create_progress_report($1,$2,$3,$4,$5) as id';
 const first=(await db.query(sql,args)).rows[0].id;
 assert.equal((await db.query(sql,args)).rows[0].id,first);
 assert.equal((await db.query('select * from public.progress_reports')).rows.length,1);
 await denied(async()=>db.query(sql,[athlete,'Changed request','2026-10-08','',key]),/request changed/);
 assert.equal((await row(first)).title,'Retry-safe report');
}));


test('parent downloads require authentication; reusable signed URL creation is denied even with a broad policy',async()=>fixture(async()=>{
 const {id}=await ready();await publish(id);await as('postgres');
 await db.exec('create policy test_broad_storage_sign on storage.objects for select to authenticated using(true)');
 await as('authenticated',parent);
 for(const operation of ['storage.object.sign','object.sign','storage.object.list','']){
  await db.query("select set_config('storage.operation',$1,false)",[operation]);
  assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 }
 await db.query("select set_config('storage.operation','storage.object.get_authenticated',false)");
 assert.equal((await db.query('select * from storage.objects')).rows.length,1);
}));

async function requestContext(method,path,operation=''){
 await db.query("select set_config('request.method',$1,false),set_config('request.path',$2,false),set_config('storage.operation',$3,false)",[method,path,operation]);
}
test('direct private GET downloads work without an operation label, including the SDK legacy route',async()=>fixture(async()=>{
 const {id,file}=await ready();
 // A coach can preview a draft through the same private download paths.
 await as('authenticated',coach);
 for(const prefix of ['/object/','/object/authenticated/','/storage/v1/object/','/storage/v1/object/authenticated/']){
  await requestContext('GET',`${prefix}athlete-progress-reports/${file.object_path}?cacheNonce=test`);
  assert.deepEqual((await db.query('select name from storage.objects')).rows.map(r=>r.name),[file.object_path]);
 }
 await publish(id);await as('authenticated',parent);
 for(const operation of ['', 'object.get', 'storage.object.get']){
  await requestContext('GET',`/object/athlete-progress-reports/${file.object_path}`,operation);
  assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 }
}));
test('download compatibility still hides drafts, other families, replaced PDFs, and revoked access',async()=>fixture(async()=>{
 const {id,file}=await ready();const path=`/object/athlete-progress-reports/${file.object_path}`;
 await as('authenticated',parent);await requestContext('GET',path);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await publish(id);await as('authenticated',stranger);await requestContext('GET',path);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await unpublish(id);const replacement=await upload(id);await attach(id,replacement);await publish(id);
 await as('authenticated',parent);await requestContext('GET',path);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 const current=`/object/athlete-progress-reports/${replacement.object_path}`;
 await requestContext('GET',current);assert.equal((await db.query('select * from storage.objects')).rows.length,1);
 await as('authenticated',coach);await db.query('select public.revoke_guardian_access($1,$2)',[family,parent]);
 await as('authenticated',parent);await requestContext('GET',current);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await as('authenticated',second);await requestContext('GET',current);
 assert.equal((await db.query('select * from storage.objects')).rows.length,1);
}));
test('download compatibility rejects anonymous requests, signing, listing, public/S3 routes and mismatched paths',async()=>fixture(async()=>{
 const {id,file}=await ready();await publish(id);await as('postgres');
 await db.exec('create policy test_broad_compatibility on storage.objects for select to public using(true)');
 const path=`/object/athlete-progress-reports/${file.object_path}`;
 await as('anon');await requestContext('GET',path);
 assert.equal((await db.query('select * from storage.objects')).rows.length,0);
 await as('authenticated',parent);
 const requests=[['POST',path],['POST',`/object/sign/athlete-progress-reports/${file.object_path}`],
  ['GET',`/object/sign/athlete-progress-reports/${file.object_path}`],['POST','/object/list/athlete-progress-reports'],
  ['GET',`/object/public/athlete-progress-reports/${file.object_path}`],['GET',`/s3/athlete-progress-reports/${file.object_path}`],
  ['GET',path+'.extra'],['GET',`/object/other-bucket/${file.object_path}`],['GET','/rest/v1/objects'],['GET','']];
 for(const [method,url] of requests){
  await requestContext(method,url);assert.equal((await db.query('select * from storage.objects')).rows.length,0,`${method} ${url}`);
 }
}));
