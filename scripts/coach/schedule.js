import { configured, supabase } from '../auth/client.js';
import { currentOrNextMondayChicago, isMondayDate, classDatesForWeek, todayChicago } from './week-date.mjs';
const $ = selector => document.querySelector(selector);
const status=$('#status'),content=$('#coach-content'),week=$('#week-start'),venue=$('#venue');
const currentVenue=$('#current-venue'),datesContainer=$('#open-dates'),create=$('#create-dates'),datedStatus=$('#dated-status');
const editor=$('#schedule-editor'),editorStatus=$('#editor-status'),template=$('#template'),level=$('#class-level');
const day=$('#class-day'),time=$('#class-time'),duration=$('#class-duration'),capacity=$('#class-capacity'),effective=$('#effective-from');
const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
let venues=[],schedule={revision:null,classes:[],last_created_by_day:{}},selectedVenue=null,counts=new Map(),busy=false,weekRequest=0;
function option(value,text){const n=document.createElement('option');n.value=value;n.textContent=text;return n;}
function plusDay(value){const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function weekday(value){return new Date(value+'T12:00:00Z').getUTCDay()||7;}
function clock(value){const [h,m]=value.split(':').map(Number);return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'am':'pm'}`;}
function label(row){return `${weekdays[row.iso_weekday-1]} ${clock(row.local_start_time)} · ${row.class_label} · ${row.duration_minutes} min · ${row.capacity} places`;}
function rulesOn(date){return schedule.classes.filter(row=>row.iso_weekday===weekday(date)&&row.active_from<=date&&(!row.active_until||row.active_until>date));}
function updateCreate(){create.disabled=busy||!selectedVenue||venue.value!==selectedVenue||!datesContainer.querySelector('input:checked:not(:disabled)');}
function setBusy(value){busy=value;content.querySelectorAll('button,input,select').forEach(n=>{n.disabled=value||n.dataset.unavailable==='true';});$('#sign-out').disabled=value;updateCreate();}
function errorText(error){
 if(error.code==='42501')return 'Coach access is no longer available. Reload and sign in again.';
 if(error.code==='40001')return 'The schedule changed in another window. Reload and review the latest version before continuing.';
 if(error.code==='23505')return 'That class already has a weekly rule at this day and time.';
 if(['55000','23514','22023'].includes(error.code))return error.message;
 return 'Could not save or reload the schedule. Reload before trying again.';
}
function renderWeek(){
 const list=$('#weekly-classes');list.replaceChildren();datesContainer.replaceChildren();
 for(const date of classDatesForWeek(week.value,7)){
  const rules=rulesOn(date);
  for(const row of rules){const li=document.createElement('li');li.textContent=label(row);list.append(li);}
  const l=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.name='openDate';input.value=date;
  input.dataset.unavailable=String(counts.has(date)||!rules.length||!selectedVenue||venue.value!==selectedVenue);
  input.disabled=busy||input.dataset.unavailable==='true';input.addEventListener('change',updateCreate);
  l.append(input,` ${weekdays[weekday(date)-1]}, ${date}${counts.has(date)?` — ${counts.get(date)} classes already created`:!rules.length?' — no weekly classes scheduled':''}`);datesContainer.append(l);
 }
 if(!list.childElementCount){const li=document.createElement('li');li.textContent='No weekly classes scheduled for this week.';list.append(li);}
 updateCreate();
}
function earliest(row){
 const dates=[todayChicago(),row?.active_from??todayChicago()];
 if(row?.last_created_date)dates.push(plusDay(row.last_created_date));
 const last=schedule.last_created_by_day[String(day.value)];if(last)dates.push(plusDay(last));
 return dates.sort().at(-1);
}
function updateEffective(){
 const row=schedule.classes.find(row=>row.id===template.value);effective.min=earliest(row);
 effective.max=row?.active_until?new Date(new Date(row.active_until+'T12:00:00Z').getTime()-86400000).toISOString().slice(0,10):'';
 $('#effective-help').textContent=`Earliest change date: ${effective.min}. Already-created classes keep their saved time, level, venue and seats. Review the selected week again before creating dates.`;
}
function loadEditor(){
 const row=schedule.classes.find(row=>row.id===template.value);
 level.value=row?(row.class_kind==='intro'?'intro':row.group_id):'';day.value=String(row?.iso_weekday??1);time.value=row?.local_start_time.slice(0,5)??'18:00';duration.value=String(row?.duration_minutes??60);capacity.value=String(row?.capacity??10);
 updateEffective();effective.value=[effective.min,currentOrNextMondayChicago()].sort().at(-1);
 $('#template-info').textContent=row?`Version from ${row.active_from}${row.active_until?` until ${row.active_until}`:''}. ${row.regular_assignments} regular assignment(s) continue into this revision. Last created class: ${row.last_created_date??'none'}.`:'Add a weekly rule, then create its confirmed open dates separately. Dates already created are not changed.';
 editorStatus.textContent='';
}
async function loadSchedule(){
 const result=await supabase.rpc('coach_weekly_schedule');if(result.error)throw result.error;
 if(!result.data||!Array.isArray(result.data.classes)||result.data.revision==null)throw new Error('schedule');
 schedule=result.data;const selected=template.value;template.replaceChildren(option('','Add a new weekly class'));
 for(const row of schedule.classes.filter(row=>row.is_latest&&(!row.active_until||row.active_until>todayChicago()))){template.append(option(row.id,`${label(row)} · from ${row.active_from}`));}
 if([...template.options].some(o=>o.value===selected))template.value=selected;
}
async function loadWeek(){
 const request=++weekRequest;selectedVenue=null;venue.value='';counts=new Map();datedStatus.textContent='';currentVenue.textContent='';renderWeek();
 if(!isMondayDate(week.value)){status.textContent='Choose a Monday for the class week.';return;}
 const dates=classDatesForWeek(week.value,7);
 const [v,c]=await Promise.all([
  supabase.from('class_week_venues').select('location_id').eq('week_start',week.value).maybeSingle(),
  supabase.from('class_occurrences').select('class_date',{count:'exact'}).gte('class_date',dates[0]).lte('class_date',dates.at(-1)),
 ]);
 if(v.error||c.error||c.count>c.data.length)throw v.error??c.error??new Error('class count');if(request!==weekRequest)return;
 selectedVenue=v.data?.location_id??null;venue.value=selectedVenue??'';
 for(const row of c.data)counts.set(row.class_date,(counts.get(row.class_date)??0)+1);
 currentVenue.textContent=selectedVenue?`Current venue: ${venues.find(v=>v.id===selectedVenue)?.display_name??'Venue needs review'}.`:'No venue selected for this week.';
 renderWeek();status.textContent='';
}
week.addEventListener('change',async()=>{if(busy)return;setBusy(true);try{await loadSchedule();await loadWeek();if(!editor.hidden)loadEditor();}catch(error){status.textContent=errorText(error);}finally{setBusy(false);}});
venue.addEventListener('change',()=>{renderWeek();if(venue.value!==selectedVenue)currentVenue.textContent='Save this venue choice before creating classes.';});
$('#venue-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!isMondayDate(week.value)||!venues.some(v=>v.id===venue.value))return;setBusy(true);
 try{const result=await supabase.rpc('set_class_week_venue',{p_week_start:week.value,p_location_id:venue.value});if(result.error)throw result.error;await loadWeek();status.textContent='Weekly venue saved.';}
 catch(error){status.textContent=errorText(error);}finally{setBusy(false);}
});
$('#dates-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy)return;
 const dates=[...datesContainer.querySelectorAll('input:checked:not(:disabled)')].map(n=>n.value);
 if(!selectedVenue||venue.value!==selectedVenue||!isMondayDate(week.value)||!dates.length){datedStatus.textContent='Save a weekly venue and select confirmed open dates.';return;}
 setBusy(true);
 try{const result=await supabase.rpc('create_reviewed_dated_classes',{p_week_start:week.value,p_open_dates:dates,p_schedule_revision:schedule.revision});if(result.error)throw result.error;await loadSchedule();await loadWeek();if(!editor.hidden)loadEditor();datedStatus.textContent=`${result.data} dated classes created. Review regular seats in Class places. No messages were sent.`;}
 catch(error){datedStatus.textContent=errorText(error);}finally{setBusy(false);}
});
$('#open-editor').addEventListener('click',()=>{if(busy)return;editor.hidden=!editor.hidden;$('#open-editor').setAttribute('aria-expanded',String(!editor.hidden));if(!editor.hidden)loadEditor();});
$('#close-editor').addEventListener('click',()=>{editor.hidden=true;$('#open-editor').setAttribute('aria-expanded','false');$('#open-editor').focus();});
template.addEventListener('change',loadEditor);day.addEventListener('change',updateEffective);
$('#weekly-class-form').addEventListener('submit',async event=>{
 event.preventDefault();if(busy||!event.target.reportValidity())return;
 const old=schedule.classes.find(row=>row.id===template.value);const group=level.value==='intro'?null:level.value;
 const groupName=level.selectedOptions[0].textContent;
 if(!confirm(`${old?'Revise':'Add'} ${weekdays[Number(day.value)-1]} ${clock(time.value)} · ${groupName} from ${effective.value}? Existing dated classes and seats will stay unchanged.${old?' Regular assignments will follow the revised class; athlete skill groups will stay unchanged.':''}`))return;
 const payload={p_slot_id:old?.id??null,p_revision:old?.revision??null,p_effective_from:effective.value,p_iso_weekday:Number(day.value),p_local_start_time:time.value,p_duration_minutes:Number(duration.value),p_capacity:Number(capacity.value),p_class_kind:group?'skill_group':'intro',p_group_id:group};
 setBusy(true);editorStatus.textContent='Saving weekly class…';
 try{const result=await supabase.rpc('save_weekly_class',payload);if(result.error)throw result.error;await loadSchedule();template.value=result.data;await loadWeek();loadEditor();editorStatus.textContent='Weekly class saved. Existing dated classes are unchanged. Review the week and create confirmed open dates when ready.';}
 catch(error){editorStatus.textContent=errorText(error);}finally{setBusy(false);}
});
$('#sign-out').addEventListener('click',async()=>{if(busy)return;$('#sign-out').disabled=true;const result=await supabase.auth.signOut();if(result.error){$('#sign-out').disabled=false;status.textContent='Could not sign out.';return;}location.replace('/auth/sign-in.html');});
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
async function start(){
 if(!configured){status.textContent='Coach portal setup is in progress.';return;}
 const auth=await supabase.auth.getUser();if(auth.error||!auth.data.user){location.replace('/auth/sign-in.html');return;}
 const coach=await supabase.from('coach_users').select('user_id').eq('user_id',auth.data.user.id).maybeSingle();if(coach.error)throw coach.error;if(!coach.data){status.textContent='This account does not have coach access.';return;}
 const [v,g]=await Promise.all([supabase.from('class_locations').select('id,display_name,time_zone',{count:'exact'}).order('display_name'),supabase.from('skill_groups').select('id,name',{count:'exact'}).eq('is_active',true).order('name')]);
 for(const result of [v,g])if(result.error||result.count>result.data.length)throw result.error??new Error('reference data');
 venues=v.data;for(const item of venues)venue.append(option(item.id,`${item.display_name} (${item.time_zone})`));
 for(const item of g.data)level.append(option(item.id,item.name));weekdays.forEach((label,index)=>day.append(option(String(index+1),label)));
 await loadSchedule();week.value=currentOrNextMondayChicago();await loadWeek();content.hidden=false;$('#sign-out').hidden=false;
 if(!venues.length)status.textContent='No venues available yet. Ask the program owner to add them.';
}
start().catch(error=>{status.textContent=errorText(error);});
