import { configured, supabase } from '../auth/client.js';
import { node, statusLabel, loadWaiverStatuses, loadSignedWaiver, signedWhen, waiverText, signedRecord } from './shared.mjs';

export async function startWaivers(role) {
  const parent = role === 'parent';
  const status = document.querySelector('#status'), content = document.querySelector('#waiver-content');
  const selector = document.querySelector('#athlete'), filter = document.querySelector('#status-filter');
  const list = document.querySelector('#waiver-list'), summary = document.querySelector('#waiver-summary');
  const form = document.querySelector('#waiver-form'), recordPanel = document.querySelector('#signed-record');
  const empty = document.querySelector('#waiver-empty'), print = document.querySelector('#print-waiver');
  const history = document.querySelector('#waiver-history'), historyList = document.querySelector('#waiver-history-list');
  const signOut = document.querySelector('#sign-out');
  let rows = [], version = null, busy = false, recordId = null;
  const message = text => { status.textContent = text; };
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('button,input,select').forEach(control => { control.disabled = value; });
  }
  function clearDetail() {
    if (form) { form.hidden = true; form.reset(); }
    recordPanel.replaceChildren(); recordPanel.hidden = true; recordId = null;
    print.hidden = true; history.hidden = true; historyList.replaceChildren();
    empty.hidden = false;
  }
  function clearPrivate() {
    content.hidden = true; clearDetail(); list.replaceChildren(); rows = [];
  }
  function errorText(error) {
    if (error.code === '40001') return 'The waiver version changed. Reload and read the current waiver before signing.';
    if (error.code === '55000') return 'This waiver is already completed. Reload to view the saved record.';
    if (error.code === '42501') return 'Your athlete access changed or your email is unverified. Reload and sign in again.';
    if (error.code === '22023') return 'Check all fields, match your signature to the guardian name, and accept both statements.';
    return error.message === 'This signed waiver is no longer available to this account.' ? error.message : 'Could not load or save this waiver. Reload before trying again.';
  }
  function renderList() {
    const completed = rows.filter(row => row.waiver_status === 'completed').length;
    const needs = rows.filter(row => !row.archived_at && row.waiver_status === 'needs_signing').length;
    const pending = rows.filter(row => !row.archived_at && row.waiver_status === 'not_configured').length;
    summary.textContent = `${completed} completed · ${needs} need signing${pending ? ` · ${pending} setup pending` : ''}`;
    list.replaceChildren();
    const visible = rows.filter(row => filter.value === 'all' ||
      (row.waiver_status === filter.value && (filter.value === 'completed' || !row.archived_at)));
    for (const row of visible) {
      const card = node('article', undefined, 'waiver-card');
      card.append(node('h2', row.athlete_name + (row.archived_at ? ' · Archived' : '')), node('span', row.archived_at && row.waiver_status !== 'completed' ? 'Archived · Current waiver unsigned' : statusLabel(row.waiver_status), `waiver-badge ${row.waiver_status}`));
      if (row.signed_at) card.append(node('p', `Signed ${signedWhen(row.signed_at)}`));
      const button = node('button', row.waiver_status === 'completed' ? 'View completed waiver' : parent ? 'Open athlete waiver' : 'View status', 'secondary');
      button.type = 'button';
      button.addEventListener('click', () => { if (!busy) { selector.value = row.athlete_id; openAthlete(); } });
      card.append(button); list.append(card);
    }
    if (!visible.length) list.append(node('p', rows.length ? 'No athletes match this filter.' : parent ? 'No linked athletes yet. Accept parent access on My athletes first.' : 'No athletes on the roster yet.', 'waiver-panel'));
  }
  async function refreshRows() {
    rows = await loadWaiverStatuses(supabase);
    const previous = selector.value;
    selector.replaceChildren(node('option', 'Choose an athlete'));
    selector.firstElementChild.value = '';
    for (const row of rows) { const option = node('option', row.athlete_name + (row.archived_at ? ' · Archived' : '')); option.value = row.athlete_id; selector.append(option); }
    if (rows.some(row => row.athlete_id === previous)) selector.value = previous;
    renderList();
  }
  async function showRecord(id) {
    recordPanel.hidden = true; recordPanel.replaceChildren(); print.hidden = true; recordId = null;
    const record = await loadSignedWaiver(supabase,id);
    // Ignore a stale response if the selected athlete changed.
    if (record.athlete_id !== selector.value) return;
    signedRecord(record,recordPanel); recordId = record.id; print.hidden = false;
  }
  async function openAthlete() {
    if (busy) return;
    clearDetail();
    const row = rows.find(entry => entry.athlete_id === selector.value);
    if (!row) { message(''); return; }
    setBusy(true); message('Loading athlete waiver…');
    try {
      const result = await supabase.from('athlete_waiver_signatures').select('id,athlete_id,signed_at,document', {count:'exact'})
        .eq('athlete_id',row.athlete_id).order('signed_at',{ascending:false});
      if (result.error || result.count > result.data.length) throw new Error('Could not load waiver history.');
      empty.hidden = true;
      if (row.signature_id) await showRecord(row.signature_id);
      else if (parent && version && row.waiver_version_id === version.id) {
        document.querySelector('#participant-name').textContent = `Participant: ${row.athlete_name}`;
        waiverText(version,document.querySelector('#waiver-terms'));
        document.querySelector('#electronic-consent-text').textContent = version.electronic_consent;
        const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
        const part = type => parts.find(item => item.type === type).value;
        form.elements.date_of_birth.max = `${part('year')}-${part('month')}-${part('day')}`;
        form.hidden = false;
      } else {
        empty.textContent = row.waiver_status === 'not_configured' ? 'The waiver is not configured yet. Please contact the coach.' : 'This athlete needs a waiver. Their linked parent or legal guardian can sign it from the parent portal.';
        empty.hidden = false;
      }
      for (const record of result.data) {
        const button = node('button', `${record.document.version_label} · ${signedWhen(record.signed_at)}`, 'secondary');
        button.type = 'button';
        button.addEventListener('click', async () => {
          if (busy) return; setBusy(true); message('Loading signed copy…');
          try { await showRecord(record.id); message(''); }
          catch (error) { message(errorText(error)); }
          finally { setBusy(false); }
        });
        historyList.append(button);
      }
      history.hidden = !result.data.length;
      message('');
    } catch (error) { clearDetail(); message(errorText(error)); }
    finally { setBusy(false); }
  }
  selector.addEventListener('change', openAthlete);
  filter.addEventListener('change', renderList);
  if (form) form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || !version || !form.reportValidity()) return;
    const row = rows.find(entry => entry.athlete_id === selector.value);
    if (!row || row.waiver_status !== 'needs_signing') return;
    const fields = form.elements;
    if (fields.signature_name.value.trim().toLowerCase() !== fields.guardian_name.value.trim().toLowerCase()) {
      message('Your electronic signature must match the parent / legal guardian name.'); fields.signature_name.focus(); return;
    }
    setBusy(true); message('Saving your signed waiver…');
    try {
      const result = await supabase.rpc('sign_athlete_waiver', {
        p_athlete_id:row.athlete_id,p_waiver_version_id:version.id,p_date_of_birth:fields.date_of_birth.value,
        p_guardian_name:fields.guardian_name.value.trim(),p_emergency_contact:fields.emergency_contact.value.trim(),
        p_emergency_phone:fields.emergency_phone.value.trim(),p_signature_name:fields.signature_name.value.trim(),
        p_acknowledgment_accepted:fields.acknowledgment.checked,p_electronic_consent_accepted:fields.electronic_consent.checked,
      });
      if (result.error) throw result.error;
      form.reset(); form.hidden = true;
      await refreshRows(); await showRecord(result.data);
      message('Waiver completed for this athlete. A copy is available below and in the coach portal.');
    } catch (error) { message(errorText(error)); }
    finally { setBusy(false); }
  });
  print.addEventListener('click', async () => {
    if (busy || !recordId) return;
    const id = recordId; setBusy(true); message('Checking access to your signed copy…');
    try { await showRecord(id); if (recordId) { message(''); window.print(); } }
    catch (error) { recordPanel.replaceChildren(); recordPanel.hidden = true; print.hidden = true; recordId = null; message(errorText(error)); }
    finally { setBusy(false); }
  });
  signOut.addEventListener('click', async () => {
    if (busy) return;
    signOut.disabled = true;
    const result = await supabase.auth.signOut();
    if (result.error) { signOut.disabled = false; message('Could not sign out.'); return; }
    clearPrivate(); location.replace('/auth/sign-in.html');
  });
  window.addEventListener('beforeunload', event => { if (busy) { event.preventDefault(); event.returnValue = ''; } });
  try {
    if (!configured) { message('Waiver setup is in progress.'); return; }
    const auth = await supabase.auth.getUser();
    if (auth.error || !auth.data.user) { location.replace('/auth/sign-in.html'); return; }
    if (!parent) {
      const coach = await supabase.from('coach_users').select('user_id').eq('user_id',auth.data.user.id).maybeSingle();
      if (coach.error) throw coach.error;
      if (!coach.data) { message('This account does not have coach access.'); return; }
    }
    signOut.hidden = false;
    await refreshRows();
    if (parent && rows.length) {
      const result = await supabase.from('waiver_versions').select('id,version_label,company_name,title,body,acknowledgment,electronic_consent').eq('is_current',true).maybeSingle();
      if (result.error) throw result.error;
      version = result.data;
    }
    content.hidden = false; message('');
    const requested = new URLSearchParams(location.search).get('athlete');
    if (rows.some(row => row.athlete_id === requested)) { selector.value = requested; await openAthlete(); }
    supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') { clearPrivate(); location.replace('/auth/sign-in.html'); }
    });
  } catch (error) { clearPrivate(); message(errorText(error)); }
}
