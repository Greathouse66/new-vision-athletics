import { withSupabase } from 'npm:@supabase/server@1'
import { renderPaymentReceipt } from '../_shared/payment-receipt.mjs'

function settings() {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('NVA_RECEIPT_FROM')
  const origin = Deno.env.get('NVA_PUBLIC_ORIGIN')
  if (!apiKey || !from || !origin ||
      !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from)) {
    throw new Error('Receipt sender is not configured')
  }
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.username || url.password ||
      url.port || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Public origin must be a clean HTTPS origin')
  }
  return { apiKey, from, portalUrl: new URL('/auth/sign-in.html', url).href }
}

export default {
  fetch: withSupabase({ auth: 'secret:receipt_worker_test' }, async (request, ctx) => {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }
    let config
    try { config = settings() } catch {
      return Response.json({ error: 'Sender not configured' }, { status: 503 })
    }
    const { data: job, error: claimError } = await ctx.supabaseAdmin.rpc(
      'claim_payment_receipt_delivery', {
        p_portal_url: config.portalUrl, p_from_email: config.from,
      },
    )
    if (claimError) {
      console.error('Receipt claim failed', claimError.code)
      return Response.json({ error: 'Queue unavailable' }, { status: 503 })
    }
    if (!job) return Response.json({ status: 'idle' })
    if (job.review) return Response.json({ status: 'review' })

    const payload = job.payload
    const leaseToken = job.leaseToken
    let failureCode = 'temporary'
    let providerId = null
    try {
      if (!payload || typeof payload.to !== 'string' ||
          !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(payload.to) ||
          typeof payload.from !== 'string' || payload.from !== config.from ||
          typeof leaseToken !== 'string') {
        failureCode = 'invalid_payload'
        throw new Error('Invalid queued receipt')
      }
      failureCode = 'invalid_payload'
      const message = renderPaymentReceipt(payload)
      failureCode = 'temporary'
      const { data: current, error: contactError } = await ctx.supabaseAdmin.rpc(
        'receipt_contact_current', {
          p_payment_id: payload.paymentId, p_contact_id: payload.contactId,
          p_lease_token: leaseToken,
        },
      )
      if (contactError || !current) {
        failureCode = contactError ? 'temporary' : 'contact_revoked'
        throw new Error('Receipt contact needs review')
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `nva-payment-${payload.paymentId}`,
        },
        body: JSON.stringify({ from: payload.from, to: [payload.to],
          subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(12000),
      })
      if (!response.ok) {
        failureCode = response.status === 429 ? 'rate_limited'
          : response.status >= 500 || response.status === 409 ? 'temporary'
          : 'provider_rejected'
        throw new Error(`Provider status ${response.status}`)
      }
      const result = await response.json()
      if (!result || typeof result.id !== 'string' || result.id.length > 200) {
        throw new Error('Provider response lacks message ID')
      }
      providerId = result.id
    } catch (error) {
      console.error('Receipt delivery attempt failed', failureCode,
        error instanceof Error ? error.name : 'unknown')
    }

    const { error: settleError } = await ctx.supabaseAdmin.rpc(
      'settle_payment_receipt_delivery', {
        p_payment_id: payload?.paymentId, p_lease_token: leaseToken,
        p_sent: !!providerId, p_provider_message_id: providerId,
        p_failure_code: providerId ? null : failureCode,
      },
    )
    if (settleError) {
      console.error('Receipt settlement failed', settleError.code)
      return Response.json({ error: 'Delivery result needs review' }, { status: 503 })
    }
    return Response.json({ status: providerId ? 'sent' :
      failureCode === 'temporary' || failureCode === 'rate_limited' ? 'retry' : 'review' })
  }),
}
