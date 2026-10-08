const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function renderProgressReportNotification(payload) {
  if (!UUID.test(payload.reportId) || !UUID.test(payload.parentId) ||
      !Number.isSafeInteger(payload.publication) || payload.publication < 1 ||
      !EMAIL.test(payload.from ?? '') || !EMAIL.test(payload.to ?? '')) throw new Error('Invalid report notification');
  const portal = new URL(payload.portalUrl);
  if (portal.protocol !== 'https:' || portal.username || portal.password || portal.port ||
      portal.pathname !== '/parent/reports.html' || portal.search || portal.hash) throw new Error('Invalid portal URL');
  // No athlete names, report text, PDFs or file links leave the private portal.
  const href = portal.href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  return {
    subject: 'New progress report | New Vision Athletics',
    text: `Coach Emery has published a progress report in your parent portal.\n\nView progress reports: ${portal.href}\nSign in with your linked parent email if prompted, then open Progress reports.`,
    html: `<h1>A progress report is available</h1><p>Coach Emery has published a progress report in your parent portal.</p><p><a href="${href}">View progress reports</a></p><p>Sign in with your linked parent email if prompted, then open Progress reports.</p>`,
  };
}
