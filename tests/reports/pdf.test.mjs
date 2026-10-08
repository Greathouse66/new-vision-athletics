import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePdf, downloadName, maxReportBytes} from '../../scripts/reports/files.mjs';
import {fetchReportPdf} from '../../scripts/reports/download.mjs';
import {renderProgressReportNotification} from '../../supabase/functions/_shared/progress-report-notification.mjs';
import {runNotifications} from '../../supabase/functions/drop-in-notification-worker/run.mjs';
const payload={reportId:'11111111-1111-4111-8111-111111111111',parentId:'22222222-2222-4222-8222-222222222222',publication:1,to:'parent@example.invalid',from:'receipts@example.invalid',portalUrl:'https://newvision-athletics.com/parent/reports.html'};
const file={object_path:`${payload.reportId}/${payload.parentId}.pdf`};
const config={url:'https://project.example.invalid',key:'sb_publishable_test'};
const sessionClient={auth:{async getSession(){return{data:{session:{access_token:'test-user-token'}}}}}};
test('authenticated downloads accept valid PDF bytes with binary or absent delivery MIME',async()=>{
 const nonces=new Set();
 for(const type of ['application/pdf','application/octet-stream','','application/pdf; charset=utf-8']){
  const send=async (url,parameters)=>{
   const parsed=new URL(url);
   assert.equal(parsed.pathname,`/storage/v1/object/authenticated/athlete-progress-reports/${file.object_path}`);
   assert.equal(parsed.origin,config.url);assert.ok(parsed.searchParams.get('cacheNonce'));assert.ok(!url.includes('test-user-token'));
   nonces.add(parsed.searchParams.get('cacheNonce'));
   assert.equal(parameters.method,'GET');assert.equal(parameters.cache,'no-store');assert.equal(parameters.credentials,'omit');assert.equal(parameters.redirect,'error');
   assert.equal(parameters.headers.Authorization,'Bearer test-user-token');assert.equal(parameters.headers.apikey,config.key);
   assert.ok(parameters.signal instanceof AbortSignal);
   return new Response(new Blob(['%PDF-1.7\n'],{type}));
  };
  const pdf=await fetchReportPdf(sessionClient,file,config,send);assert.equal(pdf.type,'application/pdf');assert.equal(await pdf.text(),'%PDF-1.7\n');
 }
 assert.equal(nonces.size,4);
});
test('download validation still rejects non-PDF bytes and reports safe Storage errors',async()=>{
 await assert.rejects(fetchReportPdf(sessionClient,file,config,async()=>new Response('<html>error</html>')),/does not appear to be a PDF/);
 await assert.rejects(fetchReportPdf(sessionClient,file,config,async()=>Response.json({code:'AccessDenied',message:'Private provider error detail'},{status:403})),error=>{
  assert.match(error.message,/Storage 403/);assert.ok(!error.message.includes('Private provider'));return true;
 });
 await assert.rejects(fetchReportPdf(sessionClient,file,config,async()=>Response.json({code:'NoSuchKey'},{status:404})),/Storage 404; NoSuchKey/);
 await assert.rejects(fetchReportPdf(sessionClient,file,config,async()=>new Response('Provider outage',{status:502})),/Storage 502/);
});
test('missing or failed sessions never make a file request; every click uses the current session token',async()=>{
 for(const auth of [{data:{session:null}},{error:{message:'Auth unavailable'}}]){
  const client={auth:{async getSession(){return auth}}};
  await assert.rejects(fetchReportPdf(client,file,config,()=>{throw new Error('File request should not run')}),/sign-in session has ended/);
 }
 let calls=0;
 const client={auth:{async getSession(){return{data:{session:{access_token:`current-token-${++calls}`}}}}}};
 const headers=[];
 for(let i=0;i<2;i++)await fetchReportPdf(client,file,config,async(url,options)=>{
  headers.push(options.headers.Authorization);return new Response('%PDF-1.7\n');
 });
 assert.deepEqual(headers,['Bearer current-token-1','Bearer current-token-2']);
});
test('a stalled PDF fetch aborts and gives a retry message instead of leaving buttons disabled forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let started;
 const ready=new Promise(resolve=>started=resolve);
 const send=(url,{signal})=>{started();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));};
 const result=fetchReportPdf(sessionClient,file,config,send);await ready;t.mock.timers.tick(20000);await assert.rejects(result,/timed out/);
});
test('uploads check PDF bytes and size, and download names cannot contain path/control characters',async()=>{
 await validatePdf(new File(['%PDF-1.7\n'], 'report.pdf',{type:'application/pdf'}));
 await validatePdf(new File(['%PDF-1.7\n'], 'report.pdf'));
 for(const file of [new File(['<html>fake'], 'report.pdf',{type:'application/pdf'}),new File(['%PDF-1.7'], 'report.html',{type:'text/html'}),new File(['x'],'short.pdf'),{size:maxReportBytes+1}])await assert.rejects(validatePdf(file));
 assert.equal(downloadName('../../test\nname.pdf'),'..-..-test-name.pdf');
 assert.equal(downloadName('report'),'report.pdf');
});
test('email carries only a protected portal link and rejects malformed or tokenized links',()=>{
 const message=renderProgressReportNotification({...payload,title:'Secret progress',note:'private notes'});
 assert.ok(!JSON.stringify(message).includes('Secret progress'));assert.ok(!JSON.stringify(message).includes('private notes'));assert.match(message.text,/parent\/reports.html/);
 for(const change of [{publication:0},{reportId:'bad'},{to:'invalid'},{portalUrl:'https://newvision-athletics.com/parent/reports.html?token=secret'},{portalUrl:'http://newvision-athletics.com/parent/reports.html'}])assert.throws(()=>renderProgressReportNotification({...payload,...change}));
});
test('report-queue failures cannot block existing notification queues',async()=>{
 const calls=[];const admin={async rpc(name){calls.push(name);if(name==='claim_progress_report_notification')throw new Error('Private failure detail');return{data:null}}};
 const config={from:payload.from,apiKey:'test',portalUrl:payload.portalUrl,reviewUrl:'https://newvision-athletics.com/coach/drop-ins.html'};
 const logs=[];const result=await runNotifications(admin,config,config,()=>{throw Error('No mail expected')},{error(...a){logs.push(a)}});
 assert.equal(result.status,503);const body=await result.json();assert.deepEqual(body.parent,{status:'idle'});assert.deepEqual(body.coach,{status:'idle'});assert.deepEqual(body.cancellation,{status:'idle'});
 assert.ok(calls.includes('claim_progress_report_notification'));assert.ok(!JSON.stringify(logs).includes('Private failure detail'));
});
