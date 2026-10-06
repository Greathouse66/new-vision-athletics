import { withSupabase } from 'npm:@supabase/server@1'
import { inviteParent } from './delivery.mjs'

export default {
  fetch: withSupabase({ auth: 'user' }, (request, ctx) => inviteParent(request, {
    caller: ctx.supabase,
    admin: ctx.supabaseAdmin,
    userId: ctx.userClaims?.id,
    publicOrigin: Deno.env.get('NVA_PUBLIC_ORIGIN'),
  })),
}
