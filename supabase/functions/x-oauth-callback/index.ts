// Deno edge function. X redirects the user's browser here directly after
// they approve (or deny) the OAuth dialog -- there is no Supabase session
// on this request, so it must be deployed WITH --no-verify-jwt. Every exit
// path redirects back to the app rather than rendering raw JSON, since a
// human lands here mid-navigation.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

function redirectToApp(appUrl: string, params: Record<string, string>) {
  const url = new URL('/profiles', appUrl)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return Response.redirect(url.toString(), 302)
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const xClientId = Deno.env.get('X_CLIENT_ID')
  const xClientSecret = Deno.env.get('X_CLIENT_SECRET')
  const xRedirectUri = Deno.env.get('X_REDIRECT_URI')
  const appUrl = Deno.env.get('APP_URL')
  if (!supabaseUrl || !serviceRoleKey || !xClientId || !xClientSecret || !xRedirectUri || !appUrl) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  const state = url.searchParams.get('state')

  if (oauthError) {
    return redirectToApp(appUrl, { x_error: oauthError })
  }
  if (!code || !state) {
    return redirectToApp(appUrl, { x_error: 'Missing code or state from X redirect' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: stateRow, error: stateError } = await supabase
    .from('oauth_states')
    .select('user_id, code_verifier')
    .eq('state', state)
    .eq('provider', 'x')
    .maybeSingle()
  if (stateError || !stateRow || !stateRow.code_verifier) {
    return redirectToApp(appUrl, { x_error: 'This connection link expired or was already used. Please try again.' })
  }
  await supabase.from('oauth_states').delete().eq('state', state)
  const userId = stateRow.user_id as string
  const codeVerifier = stateRow.code_verifier as string

  try {
    const basicAuth = btoa(`${xClientId}:${xClientSecret}`)
    const tokenRes = await fetch('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: 'authorization_code',
        client_id: xClientId,
        redirect_uri: xRedirectUri,
        code_verifier: codeVerifier,
      }),
    })
    const tokenJson = await tokenRes.json()
    if (!tokenRes.ok || tokenJson.error) {
      // Tagged with the stage it failed at -- the profile fetch below can
      // fail with confusingly similar-looking X API error bodies, and
      // there's no log access from here to disambiguate after the fact.
      throw new Error(`token exchange: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.status}`)
    }
    const accessToken = tokenJson.access_token as string
    const refreshToken = tokenJson.refresh_token as string | undefined
    const expiresInSeconds = typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 2 * 60 * 60

    const profileRes = await fetch('https://api.x.com/2/users/me?user.fields=public_metrics,profile_image_url', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profileJson = await profileRes.json()
    if (!profileRes.ok || !profileJson.data) {
      throw new Error(
        `profile fetch: ${profileJson.errors?.[0]?.message ?? profileJson.detail ?? profileJson.title ?? profileRes.status}`,
      )
    }
    const xProfile = profileJson.data as {
      id: string
      username: string
      name: string
      public_metrics?: { followers_count?: number }
    }

    const { data: existingProfile } = await supabase
      .from('social_profiles')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'x')
      .eq('external_id', xProfile.id)
      .maybeSingle()

    const profileFields = {
      platform: 'x' as const,
      display_name: xProfile.name,
      handle: `@${xProfile.username}`,
      follower_count: typeof xProfile.public_metrics?.followers_count === 'number' ? xProfile.public_metrics.followers_count : null,
      connection_status: 'connected' as const,
      external_id: xProfile.id,
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
        access_token: accessToken,
        refresh_token: refreshToken ?? null,
        expires_at: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      },
      { onConflict: 'social_profile_id' },
    )
    if (secretError) throw secretError

    return redirectToApp(appUrl, { x_connected: '1' })
  } catch (error) {
    return redirectToApp(appUrl, { x_error: error instanceof Error ? error.message : 'Unknown error connecting X' })
  }
})
