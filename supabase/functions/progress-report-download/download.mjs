const bucket = 'athlete-progress-reports';
const maximumBytes = 10 * 1024 * 1024;
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const idPattern = new RegExp(`^${uuid}$`, 'i');
const pathPattern = new RegExp(`^${uuid}/${uuid}\\.pdf$`, 'i');
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

// The caller's existing report-file RLS is the authorization boundary. Only
// after that check may the server fetch bytes with its privileged Storage client.
export async function downloadReport(request, { caller, admin, userId }) {
  const respond = (status, code) => Response.json({ code }, { status, headers });
  if (request.method !== 'POST') return respond(405, 'method_not_allowed');
  if (!userId) return respond(401, 'sign_in_required');
  let body;
  try {
    if (Number(request.headers.get('Content-Length')) > 1024) return respond(400, 'invalid_request');
    const text = await request.text();
    if (text.length > 1024) return respond(400, 'invalid_request');
    body = JSON.parse(text);
  } catch { return respond(400, 'invalid_request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.file_id !== 'string' ||
      !idPattern.test(body.file_id)) return respond(400, 'invalid_request');

  const permittedFile = () => caller.from('progress_report_files')
    .select('id, object_path, size_bytes').eq('id', body.file_id).maybeSingle();
  try {
    const first = await permittedFile();
    if (first.error) return respond(503, 'access_check_failed');
    if (!first.data) return respond(404, 'report_unavailable');
    const file = first.data;
    if (!pathPattern.test(file.object_path) || !Number.isSafeInteger(Number(file.size_bytes)) ||
        Number(file.size_bytes) < 5 || Number(file.size_bytes) > maximumBytes) {
      return respond(502, 'invalid_pdf');
    }
    // No client-supplied object path, bucket, redirect, or signed URL is used.
    const stored = await admin.storage.from(bucket).download(file.object_path);
    if (stored.error || !stored.data) return respond(502, 'pdf_download_failed');
    const pdf = stored.data;
    if (pdf.size !== Number(file.size_bytes) || pdf.size > maximumBytes ||
        new TextDecoder().decode(await pdf.slice(0, 5).arrayBuffer()) !== '%PDF-') {
      return respond(502, 'invalid_pdf');
    }
    // Access may have been revoked, the report unpublished, or its current file
    // replaced while Storage was fetching. Recheck before returning any bytes.
    const final = await permittedFile();
    if (final.error) return respond(503, 'access_check_failed');
    if (!final.data || final.data.object_path !== file.object_path ||
        Number(final.data.size_bytes) !== Number(file.size_bytes)) {
      return respond(404, 'report_unavailable');
    }
    return new Response(pdf, { headers: {
      ...headers, 'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="progress-report.pdf"',
    } });
  } catch { return respond(503, 'download_unavailable'); }
}
