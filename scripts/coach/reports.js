import { configured, supabase } from '../auth/client.js';
import { reportBucket, validatePdf, downloadName } from '../reports/files.mjs';
import { element, today, reportDate, loadAthletes, loadReports, loadReport, setupPdfViewer, openPdf, closePdf } from '../reports/shared.js';
const status=document.querySelector('#status'), content=document.querySelector('#report-content');
const selector=document.querySelector('#athlete'), form=document.querySelector('#report-form');
const list=document.querySelector('#report-list'), more=document.querySelector('#load-more');
const signOut=document.querySelector('#sign-out');
let athletes=[], reports=[], editing=null, busy=false, selectedAthlete='', offset=0, total=0, createKey=null;
function message(text){status.textContent=text}
function setBusy(value){busy=value;content.querySelectorAll('button,input,select,textarea').forEach(n=>{n.disabled=value || n.dataset.unavailable === "true"});if(!value)more.disabled=offset>=total}
function resetEditor(report=null){
 editing=report;createKey=crypto.randomUUID();form.reset();form.elements.title.value=report?.title??'';form.elements.report_date.value=report?.report_date??today();
 form.elements.coach_note.value=report?.coach_note??'';
 document.querySelector('#editor-heading').textContent=report?'Edit draft':'Upload a report';
 document.querySelector('#file-label').textContent=report?.file?'Replace PDF (optional)':'PDF report';
 form.elements.pdf.required=!report?.file;
 document.querySelector('#current-file').textContent=report?.file?`Current PDF: ${report.file.original_name}`:'';
 document.querySelector('#save-report').textContent=report?'Save draft':'Upload and save draft';
}
async function rpc(name,args){const result=await supabase.rpc(name,args);if(result.error)throw result.error;return result.data}
function errorMessage(error){return error.code==='40001'?'This report changed in another window. Reload before continuing.':error.code==='42501'?'Coach access changed. Reload the page.':error.message??'Could not complete this action.'}
async function preview(report,download){if(busy)return;setBusy(true);try{await openPdf(supabase,report.file,report.title,download)}catch(error){message(errorMessage(error))}finally{setBusy(false)}}
function action(label,handler){const b=element('button',label,'secondary');b.type='button';b.addEventListener('click',handler);return b}
function render(){
 list.replaceChildren();
 if(!reports.length)list.append(element('p','No progress reports for this athlete yet. Upload a PDF to start their report history.','report-empty'));
 for(const report of reports){
  const card=element('article',undefined,'report-card');
  const header=element('div',undefined,'report-card-head');
  const detail=element('div');detail.append(element('p',reportDate(report.report_date),'report-date'),element('h3',report.title));
  header.append(detail,element('span',report.status==='published'?'Published':'Draft',`report-badge ${report.status}`));card.append(header);
  if(report.coach_note)card.append(element('p',report.coach_note,'report-note'));
  card.append(element('p',report.file?`${report.file.original_name} · ${(report.file.size_bytes/1024/1024).toFixed(1)} MB`:'PDF upload not complete. Open the draft to upload a file.','report-file-info'));
  const actions=element('div',undefined,'report-actions');
  if(report.file)actions.append(action('Preview PDF',()=>preview(report,false)),action('Download',()=>preview(report,true)));
  if(report.status==='draft'){
   actions.append(action('Edit draft',()=>{resetEditor(report);form.scrollIntoView({behavior:'smooth',block:'start'})}));
   const publish=action('Publish to parents',()=>changePublication(report,true));publish.disabled=!report.file;publish.dataset.unavailable=String(!report.file);actions.append(publish);
  }else actions.append(action('Unpublish',()=>changePublication(report,false)));
  card.append(actions);list.append(card);
 }
 more.hidden=offset>=total;
 document.querySelector('#report-total').textContent=`${total} ${total===1?'report':'reports'}`;
}
async function refresh(append=false){
 const result=await loadReports(supabase,selector.value,append?offset:0);
 reports=append?[...reports,...result.rows]:result.rows;offset=reports.length;total=result.total;
 render();
 if(editing){const current=reports.find(r=>r.id===editing.id);if(current)editing=current}
}
async function changePublication(report,publish){
 if(busy)return;
 const athlete=athletes.find(a=>a.id===selector.value);
 const prompt=publish?`Publish “${report.title}” (${reportDate(report.report_date)}) for ${athlete.display_name}? Linked parents can view it and verified parent emails will be notified.`:`Unpublish “${report.title}”? Parents will no longer be able to open it from the portal. You can then replace the PDF or edit the details.`;
 if(!confirm(prompt))return;
 setBusy(true);closePdf();
 try{
  await rpc(publish?'publish_progress_report':'unpublish_progress_report',{p_report_id:report.id,p_revision:report.revision});
  await refresh();
  if(!publish)resetEditor(reports.find(r=>r.id===report.id));else if(editing?.id===report.id)resetEditor();
  message(publish?'Report published. Email notifications are queued for linked parents with verified email addresses.':'Report unpublished. You can edit this draft and replace the PDF.');
 }catch(error){message(errorMessage(error))}finally{setBusy(false)}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!athletes.some(a=>a.id===selector.value))return;
 const file=form.elements.pdf.files[0];
 setBusy(true);let id=editing?.id;
 try{
  if(file)await validatePdf(file);
  if(!file&&!editing?.file)throw new Error('Choose a PDF report to upload.');
  const details={p_title:form.elements.title.value.trim(),p_report_date:form.elements.report_date.value,p_coach_note:form.elements.coach_note.value.trim()};
  if(id){await rpc('update_progress_report',{p_report_id:id,p_revision:editing.revision,...details})}
  else{id=await rpc('create_progress_report',{p_report_id:createKey,p_athlete_id:selector.value,...details});editing={id}}
  // Refresh server revisions before preparing a file. Keep the draft ID on failure.
  await refresh();editing=await loadReport(supabase,id);
  if(file){
   const reserved=await rpc('prepare_progress_report_file',{p_report_id:id,p_revision:editing.revision,p_original_name:downloadName(file.name),p_size_bytes:file.size});
   const upload=await supabase.storage.from(reportBucket).upload(reserved.object_path,file,{contentType:'application/pdf',cacheControl:'0',upsert:false});
   if(upload.error)throw new Error('The draft is saved, but the PDF upload failed. Select the file and try again.');
   await rpc('attach_progress_report_file',{p_report_id:id,p_revision:editing.revision,p_file_id:reserved.file_id});
   await refresh();
  }
  resetEditor(await loadReport(supabase,id));message('Draft saved privately. Preview the PDF, then publish it when ready.');
 }catch(error){message(`${errorMessage(error)}${id?' Your draft remains private. Reload if the result is uncertain.':''}`)}finally{setBusy(false)}
});
selector.addEventListener('change',async()=>{
 if(busy)return;
 if((form.elements.title.value||form.elements.coach_note.value||form.elements.pdf.files.length)&&!confirm('Changing athlete clears unsaved edits. Continue?')){selector.value=selectedAthlete;return}
 selectedAthlete=selector.value;resetEditor();reports=[];list.replaceChildren();setBusy(true);
 try{await refresh();message('')}catch(error){message(errorMessage(error))}finally{setBusy(false)}
});
document.querySelector('#new-report').addEventListener('click',()=>{if(!busy){resetEditor();form.scrollIntoView({behavior:'smooth'})}});
more.addEventListener('click',async()=>{if(busy)return;setBusy(true);try{await refresh(true)}catch(error){message(errorMessage(error))}finally{setBusy(false)}});
signOut.addEventListener('click',async()=>{if(busy)return;signOut.disabled=true;closePdf();const result=await supabase.auth.signOut();if(result.error){signOut.disabled=false;message('Could not sign out.');return}location.replace('/auth/sign-in.html')});
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue=''}});
setupPdfViewer();
async function start(){
 if(!configured){message('Coach portal setup is in progress.');return}
 const auth=await supabase.auth.getUser();if(auth.error||!auth.data.user){location.replace('/auth/sign-in.html');return}
 const role=await supabase.from('coach_users').select('user_id').eq('user_id',auth.data.user.id).maybeSingle();
 if(role.error)throw new Error('Could not verify coach access.');if(!role.data){message('This account does not have coach access.');return}
 signOut.hidden=false;athletes=await loadAthletes(supabase);
 if(!athletes.length){message('Add an athlete to the roster before uploading reports.');return}
 selector.replaceChildren(...athletes.map(a=>{const o=element('option',a.display_name);o.value=a.id;return o}));
 selectedAthlete=selector.value;resetEditor();await refresh();content.hidden=false;message('');
 supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){closePdf();content.hidden=true;location.replace('/auth/sign-in.html')}});
}
start().catch(error=>message(errorMessage(error)));
