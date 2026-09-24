// Deno edge function. Called by the authenticated frontend when the user
// clicks "Connect TikTok". Mints a single-use state token tied to the
// calling user (same oauth_states table/shape as Instagram, just
// provider = 'tiktok'), then hands back TikTok's authorization URL.
//
// Requires JWT verification (deployed WITHOUT --no-verify-jwt) so
// `Authorization` is guaranteed to be a valid Supabase session before we
// ever touch it.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

// video.publish is what lets publish-scheduled-posts use the Content
// Posting API's direct-post endpoint. user.info.stats is a separate scope
// from user.info.basic and is what's needed for follower_count -- basic
// alone only returns open_id/display_name/avatar_url. All three must be
// explicitly added under the app's Scopes tab in the TikTok Developer
// Portal (and, while testing against a Sandbox app, the test account must
// be listed under Sandbox settings -> Target users) before TikTok will
// authorize a request for them -- otherwise the consent step fails with
// "the user did not authorize the scope required", even though nothing is
// wrong with this request itself.
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.publish']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const tiktokClientKey = Deno.env.get('TIKTOK_CLIENT_KEY')
  const tiktokRedirectUri = Deno.env.get('TIKTOK_REDIRECT_URI')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !tiktokClientKey || !tiktokRedirectUri) {
    return new Response(JSON.stringify({ error: 'Missing required environment variables' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Not signed in' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const state = crypto.randomUUID()
  const serviceClient = createClient(supabaseUrl, serviceRoleKey)
  const { error } = await serviceClient
    .from('oauth_states')
    .insert({ state, user_id: user.id, provider: 'tiktok' })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authorizeUrl = new URL('https://www.tiktok.com/v2/auth/authorize/')
  authorizeUrl.searchParams.set('client_key', tiktokClientKey)
  authorizeUrl.searchParams.set('redirect_uri', tiktokRedirectUri)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', SCOPES.join(','))

  return new Response(JSON.stringify({ url: authorizeUrl.toString() }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
