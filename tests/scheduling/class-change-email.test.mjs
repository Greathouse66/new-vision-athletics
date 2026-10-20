import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderClassChangeNotification} from '../../supabase/functions/_shared/class-change-notification.mjs';
import {deliverClassChangeNotification} from '../../supabase/functions/drop-in-notification-worker/class-change-delivery.mjs';
import {runNotifications} from '../../supabase/functions/drop-in-notification-worker/run.mjs';
const config={apiKey:'test-only',from:'receipts@example.invalid',portalUrl:'https://newvision-athletics.com/parent/sessions.html'};
const payload={changeId:'11111111-1111-4111-8111-111111111111',parentId:'22222222-2222-4222-8222-222222222222',
  to:'parent@example.invalid',from:config.from,portalUrl:config.portalUrl,action:'rescheduled',reason:'Gym <closed> & unsafe',classLabel:'Intro',
  athletes:[{name:'<Test & "athlete">',bookingKind:'confirmed'},{name:'Sibling',bookingKind:'pending_request'}],
  before:{starts_at:'2030-10-09T23:00:00+00:00',ends_at:'2030-10-10T00:00:00+00:00',time_zone:'America/Chicago',location_name:'Minot Armory'},
  after:{starts_at:'2030-10-10T23:00:00+00:00',ends_at:'2030-10-11T00:00:00+00:00',time_zone:'America/Chicago',location_name:'New gym'}};
test('class-change messages include old and new local details, pending status and escaped parent-visible reasons',()=>{
  const m=renderClassChangeNotification(payload);assert.match(m.text,/Previously:/);assert.match(m.text,/Now:/);
  assert.match(m.text,/Minot Armory/);assert.match(m.text,/New gym/);assert.match(m.text,/coach approval/);
  assert.match(m.html,/&lt;Test &amp; &quot;athlete&quot;&gt;/);assert.match(m.html,/Gym &lt;closed&gt; &amp; unsafe/);
  assert.ok(!m.subject.includes('Test'));assert.ok(!m.html.includes(payload.athletes[0].name));assert.match(m.text,/makeup or refund/);
  const closed=renderClassChangeNotification({...payload,action:'closed'});assert.match(closed.text,/will not take place/);assert.ok(!closed.text.includes('Now:'));assert.ok(!closed.text.includes('remain reserved'));
});
test('malformed event, recipient, time or portal link cannot produce an email',()=>{
  for(const patch of [{changeId:'bad'},{parentId:null},{to:'bad\r\n@example.invalid'},{action:'other'},{reason:''},{athletes:[]},
    {portalUrl:config.portalUrl+'?token=secret'},{portalUrl:'http://example.invalid/parent/sessions.html'},
    {before:{...payload.before,starts_at:'2030-10-09T23:00:00'}},{after:{...payload.after,time_zone:'Invalid/Zone'}}]){
    assert.throws(()=>renderClassChangeNotification({...payload,...patch}));
  }
});
function fixture({revoked=false,status=200,throws=false}={}){
  const calls=[];let claims=0;
  const admin={async rpc(name,args){calls.push([name,args]);if(name==='claim_class_change_notification'){
    if(throws)throw new Error('private detail');return {data:claims++?null:{payload,leaseToken:'lease'}};
  }if(name==='class_change_notification_current')return {data:!revoked};return {data:null,error:null};}};
  const send=async(url,args)=>{calls.push(['send',args]);return Response.json({id:'provider-id'},{status});};
  const log={error(...args){calls.push(['log',args]);}};return {admin,calls,send,log};
}
test('delivery rechecks access and settles one message using an event-and-parent idempotency key',async()=>{
  const f=fixture();assert.equal((await (await deliverClassChangeNotification(f.admin,config,f.send,f.log)).json()).status,'sent');
  assert.deepEqual(f.calls.map(c=>c[0]),['claim_class_change_notification','class_change_notification_current','send','settle_class_change_notification']);
  assert.equal(f.calls[1][1].p_change_id,payload.changeId);assert.equal(f.calls[1][1].p_parent_id,payload.parentId);
  assert.equal(f.calls[2][1].headers['Idempotency-Key'],'nva-class-change-'+payload.changeId+'-'+payload.parentId);
  assert.deepEqual(JSON.parse(f.calls[2][1].body).to,[payload.to]);
  assert.equal((await (await deliverClassChangeNotification(f.admin,config,f.send,f.log)).json()).status,'idle');
});
test('revoked recipients send nothing and temporary provider errors are retried',async()=>{
  const f=fixture({revoked:true});assert.equal((await (await deliverClassChangeNotification(f.admin,config,f.send,f.log)).json()).status,'skipped');
  assert.ok(!f.calls.some(c=>c[0]==='send'));
  for(const status of [429,503]){const retry=fixture({status});assert.equal((await (await deliverClassChangeNotification(retry.admin,config,retry.send,retry.log)).json()).status,'retry');assert.ok(!JSON.stringify(retry.calls.filter(c=>c[0]==='log')).includes(payload.to));}
});
test('class-change queue participates in the scheduled worker and failures remain isolated',async()=>{
  for(const throws of [false,true]){
    const f=fixture({throws});const result=await runNotifications(f.admin,{...config,reviewUrl:'https://newvision-athletics.com/coach/drop-ins.html'},config,f.send,f.log);
    const body=await result.json();assert.equal(result.status,throws?503:200);assert.equal(body.parent.status,'idle');assert.equal(body.coach.status,'idle');
    if(throws)assert.ok(body.class_changes.error);else assert.equal(body.class_changes.status,'sent');
  }
});
