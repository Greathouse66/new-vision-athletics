import { withSupabase } from 'npm:@supabase/server@1'
import { downloadReport } from './download.mjs'

export default {
  fetch: withSupabase({ auth: 'user' }, (request, ctx) => downloadReport(request, {
    caller: ctx.supabase,
    admin: ctx.supabaseAdmin,
    userId: ctx.userClaims?.id,
  })),
}
