import { renderDropInApprovalNotification } from "../_shared/drop-in-notification.mjs";
import { deliverQueuedNotification } from "../_shared/notification-delivery.mjs";

const flow = {
  claim: "claim_drop_in_approval_notification", current: "drop_in_approval_notification_current",
  settle: "settle_drop_in_approval_notification", linkField: "portalUrl", render: renderDropInApprovalNotification,
  claimArgs: (config) => ({ p_portal_url: config.portalUrl, p_from_email: config.from }),
  leaseArgs: (payload, token) => ({ p_request_id: payload?.requestId,
    p_parent_id: payload?.parentId, p_lease_token: token }),
  idempotencyKey: (payload) => `nva-drop-in-approved-${payload.requestId}-${payload.parentId}`,
};
export function deliverApprovalNotification(admin, config, send = fetch, log = console) {
  return deliverQueuedNotification(admin, config, flow, send, log);
}
