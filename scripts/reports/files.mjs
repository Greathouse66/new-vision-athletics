export const reportBucket = 'athlete-progress-reports';
export const maxReportBytes = 10 * 1024 * 1024;
export async function validatePdf(file) {
  if (!file || file.size < 5 || file.size > maxReportBytes) throw new Error('Choose a PDF up to 10 MB.');
  if (file.type && file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
  const prefix = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (prefix !== '%PDF-') throw new Error('This file does not appear to be a PDF. Export the report as PDF and try again.');
}
export function downloadName(name) {
  const safe = String(name ?? 'progress-report.pdf').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-').slice(0, 180).trim();
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe || 'progress-report'}.pdf`;
}
