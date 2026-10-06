import { renderDropInNotification } from "../_shared/drop-in-notification.mjs";
import { deliverQueuedNotification } from "../_shared/notification-delivery.mjs";

const flow = {
  claim: "claim_drop_in_notification", current: "drop_in_notification_current",
  settle: "settle_drop_in_notification", linkField: "reviewUrl", render: renderDropInNotification,
  claimArgs: (config) => ({ p_review_url: config.reviewUrl, p_from_email: config.from }),
  leaseArgs: (payload, token) => ({ p_request_id: payload?.requestId,
    p_coach_id: payload?.coachId, p_lease_token: token }),
  idempotencyKey: (payload) => `nva-drop-in-${payload.requestId}-${payload.coachId}`,
};
export function deliverNotification(admin, config, send = fetch, log = console) {
  return deliverQueuedNotification(admin, config, flow, send, log);
}
