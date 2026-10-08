import { validatePdf } from './files.mjs';

export async function fetchReportPdf(client, file, config, send = fetch) {
  if (!file || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(file.id)) {
    throw new Error('No report PDF is available.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const auth = await client.auth.getSession();
    const token = auth.data?.session?.access_token;
    if (auth.error || !token) throw new Error('Your sign-in session has ended. Please sign in again.');
    // The server rechecks current report-file access before returning bytes.
    // The user token is sent in a header; only the file ID enters the JSON body.
    const url = new URL('/functions/v1/progress-report-download', config.url);
    const response = await send(url.href, {
      method: 'POST', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { apikey: config.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: file.id }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let code = '';
      try {
        const body = await response.json();
        const known = new Set(['sign_in_required','report_unavailable','access_check_failed','pdf_download_failed','invalid_pdf','download_unavailable']);
        const candidate = body.code ?? body.error;
        if (known.has(candidate)) code = `; ${candidate}`;
      } catch { /* Provider body may be HTML. Do not display it or private details. */ }
      throw new Error(`Could not open the PDF (Download ${response.status}${code}). Please reload and try again.`);
    }
    const data = await response.blob();
    // Delivery MIME can be application/octet-stream even when the uploaded PDF
    // is valid. Check size and actual PDF bytes, then use PDF MIME locally.
    const pdf = new Blob([data], { type: 'application/pdf' });
    await validatePdf(pdf);
    return pdf;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The PDF download timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
