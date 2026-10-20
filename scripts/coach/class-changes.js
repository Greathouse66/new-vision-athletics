export function classChanges({ supabase, content, isBusy, lock, refresh }) {
  const $ = id => document.getElementById(id);
  const editor=$('class-change-editor'),form=$('class-change-form'),message=$('change-status');
  const action=$('change-action'),venue=$('change-location'),start=$('change-start'),duration=$('change-duration'),reason=$('change-reason');
  let selected=null,venues=[],review=null,proposed=null,generation=0;
  const when=(instant,zone)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,dateStyle:'full',timeStyle:'short'}).format(new Date(instant));
  const local=(instant,zone)=>{
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
    return parts.year+'-'+parts.month+'-'+parts.day+'T'+parts.hour+':'+parts.minute;
  };
  function invalidate(){review=null;proposed=null;$('change-review').hidden=true;$('save-class-change').hidden=true;}
  function restore(){
    $('change-time-fields').hidden=action.value==='closed';
    $('change-time-fields').disabled=action.value==='closed'||isBusy();
    const editable=selected&&!selected.closed_at&&Date.parse(selected.starts_at)>Date.now();
    for(const el of form.querySelectorAll('input,select,textarea,button'))el.disabled=isBusy()||!editable||(action.value==='closed'&&el.closest('fieldset'));
    $('save-class-change').disabled=isBusy()||!editable||!review;
    $('change-zone').textContent='Local times at this venue: '+(venues.find(v=>v.id===venue.value)?.time_zone??'Choose a venue');
  }
  function errorText(error){
    if(error.code==='40001')return 'The class, roster or parent contacts changed. Review again before saving.';
    if(error.code==='42501')return 'Coach access changed. Reload and sign in again.';
    if(['22023','23514','55000'].includes(error.code))return error.message;
    return 'Could not complete this request. Reload the class and check its history before trying again.';
  }
  async function history(){
    if(!selected)return;
    const id=selected.id;
    const result=await supabase.rpc('list_coach_class_changes',{p_occurrence_id:id});
    if(result.error)throw result.error;
    if(selected?.id!==id)return;
    $('change-history').replaceChildren();
    for(const row of result.data){
      const item=document.createElement('li');
      const counts=Object.entries(row.delivery_counts).map(([state,n])=>n+' '+state).join(', ')||'No verified email recipients';
      item.textContent=(row.action==='closed'?'Class closed':'Class rescheduled')+' · '+row.reason+' · '+when(row.changed_at,row.after_details.time_zone)+' · Email: '+counts;
      $('change-history').append(item);
    }
    if(!result.data.length){const item=document.createElement('li');item.textContent='No saved changes yet.';$('change-history').append(item);}
    if(result.data.length>200)message.textContent='Showing the latest changes. Contact the program owner if you need older history.';
  }
  async function open(row,locations){
    if(isBusy())return;
    const request=++generation;selected=row;venues=locations;invalidate();editor.hidden=false;message.textContent='Loading class details…';lock(true);
    try{
      const response=await supabase.rpc('review_coach_class_change',{p_occurrence_id:row.id});
      if(response.error)throw response.error;if(request!==generation)return;
      const data=response.data;selected=data.occurrence;
      $('change-current').textContent=data.class_label+' · '+when(selected.starts_at,data.time_zone)+' · '+data.location_name+(selected.closed_at?' · CLOSED':'')+' · Original roster date: '+selected.class_date;
      venue.replaceChildren();
      for(const v of venues){const o=document.createElement('option');o.value=v.id;o.textContent=v.display_name+' ('+v.time_zone+')';venue.append(o);}
      venue.value=selected.location_id;start.value=local(selected.starts_at,data.time_zone);
      duration.value=String(Math.round((Date.parse(selected.ends_at)-Date.parse(selected.starts_at))/60000));
      action.value='rescheduled';reason.value='';await history();
      message.textContent=selected.closed_at?'This class is closed. Its history is retained.':Date.parse(selected.starts_at)<=Date.now()?'This class has started. Its schedule can no longer be changed here.':'';
      $('change-heading').focus();editor.scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){selected=null;message.textContent=errorText(error);}
    finally{lock(false);restore();}
  }
  form.addEventListener('input',()=>{invalidate();restore();});
  venue.addEventListener('change',()=>{invalidate();restore();});
  action.addEventListener('change',()=>{invalidate();restore();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(isBusy()||!selected||!form.reportValidity())return;invalidate();lock(true);
    try{
      const response=await supabase.rpc('review_coach_class_change',{p_occurrence_id:selected.id});if(response.error)throw response.error;
      const data=response.data;selected=data.occurrence;
      if(selected.closed_at||Date.parse(selected.starts_at)<=Date.now())throw {code:'55000',message:'This class is closed or has started. Reload the class.'};
      proposed={p_occurrence_id:selected.id,p_review_token:data.review_token,p_action:action.value,p_reason:reason.value.trim(),
        p_location_id:action.value==='closed'?null:venue.value,p_local_start:action.value==='closed'?null:start.value,
        p_duration_minutes:action.value==='closed'?null:Number(duration.value)};
      const box=$('change-review');box.replaceChildren();
      const p=document.createElement('p');p.textContent='Currently: '+data.class_label+' · '+when(selected.starts_at,data.time_zone)+' · '+data.location_name;box.append(p);
      const change=document.createElement('p');const v=venues.find(v=>v.id===venue.value);
      change.textContent=action.value==='closed'?'Close this class, cancel its confirmed places and decline pending drop-in requests.':
        'New: '+start.value.replace('T',' at ')+' · '+duration.value+' min · '+v.display_name+' · '+v.time_zone+'. Confirmed places and pending requests stay attached.';
      box.append(change);
      const note=document.createElement('p');note.textContent='Reason: '+proposed.p_reason;box.append(note);
      const list=document.createElement('ul');for(const a of data.athletes){const li=document.createElement('li');li.textContent=a.name+' · '+(a.booking_kind==='confirmed'?'Confirmed place':'Pending drop-in')+(a.has_email?'':' · No verified parent email — contact directly');list.append(li);}box.append(list);
      const count=document.createElement('p');count.textContent=data.athletes.length+' affected athlete(s) · '+data.email_count+' parent email(s) will be queued · '+data.missing_contact_count+' athlete(s) need direct contact. Makeup and refund decisions remain separate.';box.append(count);
      if(data.missing_contact_count)count.setAttribute('role','alert');
      review=data;box.hidden=false;$('save-class-change').hidden=false;message.textContent='Review the details above, then confirm to save and queue parent emails.';
    }catch(error){invalidate();message.textContent=errorText(error);}
    finally{lock(false);restore();}
  });
  $('save-class-change').addEventListener('click',async()=>{
    if(isBusy()||!review||!proposed)return;
    lock(true);message.textContent='Saving class change…';
    try{
      const response=await supabase.rpc('save_coach_class_change',proposed);if(response.error)throw response.error;
      const result=response.data;invalidate();
      try{await refresh();}catch{editor.hidden=true;document.getElementById('status').textContent='Class change saved and emails queued, but this list could not refresh. Reload and check the class history before making another change.';return;}
      editor.hidden=true;document.getElementById('status').textContent=(result.action==='closed'?'Class closed. ':'Class rescheduled. ')+result.queued_emails+' parent email(s) queued. '+result.missing_contact_count+' athlete(s) need direct contact. Reopen the class to check delivery status.';
    }catch(error){invalidate();message.textContent=errorText(error);}
    finally{lock(false);restore();}
  });
  $('cancel-class-change').addEventListener('click',()=>{if(isBusy())return;generation++;editor.hidden=true;invalidate();});
  $('refresh-change-history').addEventListener('click',async()=>{if(isBusy())return;lock(true);try{await history();message.textContent='Delivery status refreshed. Sent means accepted by the email provider; review or skipped emails may need direct follow-up.';}catch(error){message.textContent=errorText(error);}finally{lock(false);restore();}});
  return { open, close(){generation++;selected=null;invalidate();editor.hidden=true;}, restore };
}
