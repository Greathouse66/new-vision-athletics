import { downloadName } from './files.mjs';
import { fetchReportPdf } from './download.mjs';
export const pageSize = 50;
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function reportFeedback(report, text, error = false) {
  const feedback = document.querySelector(`[data-report-id="${report.id}"] .report-feedback`);
  if (!feedback) return;
  feedback.textContent = text;
  feedback.dataset.error = String(error);
  if (error) feedback.scrollIntoView({block:'nearest'});
}
export function reportDate(value) {
  return new Intl.DateTimeFormat('en-US', {month:'long',day:'numeric',year:'numeric',timeZone:'UTC'})
    .format(new Date(`${value}T12:00:00Z`));
}
export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get = key => parts.find(p=>p.type===key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export async function loadAthletes(client, parentId) {
  let query = client.from('athletes').select('id, display_name, family_id', {count:'exact'}).order('display_name').order('id');
  if (parentId) {
    const grants = await client.from('family_guardians').select('family_id', {count:'exact'}).eq('user_id',parentId);
    if (grants.error || grants.count > grants.data.length) throw new Error('Could not load parent access.');
    if (!grants.data.length) return [];
    query = query.in('family_id',[...new Set(grants.data.map(g=>g.family_id))]);
  }
  const result = await query.range(0,999);
  if (result.error || result.count > result.data.length) throw new Error('Could not load the full athlete list.');
  return result.data;
}
export async function loadReports(client, athleteId, offset = 0, publishedOnly = false) {
  let query = client.from('progress_reports')
    .select('id, athlete_id, title, report_date, coach_note, status, current_file_id, revision, publication, published_at', {count:'exact'})
    .eq('athlete_id',athleteId);
  if (publishedOnly) query = query.eq('status','published');
  const result = await query.order('report_date',{ascending:false}).order('id',{ascending:false})
    .range(offset,offset+pageSize-1);
  if (result.error) throw new Error('Could not load progress reports.');
  const ids = result.data.map(r=>r.current_file_id).filter(Boolean);
  const files = ids.length ? await client.from('progress_report_files')
    .select('id, object_path, original_name, size_bytes').in('id',ids) : {data:[],error:null};
  if (files.error) throw new Error('Could not load report files.');
  const byId = new Map(files.data.map(f=>[f.id,f]));
  return {rows:result.data.map(r=>({...r,file:byId.get(r.current_file_id)})),total:result.count};
}
export async function loadReport(client, id) {
  const result = await client.from('progress_reports').select('*').eq('id',id).single();
  if (result.error) throw new Error('Could not reload the saved draft.');
  const file = result.data.current_file_id ? await client.from('progress_report_files')
    .select('id, object_path, original_name, size_bytes').eq('id',result.data.current_file_id).single()
    : {data:null,error:null};
  if (file.error) throw new Error('Could not reload the saved PDF.');
  return {...result.data,file:file.data};
}
let viewerUrl = null;
export function closePdf() {
  const viewer = document.querySelector('#pdf-viewer');
  if (!viewer) return;
  viewer.close();
  viewer.querySelector('iframe').removeAttribute('src');
  viewer.querySelector('#pdf-download').removeAttribute('href');
  if (viewerUrl) URL.revokeObjectURL(viewerUrl);
  viewerUrl = null;
}
export function setupPdfViewer() {
  const viewer = document.querySelector('#pdf-viewer');
  viewer.querySelector('#pdf-close').addEventListener('click',closePdf);
  viewer.addEventListener('cancel',event=>{event.preventDefault();closePdf()});
  window.addEventListener('pagehide',closePdf);
}
export async function openPdf(client, file, title, download = false) {
  const blob = await fetchReportPdf(client, file);
  closePdf();
  if (download) {
    const url = URL.createObjectURL(blob), link = element('a');
    link.href=url;link.download=downloadName(file.original_name);
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    return;
  }
  viewerUrl = URL.createObjectURL(blob);
  const viewer = document.querySelector('#pdf-viewer');
  viewer.querySelector('#pdf-heading').textContent=title;
  viewer.querySelector('iframe').src=viewerUrl;
  const link=viewer.querySelector('#pdf-download');
  link.href=viewerUrl;link.download=downloadName(file.original_name);
  viewer.showModal();
}
