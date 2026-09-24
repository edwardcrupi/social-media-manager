// Deno edge function. TikTok redirects the user's browser here directly
// after they approve (or deny) the OAuth dialog -- there is no Supabase
// session on this request, so it must be deployed WITH --no-verify-jwt.
// Every exit path redirects back to the app rather than rendering raw
// JSON, since a human lands here mid-navigation.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

function redirectToApp(appUrl: string, params: Record<string, string>) {
  const url = new URL('/profiles', appUrl)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return Response.redirect(url.toString(), 302)
}

// TikTok's per-URL "signature file" domain verification checks for a file
// nested one path segment under the exact registered URL (e.g.
// <redirect-uri>/<filename>.txt), which a static host would serve from disk
// but an Edge Function has to handle as just another route. Keyed by
// filename so re-verifying later (a new signature) is a one-line addition,
// not a rewrite.
const TIKTOK_VERIFICATION_FILES: Record<string, string> = {
  'tiktokOuamePgaVBdTL12btVAtIS6ZH8vgpOKL.txt': 'tiktok-developers-site-verification=OuamePgaVBdTL12btVAtIS6ZH8vgpOKL',
  'tiktokONx8qI7Fj59Y109opVAn8tWhTva0EMZt.txt': 'tiktok-developers-site-verification=ONx8qI7Fj59Y109opVAn8tWhTva0EMZt',
}

Deno.serve(async (req) => {
  const verificationPath = new URL(req.url).pathname.split('/').pop() ?? ''
  if (verificationPath in TIKTOK_VERIFICATION_FILES) {
    return new Response(TIKTOK_VERIFICATION_FILES[verificationPath], { headers: { 'Content-Type': 'text/plain' } })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const tiktokClientKey = Deno.env.get('TIKTOK_CLIENT_KEY')
  const tiktokClientSecret = Deno.env.get('TIKTOK_CLIENT_SECRET')
  const tiktokRedirectUri = Deno.env.get('TIKTOK_REDIRECT_URI')
  const appUrl = Deno.env.get('APP_URL')
  if (!supabaseUrl || !serviceRoleKey || !tiktokClientKey || !tiktokClientSecret || !tiktokRedirectUri || !appUrl) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  const state = url.searchParams.get('state')

  if (oauthError) {
    return redirectToApp(appUrl, { tt_error: oauthError })
  }
  if (!code || !state) {
    return redirectToApp(appUrl, { tt_error: 'Missing code or state from TikTok redirect' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: stateRow, error: stateError } = await supabase
    .from('oauth_states')
    .select('user_id')
    .eq('state', state)
    .eq('provider', 'tiktok')
    .maybeSingle()
  if (stateError || !stateRow) {
    return redirectToApp(appUrl, { tt_error: 'This connection link expired or was already used. Please try again.' })
  }
  await supabase.from('oauth_states').delete().eq('state', state)
  const userId = stateRow.user_id as string

  try {
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
      body: new URLSearchParams({
        client_key: tiktokClientKey,
        client_secret: tiktokClientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: tiktokRedirectUri,
      }),
    })
    const tokenJson = await tokenRes.json()
    // TikTok's token endpoint reports errors as a top-level {error,
    // error_description} pair, not nested like the Graph API.
    if (!tokenRes.ok || tokenJson.error) {
      throw new Error(tokenJson.error_description ?? tokenJson.error ?? 'Failed to exchange code for token')
    }
    const accessToken = tokenJson.access_token as string
    const refreshToken = tokenJson.refresh_token as string | undefined
    const expiresInSeconds = typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 24 * 60 * 60

    // username requires the separate user.info.profile scope (its own
    // TikTok review step beyond default Login Kit access), so display_name
    // is used as the handle here instead.
    const profileRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,follower_count',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
    const profileJson = await profileRes.json()
    if (!profileRes.ok || profileJson.error?.code !== 'ok') {
      throw new Error(profileJson.error?.message ?? 'Failed to read TikTok profile')
    }
    const ttProfile = profileJson.data.user

    const { data: existingProfile } = await supabase
      .from('social_profiles')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', 'tiktok')
      .eq('external_id', ttProfile.open_id)
      .maybeSingle()

    const profileFields = {
      platform: 'tiktok' as const,
      display_name: ttProfile.display_name as string,
      handle: `@${ttProfile.display_name}`,
      follower_count: typeof ttProfile.follower_count === 'number' ? ttProfile.follower_count : null,
      connection_status: 'connected' as const,
      external_id: ttProfile.open_id as string,
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

    return redirectToApp(appUrl, { tt_connected: '1' })
  } catch (error) {
    return redirectToApp(appUrl, { tt_error: error instanceof Error ? error.message : 'Unknown error connecting TikTok' })
  }
})
