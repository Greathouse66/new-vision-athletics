import { deliverNotification } from "./delivery.mjs";
import { deliverApprovalNotification } from "./approval-delivery.mjs";
import { deliverCancellationNotification } from "./cancellation-delivery.mjs";

// Process every queue independently each minute. Concurrent attempts avoid
// stacking three provider timeouts beyond the scheduler's HTTP timeout.
export async function runNotifications(admin, coachConfig, parentConfig, send = fetch, log = console) {
  const results = {};
  let ok = true;
  const cancellationConfig = { ...coachConfig,
    reviewUrl: new URL("/coach/cancellations.html", coachConfig.reviewUrl).href };
  await Promise.all([
    ["parent", deliverApprovalNotification, parentConfig], ["coach", deliverNotification, coachConfig],
    ["cancellation", deliverCancellationNotification, cancellationConfig],
  ].map(async ([audience, deliver, config]) => {
    try {
      const response = await deliver(admin, config, send, log);
      results[audience] = await response.json();
      ok = ok && response.ok;
    } catch {
      log.error("Drop-in notification queue unavailable", audience);
      results[audience] = { error: "Notification queue unavailable" };
      ok = false;
    }
  }));
  return Response.json(results, { status: ok ? 200 : 503 });
}
