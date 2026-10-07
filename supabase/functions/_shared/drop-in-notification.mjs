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
function notificationDetails(payload, recipientId, link, path, eventId) {
  if (!UUID.test(eventId) || !UUID.test(recipientId) ||
      !EMAIL.test(payload.to ?? "") || !EMAIL.test(payload.from ?? "") ||
      typeof payload.startsAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(payload.startsAt) ||
      !Number.isFinite(Date.parse(payload.startsAt))) throw new Error("Invalid notification record");
  const review = new URL(link);
  if (review.protocol !== "https:" || review.username || review.password || review.port ||
      review.pathname !== path || review.search || review.hash) throw new Error("Invalid portal link");
  const athlete = label(payload.athleteName);
  const group = label(payload.classLabel);
  const location = label(payload.locationName);
  const when = new Intl.DateTimeFormat("en-US", { timeZone: label(payload.timeZone),
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(payload.startsAt));
  return { athlete, group, location, when, review };
}
export function renderDropInNotification(payload) {
  const { athlete, group, location, when, review } = notificationDetails(
    payload, payload.coachId, payload.reviewUrl, "/coach/drop-ins.html", payload.requestId);
  const subject = "New drop-in request | New Vision Athletics";
  const text = `A parent requested a drop-in.\n\nAthlete: ${athlete}\nClass: ${group}\nWhen: ${when}\nVenue: ${location}\n\nReview the request: ${review.href}\nSign in with your coach email if prompted.\n\nThis request does not reserve a place. Approve or decline it in the Coach Dashboard.`;
  const html = `<h1>New drop-in request</h1><p>A parent requested a drop-in.</p><p><strong>Athlete:</strong> ${escape(athlete)}<br><strong>Class:</strong> ${escape(group)}<br><strong>When:</strong> ${escape(when)}<br><strong>Venue:</strong> ${escape(location)}</p><p><a href="${escape(review.href)}">Review drop-in requests</a></p><p>Sign in with your coach email if prompted. This request does not reserve a place. Approve or decline it in the Coach Dashboard.</p>`;
  return { subject, text, html };
}

export function approvalNotificationSettings(env) {
  const { apiKey, from, reviewUrl } = notificationSettings(env);
  return { apiKey, from, portalUrl: new URL("/parent/sessions.html", reviewUrl).href };
}
export function renderDropInApprovalNotification(payload) {
  if (!UUID.test(payload.seatId)) throw new Error("Confirmed place required");
  const { athlete, group, location, when, review } = notificationDetails(
    payload, payload.parentId, payload.portalUrl, "/parent/sessions.html", payload.requestId);
  const subject = "Your drop-in is approved | New Vision Athletics";
  const text = `Your drop-in request has been approved. A place is reserved for your athlete.\n\nAthlete: ${athlete}\nClass: ${group}\nWhen: ${when}\nVenue: ${location}\n\nView upcoming sessions: ${review.href}\nSign in with the parent email you used to request this drop-in if prompted.`;
  const html = `<h1>Your drop-in is approved</h1><p>Your drop-in request has been approved. A place is reserved for your athlete.</p><p><strong>Athlete:</strong> ${escape(athlete)}<br><strong>Class:</strong> ${escape(group)}<br><strong>When:</strong> ${escape(when)}<br><strong>Venue:</strong> ${escape(location)}</p><p><a href="${escape(review.href)}">View upcoming sessions</a></p><p>Sign in with the parent email you used to request this drop-in if prompted.</p>`;
  return { subject, text, html };
}

export function renderParentCancellationNotification(payload) {
  if (!["regular", "drop_in"].includes(payload.seatKind) ||
      typeof payload.cancelledAt !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(payload.cancelledAt) ||
      !Number.isFinite(Date.parse(payload.cancelledAt))) throw new Error("Invalid cancellation record");
  const { athlete, group, location, when, review } = notificationDetails(
    payload, payload.coachId, payload.reviewUrl, "/coach/cancellations.html", payload.seatId);
  const cancelled = new Intl.DateTimeFormat("en-US", { timeZone: payload.timeZone,
    weekday: "long", month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(payload.cancelledAt));
  const kind = payload.seatKind === "regular" ? "Regular session" : "Drop-in";
  const note = payload.seatKind === "regular"
    ? "Only this dated session was cancelled. The regular weekly assignment remains active."
    : "This dated drop-in place was cancelled.";
  const subject = "Parent cancelled a session | New Vision Athletics";
  const text = `A parent cancelled an athlete's session.\n\nAthlete: ${athlete}\nClass: ${group}\nWhen: ${when}\nVenue: ${location}\nBooking: ${kind}\nCancelled: ${cancelled}\n\n${note}\nReview any makeup eligibility separately.\n\nView parent cancellations: ${review.href}\nSign in with your coach email if prompted.`;
  const html = `<h1>Parent cancelled a session</h1><p>A parent cancelled an athlete's session.</p><p><strong>Athlete:</strong> ${escape(athlete)}<br><strong>Class:</strong> ${escape(group)}<br><strong>When:</strong> ${escape(when)}<br><strong>Venue:</strong> ${escape(location)}<br><strong>Booking:</strong> ${kind}<br><strong>Cancelled:</strong> ${escape(cancelled)}</p><p>${note} Review any makeup eligibility separately.</p><p><a href="${escape(review.href)}">View parent cancellations</a></p><p>Sign in with your coach email if prompted.</p>`;
  return { subject, text, html };
}
