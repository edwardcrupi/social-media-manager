// Deno edge function. Called by the authenticated frontend when the user
// clicks "Connect Instagram". Mints a single-use state token tied to the
// calling user, then hands back the Meta authorization URL to redirect to.
//
// Requires JWT verification (deployed WITHOUT --no-verify-jwt) so
// `Authorization` is guaranteed to be a valid Supabase session before we
// ever touch it.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const GRAPH_VERSION = 'v26.0'
const SCOPES = ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'instagram_manage_insights', 'instagram_content_publish']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const metaAppId = Deno.env.get('META_APP_ID')
  const metaRedirectUri = Deno.env.get('META_REDIRECT_URI')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !metaAppId || !metaRedirectUri) {
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
    .insert({ state, user_id: user.id, provider: 'instagram' })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authorizeUrl = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  authorizeUrl.searchParams.set('client_id', metaAppId)
  authorizeUrl.searchParams.set('redirect_uri', metaRedirectUri)
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', SCOPES.join(','))

  return new Response(JSON.stringify({ url: authorizeUrl.toString() }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
