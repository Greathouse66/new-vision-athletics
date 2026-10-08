import { renderProgressReportNotification } from '../_shared/progress-report-notification.mjs';
import { deliverQueuedNotification } from '../_shared/notification-delivery.mjs';
const flow = {
  claim: 'claim_progress_report_notification', current: 'progress_report_notification_current',
  settle: 'settle_progress_report_notification', linkField: 'portalUrl', render: renderProgressReportNotification,
  claimArgs: (config) => ({ p_portal_url: config.portalUrl, p_from_email: config.from }),
  leaseArgs: (payload, token) => ({ p_report_id: payload?.reportId, p_publication: payload?.publication,
    p_parent_id: payload?.parentId, p_lease_token: token }),
  idempotencyKey: (payload) => `nva-report-${payload.reportId}-${payload.publication}-${payload.parentId}`,
};
export function deliverReportNotification(admin, config, send = fetch, log = console) {
  return deliverQueuedNotification(admin, config, flow, send, log);
}
