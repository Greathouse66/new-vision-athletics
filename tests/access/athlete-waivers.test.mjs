import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { testDatabase } from '../helpers/database.mjs';
let db;
const coach='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',parent='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherParent='cccccccc-cccc-4ccc-8ccc-cccccccccccc',unconfirmed='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const secondParent='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const family='11111111-1111-4111-8111-111111111111',otherFamily='22222222-2222-4222-8222-222222222222';
const athlete='33333333-3333-4333-8333-333333333333',sibling='44444444-4444-4444-8444-444444444444',otherAthlete='55555555-5555-4555-8555-555555555555';
let version;
before(async()=>{db=await testDatabase();version=(await db.query('select * from public.waiver_versions where is_current')).rows[0];});
after(async()=>{await db?.close();});
async function as(role,user=''){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${user}',false);set role ${role};`);}
async function denied(fn,pattern){await db.exec('savepoint denied');try{await assert.rejects(fn,pattern);}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
async function fixture(run){
 await db.exec('begin');
 try{
  await db.exec(`insert into auth.users values ('${coach}','coach@example.invalid',now()),('${parent}','parent@example.invalid',now()),('${otherParent}','other@example.invalid',now()),('${unconfirmed}','pending@example.invalid',null),('${secondParent}','second@example.invalid',now());
   insert into public.coach_users(user_id) values ('${coach}');
   insert into public.families(id,display_name) values ('${family}','Linked family'),('${otherFamily}','Other family');
   insert into public.athletes(id,family_id,display_name) values ('${athlete}','${family}','Athlete One'),('${sibling}','${family}','Athlete Two'),('${otherAthlete}','${otherFamily}','Other athlete');
   insert into public.family_guardians(family_id,user_id) values ('${family}','${parent}'),('${family}','${secondParent}'),('${family}','${unconfirmed}'),('${otherFamily}','${otherParent}');`);
  await run();
 }finally{await db.exec('reset role;rollback');}
}
async function sign(overrides={}){
 const input={athlete_id:athlete,waiver_version_id:version.id,date_of_birth:'2014-05-20',guardian_name:'Test Guardian',emergency_contact:'Emergency Person',emergency_phone:'(701) 555-0123',signature_name:'Test Guardian',acknowledgment_accepted:true,electronic_consent_accepted:true,...overrides};
 const keys=Object.keys(input);
 return (await db.query(`select public.sign_athlete_waiver(${keys.map((k,i)=>`p_${k}=>$${i+1}`).join(',')}) as id`,Object.values(input))).rows[0].id;
}
async function statuses(){return (await db.query('select * from public.list_athlete_waiver_statuses()')).rows;}

test('waiver wording preserves the source clauses, with electronic consent kept separately',()=>{
 assert.equal(version.company_name,'Newvision Athletic Training LLC');
 assert.equal(version.title,'Youth Basketball Training Liability Waiver and Release Form');
 for(const heading of ['1. Assumption of Risk','2. Release and Waiver','3. Medical Treatment','4. Indemnification'])assert.ok(version.body.includes(heading));
 assert.ok(version.body.includes('whether caused by the negligence of the Company or otherwise'));
 assert.ok(version.acknowledgment.includes('If the participant is under 18'));
 assert.ok(version.electronic_consent.includes('I intend to sign this waiver electronically'));
});

test('completion is per athlete and visible to current linked parents and coaches',async()=>fixture(async()=>{
 await as('authenticated',parent);
 assert.deepEqual((await statuses()).map(r=>r.athlete_id).sort(),[athlete,sibling].sort());
 assert.ok((await statuses()).every(r=>r.waiver_status==='needs_signing'));
 const id=await sign();
 const rows=await statuses();
 assert.equal(rows.find(r=>r.athlete_id===athlete).signature_id,id);
 assert.equal(rows.find(r=>r.athlete_id===athlete).waiver_status,'completed');
 assert.equal(rows.find(r=>r.athlete_id===sibling).waiver_status,'needs_signing');
 await as('authenticated',coach);
 assert.equal((await statuses()).length,3);
 assert.equal((await db.query('select id from public.athlete_waiver_signatures')).rows[0].id,id);
 await as('authenticated',secondParent);
 assert.equal((await statuses()).find(r=>r.athlete_id===athlete).waiver_status,'completed');
 assert.equal((await db.query('select * from public.athlete_waiver_signatures where id=$1',[id])).rows.length,1);
}));

test('signature evidence is captured from verified identity and server document/time, not caller metadata',async()=>fixture(async()=>{
 await as('authenticated',parent);
 const id=await sign();
 const record=(await db.query('select * from public.athlete_waiver_signatures where id=$1',[id])).rows[0];
 assert.equal(record.participant_name,'Athlete One');assert.equal(record.signed_by,parent);
 assert.equal(record.signer_email,'parent@example.invalid');assert.equal(record.signature_name,'Test Guardian');
 assert.equal(record.acknowledgment_accepted,true);assert.equal(record.electronic_consent_accepted,true);
 assert.equal(record.document.body,version.body);assert.equal(record.document.acknowledgment,version.acknowledgment);
 assert.equal(record.document.electronic_consent,version.electronic_consent);
 assert.equal(record.document_sha256,createHash('sha256').update([version.company_name,version.title,version.body,version.acknowledgment,version.electronic_consent].join('\n')).digest('hex'));
 assert.ok(Math.abs(Date.now()-new Date(record.signed_at).getTime())<60000);
}));

test('anonymous, unverified, cross-family and coach-only identities cannot sign for an athlete',async()=>fixture(async()=>{
 await as('anon');await denied(()=>sign(),/permission denied/);await denied(()=>statuses(),/permission denied/);
 for(const user of [unconfirmed,otherParent,coach]){
  await as('authenticated',user);await denied(()=>sign(),/Verified parent|Linked athlete/);
 }
 await as('authenticated',parent);await denied(()=>sign({athlete_id:otherAthlete}),/Linked athlete/);
}));

test('both consents, birth date, emergency details and matching typed signature are required server-side',async()=>fixture(async()=>{
 await as('authenticated',parent);
 for(const change of [{acknowledgment_accepted:false},{acknowledgment_accepted:null},{electronic_consent_accepted:false},{electronic_consent_accepted:null},
  {date_of_birth:null},{date_of_birth:'1800-01-01'},{date_of_birth:'2099-01-01'},
  {guardian_name:' '},{guardian_name:'x'.repeat(161)},{emergency_contact:''},{emergency_phone:'abcdefg'},
  {signature_name:'Other Name'},{signature_name:null}])await denied(()=>sign(change),/Complete all fields/);
 assert.equal((await db.query('select * from public.athlete_waiver_signatures')).rows.length,0);
}));

test('retries do not duplicate signatures and another guardian cannot overwrite a completed waiver',async()=>fixture(async()=>{
 await as('authenticated',parent);const id=await sign();assert.equal(await sign(),id);
 await denied(()=>sign({emergency_contact:'Changed contact'}),/already completed/);
 await as('authenticated',secondParent);await denied(()=>sign(),/already completed/);
 assert.equal((await db.query('select * from public.athlete_waiver_signatures')).rows.length,1);
}));

test('browser roles cannot forge, edit or delete records or change waiver wording',async()=>fixture(async()=>{
 await as('authenticated',parent);const id=await sign();
 for(const user of [parent,coach]){
  await as('authenticated',user);
  await denied(()=>db.query('update public.athlete_waiver_signatures set signer_email=$1 where id=$2',['forged@example.invalid',id]),/permission denied/);
  await denied(()=>db.query('delete from public.athlete_waiver_signatures where id=$1',[id]),/permission denied/);
  await denied(()=>db.query('insert into public.athlete_waiver_signatures(id) values($1)',[id]),/permission denied/);
  await denied(()=>db.query("update public.waiver_versions set body='Changed'"),/permission denied/);
 }
 await as('postgres');
 await denied(()=>db.query('update public.athlete_waiver_signatures set guardian_name=$1 where id=$2',['Changed',id]),/cannot be edited/);
 await denied(()=>db.query('delete from public.athlete_waiver_signatures where id=$1',[id]),/cannot be edited/);
 await denied(()=>db.query("update public.waiver_versions set body='Changed'"),/new waiver version/);
}));

test('other families see no signed details and revocation removes status/read/sign access',async()=>fixture(async()=>{
 await as('authenticated',parent);const id=await sign();
 await as('authenticated',otherParent);
 assert.equal((await db.query('select * from public.athlete_waiver_signatures')).rows.length,0);
 assert.deepEqual((await statuses()).map(r=>r.athlete_id),[otherAthlete]);
 await as('authenticated',coach);await db.query('select public.revoke_guardian_access($1,$2)',[family,parent]);
 await as('authenticated',parent);
 assert.deepEqual(await statuses(),[]);
 assert.equal((await db.query('select * from public.athlete_waiver_signatures where id=$1',[id])).rows.length,0);
 await denied(()=>sign(),/Linked athlete/);
 await as('authenticated',coach);
 assert.equal((await db.query('select * from public.athlete_waiver_signatures where id=$1',[id])).rows.length,1);
}));

test('a new version requires fresh signatures and preserves the original signed snapshot/history',async()=>fixture(async()=>{
 await as('authenticated',parent);const oldId=await sign();
 await as('postgres');await db.exec('update public.waiver_versions set is_current=false');
 const next=(await db.query(`insert into public.waiver_versions(version_label,company_name,title,body,acknowledgment,electronic_consent,is_current)
  select 'test-v2',company_name,title,body||E'\nTest revision',acknowledgment,electronic_consent,true from public.waiver_versions where id=$1 returning id`,[version.id])).rows[0].id;
 await as('authenticated',parent);
 assert.equal((await statuses()).find(r=>r.athlete_id===athlete).waiver_status,'needs_signing');
 await denied(()=>sign(),/Waiver changed/);
 const newId=await sign({waiver_version_id:next});assert.notEqual(oldId,newId);
 const old=(await db.query('select * from public.athlete_waiver_signatures where id=$1',[oldId])).rows[0];
 assert.equal(old.document.body,version.body);assert.equal(old.document.version_label,version.version_label);
 assert.equal((await statuses()).find(r=>r.athlete_id===athlete).signature_id,newId);
}));

test('no current version is setup pending rather than a false completion',async()=>fixture(async()=>{
 await as('postgres');await db.exec('update public.waiver_versions set is_current=false');
 await as('authenticated',parent);assert.ok((await statuses()).every(r=>r.waiver_status==='not_configured'));
 await denied(()=>sign(),/Waiver changed/);
}));
