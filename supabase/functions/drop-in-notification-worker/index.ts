import { withSupabase } from 'npm:@supabase/server@1'
import { notificationSettings, approvalNotificationSettings } from '../_shared/drop-in-notification.mjs'
import { runNotifications } from './run.mjs'

export default {
  // Reuse the existing dedicated worker key stored in Supabase Vault.
  fetch: withSupabase({ auth: 'secret:receipt_worker_test' }, async (request, ctx) => {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
    let config
    let parentConfig
    try {
      config = notificationSettings((name) => Deno.env.get(name))
      parentConfig = approvalNotificationSettings((name) => Deno.env.get(name))
    }
    catch { return Response.json({ error: 'Notification sender unavailable' }, { status: 503 }) }
    return runNotifications(ctx.supabaseAdmin, config, parentConfig)
  }),
}
