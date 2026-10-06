import { withSupabase } from 'npm:@supabase/server@1'

// The wrapper checks the user JWT and handles browser CORS preflight.
// Query with the caller-scoped client so the existing RLS policy remains in force.
export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    const userId = ctx.userClaims?.id
    if (!userId) {
      return Response.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { data, error } = await ctx.supabase
      .from('coach_users')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) {
      console.error('Coach access check failed', error)
      return Response.json({ error: 'Access check unavailable' }, { status: 503 })
    }
    if (!data) {
      return Response.json({ error: 'Coach access required' }, { status: 403 })
    }

    // This first route proves the private server boundary. No roster data is returned.
    return Response.json({ ok: true })
  }),
}
