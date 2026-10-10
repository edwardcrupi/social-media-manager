// Deno edge function. Called by the authenticated frontend when the user
// clicks "Connect X". Mints a single-use state token tied to the calling
// user (same oauth_states table/shape as Instagram/TikTok, provider = 'x'),
// plus a PKCE code_verifier that x-oauth-callback needs later to complete
// the token exchange -- X's OAuth 2.0 flow requires PKCE even for a
// confidential (server-side-secret) client, unlike Instagram/TikTok.
//
// Requires JWT verification (deployed WITHOUT --no-verify-jwt) so
// `Authorization` is guaranteed to be a valid Supabase session before we
// ever touch it.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

// offline.access is what yields a refresh_token (X access tokens last only
// ~2h). media.write is required for the chunked media upload endpoint used
// by publish-scheduled-posts, separate from tweet.write which only covers
// posting the tweet itself.
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write']

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function generateCodeVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(64)))
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const xClientId = Deno.env.get('X_CLIENT_ID')
  const xRedirectUri = Deno.env.get('X_REDIRECT_URI')
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !xClientId || !xRedirectUri) {
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
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  const serviceClient = createClient(supabaseUrl, serviceRoleKey)
  const { error } = await serviceClient
    .from('oauth_states')
    .insert({ state, user_id: user.id, provider: 'x', code_verifier: codeVerifier })
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authorizeUrl = new URL('https://x.com/i/oauth2/authorize')
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('client_id', xClientId)
  authorizeUrl.searchParams.set('redirect_uri', xRedirectUri)
  authorizeUrl.searchParams.set('scope', SCOPES.join(' '))
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('code_challenge', codeChallenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')

  return new Response(JSON.stringify({ url: authorizeUrl.toString() }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
