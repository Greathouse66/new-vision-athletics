import { configured, supabase } from '../auth/client.js';
import { element, reportDate, loadAthletes, loadReports, setupPdfViewer, openPdf, closePdf } from '../reports/shared.js';
const status=document.querySelector('#status'), content=document.querySelector('#report-content');
const selector=document.querySelector('#athlete'),list=document.querySelector('#report-list'),more=document.querySelector('#load-more'),signOut=document.querySelector('#sign-out');
let reports=[],offset=0,total=0,busy=false;
function action(label,handler){const b=element('button',label,'secondary');b.type='button';b.addEventListener('click',handler);return b}
function render(){
 list.replaceChildren();
 if(!reports.length)list.append(element('p','No published reports yet. Reports from Coach Emery will appear here when they are ready.','report-empty'));
 for(const report of reports){
  const card=element('article',undefined,'report-card');card.append(element('p',reportDate(report.report_date),'report-date'),element('h2',report.title));
  if(report.coach_note)card.append(element('p',report.coach_note,'report-note'));
  const actions=element('div',undefined,'report-actions');
  if(report.file)actions.append(action('View report',()=>view(report,false)),action('Download PDF',()=>view(report,true)));
  else card.append(element('p','This PDF is unavailable. Please contact the coach.'));
  card.append(actions);list.append(card);
 }
 more.hidden=offset>=total;
 document.querySelector('#report-total').textContent=`${total} ${total===1?'report':'reports'}`;
}
function setBusy(value){busy=value;content.querySelectorAll('button,select').forEach(n=>n.disabled=value)}
async function refresh(append=false){const result=await loadReports(supabase,selector.value,append?offset:0,true);reports=append?[...reports,...result.rows]:result.rows;offset=reports.length;total=result.total;render()}
async function view(report,download){if(busy)return;setBusy(true);try{await openPdf(supabase,report.file,report.title,download)}catch(error){status.textContent=error.message}finally{setBusy(false)}}
selector.addEventListener('change',async()=>{closePdf();reports=[];list.replaceChildren();setBusy(true);try{await refresh();status.textContent=''}catch(error){status.textContent=error.message}finally{setBusy(false)}});
more.addEventListener('click',async()=>{if(busy)return;setBusy(true);try{await refresh(true)}catch(error){status.textContent=error.message}finally{setBusy(false)}});
signOut.addEventListener('click',async()=>{if(busy)return;signOut.disabled=true;closePdf();const result=await supabase.auth.signOut();if(result.error){signOut.disabled=false;status.textContent='Could not sign out.';return}location.replace('/auth/sign-in.html')});
setupPdfViewer();
async function start(){
 if(!configured){status.textContent='Parent portal setup is in progress.';return}
 const auth=await supabase.auth.getUser();if(auth.error||!auth.data.user){location.replace('/auth/sign-in.html');return}
 signOut.hidden=false;const athletes=await loadAthletes(supabase,auth.data.user.id);
 if(!athletes.length){status.textContent='No athletes linked yet. Review invitations on My athletes or contact the coach.';return}
 selector.replaceChildren(...athletes.map(a=>{const o=element('option',a.display_name);o.value=a.id;return o}));
 await refresh();content.hidden=false;status.textContent='';
 supabase.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){closePdf();content.hidden=true;location.replace('/auth/sign-in.html')}});
}
start().catch(error=>{content.hidden=true;status.textContent=error.message??'Could not load progress reports. Please try again.'});
