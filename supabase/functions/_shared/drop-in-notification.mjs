const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const escape = (value) => value.replace(/[&<>"']/g, (char) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function label(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 160) throw new Error("Invalid notification label");
  return value.trim();
}
export function notificationSettings(env) {
  const apiKey = env("RESEND_API_KEY");
  const from = env("NVA_NOTIFICATION_FROM") || env("NVA_RECEIPT_FROM");
  const origin = new URL(env("NVA_PUBLIC_ORIGIN"));
  if (!apiKey || !EMAIL.test(from ?? "") || origin.protocol !== "https:" || origin.username ||
      origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("Notification sender unavailable");
  }
  return { apiKey, from, reviewUrl: new URL("/coach/drop-ins.html", origin).href };
}
export function renderDropInNotification(payload) {
  if (!UUID.test(payload.requestId) || !UUID.test(payload.coachId) ||
      !EMAIL.test(payload.to ?? "") || !EMAIL.test(payload.from ?? "") ||
      typeof payload.startsAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(payload.startsAt) ||
      !Number.isFinite(Date.parse(payload.startsAt))) throw new Error("Invalid notification record");
  const review = new URL(payload.reviewUrl);
  if (review.protocol !== "https:" || review.username || review.password || review.port ||
      review.pathname !== "/coach/drop-ins.html" || review.search || review.hash) throw new Error("Invalid review link");
  const athlete = label(payload.athleteName);
  const group = label(payload.classLabel);
  const location = label(payload.locationName);
  const when = new Intl.DateTimeFormat("en-US", { timeZone: payload.timeZone,
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(payload.startsAt));
  const subject = "New drop-in request | New Vision Athletics";
  const text = `A parent requested a drop-in.\n\nAthlete: ${athlete}\nClass: ${group}\nWhen: ${when}\nVenue: ${location}\n\nReview the request: ${review.href}\nSign in with your coach email if prompted.\n\nThis request does not reserve a place. Approve or decline it in the Coach Dashboard.`;
  const html = `<h1>New drop-in request</h1><p>A parent requested a drop-in.</p><p><strong>Athlete:</strong> ${escape(athlete)}<br><strong>Class:</strong> ${escape(group)}<br><strong>When:</strong> ${escape(when)}<br><strong>Venue:</strong> ${escape(location)}</p><p><a href="${escape(review.href)}">Review drop-in requests</a></p><p>Sign in with your coach email if prompted. This request does not reserve a place. Approve or decline it in the Coach Dashboard.</p>`;
  return { subject, text, html };
}
