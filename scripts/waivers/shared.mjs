export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
export function statusLabel(value) {
  return value === 'completed' ? 'Completed' : value === 'needs_signing' ? 'Needs signing' : 'Setup pending';
}
export async function loadWaiverStatuses(client) {
  const result = await client.rpc('list_athlete_waiver_statuses', {}, {count:'exact'});
  if (result.error || !Array.isArray(result.data) || result.count > result.data.length) {
    throw new Error('Could not load all waiver statuses. Please reload.');
  }
  return result.data;
}
export async function loadSignedWaiver(client, id) {
  const result = await client.from('athlete_waiver_signatures').select('*').eq('id',id).single();
  if (result.error || !result.data) throw new Error('This signed waiver is no longer available to this account.');
  return result.data;
}
export function signedWhen(value) {
  return new Intl.DateTimeFormat('en-US', {dateStyle:'long',timeStyle:'short',timeZone:'America/Chicago'})
    .format(new Date(value)) + ' (Minot time)';
}
export function dateOnly(value) {
  return new Intl.DateTimeFormat('en-US', {dateStyle:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
}
export function waiverText(version, container) {
  container.replaceChildren(node('p',version.company_name,'waiver-company'),node('h2',version.title));
  container.append(node('div',version.body,'waiver-wording'),node('h3','Acknowledgment and Signature'),node('p',version.acknowledgment));
}
export function signedRecord(record, container) {
  container.replaceChildren(node('p',record.document.company_name,'waiver-company'),node('h2',record.document.title));
  const participant = node('dl',undefined,'waiver-facts');
  for (const [label,value] of [['Participant',record.participant_name],['Date of birth',dateOnly(record.date_of_birth)],
    ['Parent / legal guardian',record.guardian_name],['Emergency contact',record.emergency_contact],['Emergency phone',record.emergency_phone]]) {
    participant.append(node('dt',label),node('dd',value));
  }
  container.append(participant,node('div',record.document.body,'waiver-wording'),
    node('h3','Acknowledgment and Signature'),node('p',record.document.acknowledgment));
  const evidence = node('dl',undefined,'waiver-facts');
  for (const [label,value] of [['Electronic signature',record.signature_name],['Signed',signedWhen(record.signed_at)],
    ['Verified sign-in email',record.signer_email],['Waiver version',record.document.version_label],['Record ID',record.id]]) {
    evidence.append(node('dt',label),node('dd',value));
  }
  container.append(evidence,node('h3','Electronic signature consent'),node('p',record.document.electronic_consent),
    node('p','Acknowledgment accepted · Electronic signature consent accepted','waiver-evidence'));
  container.hidden=false;
}
