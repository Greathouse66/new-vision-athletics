import { deliverNotification } from "./delivery.mjs";
import { deliverApprovalNotification } from "./approval-delivery.mjs";

// Process both audiences each minute so neither queue can starve the other.
export async function runNotifications(admin, coachConfig, parentConfig, send = fetch, log = console) {
  const results = {};
  let ok = true;
  for (const [audience, deliver, config] of [
    ["parent", deliverApprovalNotification, parentConfig], ["coach", deliverNotification, coachConfig],
  ]) {
    try {
      const response = await deliver(admin, config, send, log);
      results[audience] = await response.json();
      ok = ok && response.ok;
    } catch {
      log.error("Drop-in notification queue unavailable", audience);
      results[audience] = { error: "Notification queue unavailable" };
      ok = false;
    }
  }
  return Response.json(results, { status: ok ? 200 : 503 });
}
