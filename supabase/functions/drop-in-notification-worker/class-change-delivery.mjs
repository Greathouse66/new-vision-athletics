import { renderClassChangeNotification } from "../_shared/class-change-notification.mjs";
import { deliverQueuedNotification } from "../_shared/notification-delivery.mjs";
const flow={
  claim:"claim_class_change_notification",current:"class_change_notification_current",
  settle:"settle_class_change_notification",linkField:"portalUrl",render:renderClassChangeNotification,
  claimArgs:config=>({p_portal_url:config.portalUrl,p_from_email:config.from}),
  leaseArgs:(payload,token)=>({p_change_id:payload?.changeId,p_parent_id:payload?.parentId,p_lease_token:token}),
  idempotencyKey:payload=>`nva-class-change-${payload.changeId}-${payload.parentId}`,
};
export function deliverClassChangeNotification(admin,config,send=fetch,log=console){
  return deliverQueuedNotification(admin,config,flow,send,log);
}
