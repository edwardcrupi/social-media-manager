// Deno edge function, public (--no-verify-jwt) -- this is the postback URL
// registered in Impact's dashboard (Event Notifications), hit directly by
// Impact's servers with no Supabase session. A shared-secret `token` query
// param stands in for auth since the endpoint can't require a JWT.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const CONFIRMED_STATUSES = new Set(['APPROVED', 'LOCKED'])
const REVERSED_STATUSES = new Set(['REVERSED', 'DECLINED'])

function mapStatus(impactStatus: string | null): 'pending' | 'confirmed' | 'reversed' {
  const normalized = (impactStatus ?? '').toUpperCase()
  if (CONFIRMED_STATUSES.has(normalized)) return 'confirmed'
  if (REVERSED_STATUSES.has(normalized)) return 'reversed'
  return 'pending'
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const postbackToken = Deno.env.get('IMPACT_POSTBACK_TOKEN')
  if (!supabaseUrl || !serviceRoleKey || !postbackToken) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const url = new URL(req.url)
  const params = url.searchParams

  if (params.get('token') !== postbackToken) {
    return new Response('Unauthorized', { status: 401 })
  }

  const actionId = params.get('action_id')
  const subId1 = params.get('subid1')
  const payout = params.get('payout')
  if (!actionId || !subId1 || !payout) {
    return new Response('Missing required parameters', { status: 400 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: link } = await supabase
    .from('short_links')
    .select('id, user_id, post_id')
    .eq('slug', subId1)
    .maybeSingle()

  // Impact may retry on non-2xx, and an unmatched subid isn't something
  // Impact can fix -- accept the notification but do nothing.
  if (!link) {
    return new Response('OK', { status: 200 })
  }

  const { error } = await supabase.from('revenue_events').upsert(
    {
      user_id: link.user_id,
      short_link_id: link.id,
      post_id: link.post_id,
      source: 'Impact',
      amount: Number(payout),
      currency: params.get('currency') || 'USD',
      occurred_at: params.get('event_date') || new Date().toISOString(),
      status: mapStatus(params.get('status')),
      external_ref: `impact:${actionId}`,
      note: params.get('campaign'),
    },
    { onConflict: 'user_id,external_ref' },
  )

  if (error) {
    return new Response(`Failed to record conversion: ${error.message}`, { status: 500 })
  }

  return new Response('OK', { status: 200 })
})
