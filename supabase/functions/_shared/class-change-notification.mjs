const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function label(value,max=160){if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Invalid class change label');return value.trim();}
function instant(value){if(typeof value!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('Invalid class time');return new Date(value);}
function details(row){
  const when=new Intl.DateTimeFormat('en-US',{timeZone:label(row.time_zone),weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(instant(row.starts_at));
  const end=new Intl.DateTimeFormat('en-US',{timeZone:row.time_zone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(instant(row.ends_at));
  if(Date.parse(row.ends_at)<=Date.parse(row.starts_at))throw new Error('Invalid class duration');
  return when+' – '+end+' · '+label(row.location_name);
}
export function renderClassChangeNotification(payload){
  if(!UUID.test(payload.changeId)||!UUID.test(payload.parentId)||!EMAIL.test(payload.to??'')||!EMAIL.test(payload.from??'')||
    !['rescheduled','closed'].includes(payload.action)||!Array.isArray(payload.athletes)||!payload.athletes.length)throw new Error('Invalid class change');
  const portal=new URL(payload.portalUrl);
  if(portal.protocol!=='https:'||portal.username||portal.password||portal.port||portal.pathname!=='/parent/sessions.html'||portal.search||portal.hash)throw new Error('Invalid parent link');
  const closed=payload.action==='closed',heading=closed?'Your class is cancelled':'Your class has been rescheduled';
  const className=label(payload.classLabel),reason=label(payload.reason,500),before=details(payload.before),after=details(payload.after);
  const names=payload.athletes.map(a=>{if(!['confirmed','pending_request'].includes(a.bookingKind))throw new Error('Invalid booking');return label(a.name)+(a.bookingKind==='pending_request'?' (pending drop-in request)':'');});
  const status=closed?'This dated class will not take place. Its confirmed places are cancelled and pending drop-in requests are closed.':
    'Confirmed places remain reserved at the new time and venue. Pending drop-in requests still need coach approval.';
  const followup='Regular weekly assignments stay in place. Contact your coach about makeup or refund arrangements.';
  const text=heading+'\n\nAthlete(s): '+names.join(', ')+'\nClass: '+className+'\nPreviously: '+before+
    (closed?'':'\nNow: '+after)+'\nReason: '+reason+'\n\n'+status+'\n'+followup+'\n\nView class updates: '+portal.href+'\nSign in with your parent email if prompted.';
  const html='<h1>'+heading+'</h1><p><strong>Athlete(s):</strong> '+names.map(escape).join(', ')+'<br><strong>Class:</strong> '+escape(className)+
    '<br><strong>Previously:</strong> '+escape(before)+(closed?'':'<br><strong>Now:</strong> '+escape(after))+
    '<br><strong>Reason:</strong> '+escape(reason)+'</p><p>'+status+'</p><p>'+followup+'</p><p><a href="'+escape(portal.href)+'">View class updates</a></p><p>Sign in with your parent email if prompted.</p>';
  return {subject:(closed?'Class cancelled':'Class rescheduled')+' | New Vision Athletics',text,html};
}
