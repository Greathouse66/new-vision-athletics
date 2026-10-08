import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadReport } from '../../supabase/functions/progress-report-download/download.mjs';
const id = '11111111-1111-4111-8111-111111111111';
const path = `${id}/${id}.pdf`;
const pdf = new Blob(['%PDF-1.7\nEND'], {type:'application/octet-stream'});
const file = {id, object_path:path, size_bytes:pdf.size};
const request = (body={file_id:id}, method='POST') => new Request('https://example.invalid/download', {
  method, ...(method==='POST'?{body:JSON.stringify(body)}:{}),
});
function clients({results=[{data:file},{data:file}], stored={data:pdf}, throwDownload=false}={}) {
  const calls=[];
  const caller={from(table){assert.equal(table,'progress_report_files');return{
    select(fields){assert.equal(fields,'id, object_path, size_bytes');return this},
    eq(column,value){assert.equal(column,'id');assert.equal(value,id);return this},
    async maybeSingle(){calls.push('permission');return results.shift() ?? {data:null}},
  }}};
  const admin={storage:{from(bucket){assert.equal(bucket,'athlete-progress-reports');return{
    async download(object){assert.equal(object,path);calls.push('storage');if(throwDownload)throw Error('Secret provider detail');return stored},
  }}}};
  return {caller,admin,userId:'verified-user',calls};
}
test('private download checks caller RLS before and after privileged Storage fetch and returns uncached PDF bytes',async()=>{
  const c=clients();const response=await downloadReport(request(),c);
  assert.equal(response.status,200);assert.equal(await response.text(),await pdf.text());
  assert.deepEqual(c.calls,['permission','storage','permission']);
  assert.equal(response.headers.get('Content-Type'),'application/pdf');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.ok(!response.headers.has('Location'));
});
test('missing user, invalid ID, arbitrary bucket/path and wrong methods never query or fetch a PDF',async()=>{
  const c=clients();
  assert.equal((await downloadReport(request(),{...c,userId:null})).status,401);
  assert.equal((await downloadReport(request({},'GET'),c)).status,405);
  for(const body of [null,[],{file_id:'bad'},{file_id:id,object_path:path},{file_id:id,bucket:'other'},{file_id:'x'.repeat(1100)}]) {
    assert.equal((await downloadReport(request(body),c)).status,400);
  }
  assert.deepEqual(c.calls,[]);
});
test('RLS-hidden files and failed permission checks never call privileged Storage',async()=>{
  for(const result of [{data:null},{error:{message:'Private database detail'}}]) {
    const c=clients({results:[result]});const response=await downloadReport(request(),c);
    assert.equal(response.status,result.error?503:404);assert.deepEqual(c.calls,['permission']);
    assert.ok(!JSON.stringify(await response.json()).includes('Private'));
  }
});
test('revocation or replacement during download prevents returning already-fetched bytes',async()=>{
  for(const result of [{data:null},{data:{...file,object_path:'changed'}},{error:{message:'Private error'}}]) {
    const c=clients({results:[{data:file},result]});const response=await downloadReport(request(),c);
    assert.equal(response.status,result.error?503:404);assert.equal(response.headers.get('Content-Type'),'application/json');
    assert.ok(!(await response.text()).includes('%PDF-'));
  }
});
test('invalid reservation paths/sizes fail before Storage; missing or invalid PDF bytes fail safely',async()=>{
  for(const change of [{object_path:'../another-bucket/file.pdf'},{size_bytes:0},{size_bytes:10485761}]) {
    const c=clients({results:[{data:{...file,...change}}]});assert.equal((await downloadReport(request(),c)).status,502);
    assert.deepEqual(c.calls,['permission']);
  }
  for(const stored of [{error:{message:'Secret provider detail'}},{data:new Blob(['<html>error!'])},{data:new Blob(['%PDF-too-long'])}]) {
    const c=clients({stored});const response=await downloadReport(request(),c);assert.equal(response.status,502);
    assert.ok(!(await response.text()).includes('Secret'));
  }
  const c=clients({throwDownload:true});const response=await downloadReport(request(),c);
  assert.equal(response.status,503);assert.ok(!(await response.text()).includes('Secret'));
});
