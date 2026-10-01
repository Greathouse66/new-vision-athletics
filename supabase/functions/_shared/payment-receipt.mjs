const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;

function cents(value, positive = false) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < (positive ? 1 : 0)) {
    throw new Error("Invalid receipt amount");
  }
  return amount;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
function money(amount) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount / 100);
}
function portalLink(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.pathname !== "/auth/sign-in.html" || url.search || url.hash) {
    throw new Error("Expected the public HTTPS Parent Portal sign-in page");
  }
  return url.href;
}

// Pure formatting only. The sender must independently verify the current,
// coach-approved billing contact captured by the outbox before delivery.
export function renderPaymentReceipt({ paymentId, familyId, amountMinorUnits,
  receivedAt, allocations, portalSignInUrl }) {
  if (!UUID.test(paymentId) || !UUID.test(familyId) ||
      !Array.isArray(allocations) || allocations.length < 1 || allocations.length > 20) {
    throw new Error("Invalid receipt record");
  }
  const amount = cents(amountMinorUnits, true);
  if (typeof receivedAt !== "string" ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(receivedAt) ||
      !Number.isFinite(Date.parse(receivedAt))) {
    throw new Error("Invalid received timestamp");
  }
  const receivedDay = new Date(receivedAt).toLocaleDateString("en-US", {
    timeZone: "UTC", year: "numeric", month: "long", day: "numeric",
  });
  const link = portalLink(portalSignInUrl);
  let allocated = 0;
  const lines = allocations.map((row) => {
    if (row.familyId !== familyId || !UUID.test(row.chargeId) ||
        typeof row.athleteName !== "string" ||
        row.athleteName.trim().length < 1 || row.athleteName.length > 160 ||
        typeof row.serviceMonth !== "string" || !MONTH.test(row.serviceMonth)) {
      throw new Error("Invalid receipt allocation");
    }
    const lineAmount = cents(row.amountMinorUnits, true);
    allocated += lineAmount;
    if (!Number.isSafeInteger(allocated)) throw new Error("Receipt total exceeds safe range");
    const month = new Date(`${row.serviceMonth}T00:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC", year: "numeric", month: "long",
    });
    return { name: row.athleteName.trim(), month, amount: money(lineAmount) };
  });
  if (allocated !== amount) throw new Error("Payment and allocations do not match");

  const subject = "New Vision Athletics payment confirmation";
  const text = [
    "New Vision Athletics confirmed your Venmo payment.",
    `Amount: ${money(amount)}`,
    `Received: ${receivedDay} (UTC)`,
    `Payment ID: ${paymentId}`,
    "",
    "Applied to:",
    ...lines.map((line) => `- ${line.name}, ${line.month} tuition: ${line.amount}`),
    "",
    `Parent Portal sign-in: ${link}`,
    "You can request an email sign-in link there. Portal access requires an approved guardian invitation; this payment email does not grant access.",
    "If any detail looks wrong, please contact New Vision Athletics.",
  ].join("\n");
  const html = [
    "<!doctype html><html><body>",
    "<h1>Payment confirmation</h1>",
    "<p>New Vision Athletics confirmed your Venmo payment.</p>",
    `<p><strong>Amount:</strong> ${money(amount)}<br><strong>Received:</strong> ${escapeHtml(receivedDay)} (UTC)<br><strong>Payment ID:</strong> ${escapeHtml(paymentId)}</p>`,
    "<h2>Applied to</h2><ul>",
    ...lines.map((line) => `<li>${escapeHtml(line.name)}, ${escapeHtml(line.month)} tuition: ${escapeHtml(line.amount)}</li>`),
    "</ul>",
    `<p><a href="${escapeHtml(link)}">Open Parent Portal sign-in</a></p>`,
    "<p>You can request an email sign-in link there. Portal access requires an approved guardian invitation; this payment email does not grant access.</p>",
    "<p>If any detail looks wrong, please contact New Vision Athletics.</p>",
    "</body></html>",
  ].join("");
  return { subject, text, html };
}
