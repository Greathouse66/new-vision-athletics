import { reportBucket, validatePdf } from './files.mjs';

export async function fetchReportPdf(client, file, config, send = fetch) {
  if (!file || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(file.object_path)) {
    throw new Error('No report PDF is available.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const auth = await client.auth.getSession();
    const token = auth.data?.session?.access_token;
    if (auth.error || !token) throw new Error('Your sign-in session has ended. Please sign in again.');
    // Use the explicit private endpoint, with the current session token in a
    // header only. A fresh cache nonce avoids reusing an earlier denied response.
    const path = file.object_path.split('/').map(encodeURIComponent).join('/');
    const url = new URL(`/storage/v1/object/authenticated/${reportBucket}/${path}`, config.url);
    url.searchParams.set('cacheNonce', crypto.randomUUID());
    const response = await send(url.href, {
      method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { apikey: config.key, Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      let code = '';
      try {
        const body = await response.json();
        const known = new Set(['NoSuchKey','NoSuchBucket','InvalidJWT','AccessDenied','not_found','unauthorized']);
        const candidate = body.code ?? body.error;
        if (known.has(candidate)) code = `; ${candidate}`;
      } catch { /* Provider body may be HTML. Do not display it or private details. */ }
      throw new Error(`Could not open the PDF (Storage ${response.status}${code}). Access may have changed; reload and try again.`);
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
