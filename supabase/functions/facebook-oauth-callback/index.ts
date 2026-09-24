// Deno edge function. Meta redirects the user's browser here directly after
// they approve (or deny) the OAuth dialog -- there is no Supabase session on
// this request, so it must be deployed WITH --no-verify-jwt. Every exit path
// redirects back to the app rather than rendering raw JSON, since a human
// lands here mid-navigation.
//
// Unlike instagram-oauth-callback, this stores the Facebook Page itself as
// the social_profile (external_id = Page id) rather than looking up a linked
// Instagram Business Account -- posting later happens straight to the Page's
// feed via the same stored Page access token.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const GRAPH_VERSION = 'v26.0'

function redirectToApp(appUrl: string, params: Record<string, string>) {
  const url = new URL('/profiles', appUrl)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return Response.redirect(url.toString(), 302)
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const metaAppId = Deno.env.get('META_APP_ID')
  const metaAppSecret = Deno.env.get('META_APP_SECRET')
  const facebookRedirectUri = Deno.env.get('FACEBOOK_REDIRECT_URI')
  const appUrl = Deno.env.get('APP_URL')
  if (!supabaseUrl || !serviceRoleKey || !metaAppId || !metaAppSecret || !facebookRedirectUri || !appUrl) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  const state = url.searchParams.get('state')

  if (oauthError) {
    return redirectToApp(appUrl, { fb_error: oauthError })
  }
  if (!code || !state) {
    return redirectToApp(appUrl, { fb_error: 'Missing code or state from Meta redirect' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: stateRow, error: stateError } = await supabase
    .from('oauth_states')
    .select('user_id')
    .eq('state', state)
    .eq('provider', 'facebook')
    .maybeSingle()
  if (stateError || !stateRow) {
    return redirectToApp(appUrl, { fb_error: 'This connection link expired or was already used. Please try again.' })
  }
  await supabase.from('oauth_states').delete().eq('state', state)
  const userId = stateRow.user_id as string

  try {
    const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
    tokenUrl.searchParams.set('client_id', metaAppId)
    tokenUrl.searchParams.set('redirect_uri', facebookRedirectUri)
    tokenUrl.searchParams.set('client_secret', metaAppSecret)
    tokenUrl.searchParams.set('code', code)
    const tokenRes = await fetch(tokenUrl)
    const tokenJson = await tokenRes.json()
    if (!tokenRes.ok) throw new Error(tokenJson?.error?.message ?? 'Failed to exchange code for token')
    const shortLivedToken = tokenJson.access_token as string

    const longLivedUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`)
    longLivedUrl.searchParams.set('grant_type', 'fb_exchange_token')
    longLivedUrl.searchParams.set('client_id', metaAppId)
    longLivedUrl.searchParams.set('client_secret', metaAppSecret)
    longLivedUrl.searchParams.set('fb_exchange_token', shortLivedToken)
    const longLivedRes = await fetch(longLivedUrl)
    const longLivedJson = await longLivedRes.json()
    if (!longLivedRes.ok) throw new Error(longLivedJson?.error?.message ?? 'Failed to get a long-lived token')
    const longLivedUserToken = longLivedJson.access_token as string
    const expiresInSeconds = typeof longLivedJson.expires_in === 'number' ? longLivedJson.expires_in : 60 * 24 * 60 * 60

    const pagesRes = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token,fan_count,category&access_token=${encodeURIComponent(longLivedUserToken)}`,
    )
    const pagesJson = await pagesRes.json()
    if (!pagesRes.ok) throw new Error(pagesJson?.error?.message ?? 'Failed to list Facebook Pages')
    const page = pagesJson.data?.[0]
    if (!page) throw new Error('No Facebook Page found for this account. Make sure you manage at least one Page.')
    // Page access tokens returned by /me/accounts for a long-lived user token
    // are themselves long-lived (they don't expire on their own timer the
    // way the user token above does) -- same assumption instagram-oauth-callback
    // makes, since Instagram publishing reuses this same Page access token.
    const pageAccessToken = page.access_token as string

    const { data: existingProfile } = await supabase
      .from('social_profiles')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'facebook')
      .eq('external_id', page.id)
      .maybeSingle()

    const profileFields = {
      platform: 'facebook' as const,
      display_name: page.name as string,
      handle: (page.category as string) ?? null,
      follower_count: typeof page.fan_count === 'number' ? page.fan_count : null,
      connection_status: 'connected' as const,
      external_id: page.id as string,
    }

    let socialProfileId: string
    if (existingProfile) {
      socialProfileId = existingProfile.id
      const { error: updateError } = await supabase.from('social_profiles').update(profileFields).eq('id', socialProfileId)
      if (updateError) throw updateError
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from('social_profiles')
        .insert({ ...profileFields, user_id: userId })
        .select('id')
        .single()
      if (insertError) throw insertError
      socialProfileId = inserted.id
    }

    const { error: secretError } = await supabase.from('social_profile_secrets').upsert(
      {
        social_profile_id: socialProfileId,
        access_token: pageAccessToken,
        expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      },
      { onConflict: 'social_profile_id' },
    )
    if (secretError) throw secretError

    return redirectToApp(appUrl, { fb_connected: '1' })
  } catch (error) {
    return redirectToApp(appUrl, { fb_error: error instanceof Error ? error.message : 'Unknown error connecting Facebook' })
  }
})
