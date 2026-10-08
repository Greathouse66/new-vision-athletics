import { reportBucket, validatePdf } from './files.mjs';

export async function fetchReportPdf(client, file) {
  if (!file || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(file.object_path)) {
    throw new Error('No report PDF is available.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    // Authenticate every fetch; never return a public or reusable signed URL.
    const result = await client.storage.from(reportBucket).download(file.object_path, {}, {
      cache: 'no-store', signal: controller.signal,
    });
    if (result.error) {
      const status = String(result.error.statusCode ?? result.error.status ?? '');
      const detail = /^[45][0-9]{2}$/.test(status) ? ` (Storage ${status})` : '';
      throw new Error(`Could not open the PDF${detail}. Access may have changed; reload and try again.`);
    }
    if (!(result.data instanceof Blob)) throw new Error('The PDF download did not return a file. Please try again.');
    // Delivery MIME can be application/octet-stream even when the uploaded PDF
    // is valid. Check size and actual PDF bytes, then use PDF MIME locally.
    const pdf = new Blob([result.data], { type: 'application/pdf' });
    await validatePdf(pdf);
    return pdf;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The PDF download timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
