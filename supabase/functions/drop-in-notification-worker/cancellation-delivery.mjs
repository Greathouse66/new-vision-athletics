import { renderParentCancellationNotification } from "../_shared/drop-in-notification.mjs";
import { deliverQueuedNotification } from "../_shared/notification-delivery.mjs";

const flow = {
  claim: "claim_parent_cancellation_notification", current: "parent_cancellation_notification_current",
  settle: "settle_parent_cancellation_notification", linkField: "reviewUrl", render: renderParentCancellationNotification,
  claimArgs: (config) => ({ p_review_url: config.reviewUrl, p_from_email: config.from }),
  leaseArgs: (payload, token) => ({ p_seat_id: payload?.seatId,
    p_coach_id: payload?.coachId, p_lease_token: token }),
  idempotencyKey: (payload) => `nva-parent-cancelled-${payload.seatId}-${payload.coachId}`,
};
export function deliverCancellationNotification(admin, config, send = fetch, log = console) {
  return deliverQueuedNotification(admin, config, flow, send, log);
}
