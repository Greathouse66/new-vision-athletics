import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePdf, downloadName, maxReportBytes} from '../../scripts/reports/files.mjs';
import {fetchReportPdf} from '../../scripts/reports/download.mjs';
import {renderProgressReportNotification} from '../../supabase/functions/_shared/progress-report-notification.mjs';
import {runNotifications} from '../../supabase/functions/drop-in-notification-worker/run.mjs';
const payload={reportId:'11111111-1111-4111-8111-111111111111',parentId:'22222222-2222-4222-8222-222222222222',publication:1,to:'parent@example.invalid',from:'receipts@example.invalid',portalUrl:'https://newvision-athletics.com/parent/reports.html'};
const file={object_path:`${payload.reportId}/${payload.parentId}.pdf`};
test('authenticated downloads accept valid PDF bytes with binary or absent delivery MIME',async()=>{
 for(const type of ['application/pdf','application/octet-stream','','application/pdf; charset=utf-8']){
  const client={storage:{from(bucket){assert.equal(bucket,'athlete-progress-reports');return{async download(path,options,parameters){
   assert.equal(path,file.object_path);assert.equal(parameters.cache,'no-store');assert.ok(parameters.signal instanceof AbortSignal);
   return{data:new Blob(['%PDF-1.7\n'],{type}),error:null};
  }}}}};
  const pdf=await fetchReportPdf(client,file);assert.equal(pdf.type,'application/pdf');assert.equal(await pdf.text(),'%PDF-1.7\n');
 }
});
test('download validation still rejects non-PDF bytes and reports safe Storage errors',async()=>{
 const client=result=>({storage:{from(){return{async download(){return result}}}}});
 await assert.rejects(fetchReportPdf(client({data:new Blob(['<html>error</html>'],{type:'application/octet-stream'})}),file),/does not appear to be a PDF/);
 await assert.rejects(fetchReportPdf(client({error:{statusCode:'403',message:'Private provider error detail'}}),file),error=>{
  assert.match(error.message,/Storage 403/);assert.ok(!error.message.includes('Private provider'));return true;
 });
 await assert.rejects(fetchReportPdf(client({data:null}),file),/did not return a file/);
});
test('a stalled PDF fetch aborts and gives a retry message instead of leaving buttons disabled forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const client={storage:{from(){return{download(path,options,{signal}){
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 }}}}};
 const result=fetchReportPdf(client,file);t.mock.timers.tick(20000);await assert.rejects(result,/timed out/);
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
