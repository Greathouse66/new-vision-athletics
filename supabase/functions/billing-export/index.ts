import { withSupabase } from 'npm:@supabase/server@1'
import { formatBillingExport } from './format.mjs'

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }
    const userId = ctx.userClaims?.id
    if (!userId) return Response.json({ error: 'Authentication required' }, { status: 401 })
    const { data: coach, error: roleError } = await ctx.supabase
      .from('coach_users').select('user_id').eq('user_id', userId).maybeSingle()
    if (roleError) return Response.json({ error: 'Access check unavailable' }, { status: 503 })
    if (!coach) return Response.json({ error: 'Coach access required' }, { status: 403 })

    let body
    try { body = await request.json() } catch {
      return Response.json({ error: 'Invalid request' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) {
      return Response.json({ error: 'Valid reporting month required' }, { status: 400 })
    }
    const { data, error } = await ctx.supabase.rpc('billing_export_snapshot', {
      p_month: `${body.month}-01`,
    })
    if (error) {
      console.error('Billing export snapshot failed', error.code)
      return Response.json({ error: 'Could not prepare export' }, { status: 503 })
    }
    try {
      const result = formatBillingExport(data)
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      console.error('Billing export validation failed', error)
      return Response.json({ error: 'Export needs review' }, { status: 503 })
    }
  }),
}
