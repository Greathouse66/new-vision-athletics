import { withSupabase } from 'npm:@supabase/server@1'
import { notificationSettings } from '../_shared/drop-in-notification.mjs'
import { deliverNotification } from './delivery.mjs'

export default {
  // Reuse the existing dedicated worker key stored in Supabase Vault.
  fetch: withSupabase({ auth: 'secret:receipt_worker_test' }, async (request, ctx) => {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
    let config
    try { config = notificationSettings((name) => Deno.env.get(name)) }
    catch { return Response.json({ error: 'Notification sender unavailable' }, { status: 503 }) }
    return deliverNotification(ctx.supabaseAdmin, config)
  }),
}
