// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs,
// every 15-30 min recommended). Finds posts whose scheduled_for has arrived
// and actually publishes them to the connected Instagram/TikTok/X/Facebook
// account -- no review step, per the product decision that auto-drafted
// posts should go out unattended. Only posts with both a linked, connected
// social_profile and a media_url are eligible (none of these platforms are
// used here to publish a text-only post -- X and Facebook could, but this
// app never generates one).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const GRAPH_VERSION = 'v26.0'
const CONTAINER_POLL_DELAY_MS = 3000
const TIKTOK_STATUS_POLL_DELAY_MS = 3000
const TIKTOK_STATUS_POLL_ATTEMPTS = 20
const X_MEDIA_CHUNK_BYTES = 4 * 1024 * 1024
const X_MEDIA_STATUS_POLL_ATTEMPTS = 30
const X_TWEET_MAX_CHARS = 280
// Without a cap, a post whose platform is persistently broken (e.g. a stuck
// 403) stays status='scheduled' forever and gets re-selected -- and its
// media re-downloaded from Storage -- on every single cron run indefinitely.
// Discovered 2026-09-23: 29 X posts sat stuck for 6+ days, retried every 15
// minutes, and were the real driver behind a Supabase Storage bandwidth
// overage that looked at first like a compute/hosting problem instead.
const MAX_PUBLISH_ATTEMPTS = 5
// TikTok gates public posting via the Content Posting API behind an app
// audit ("Content Posting API access") that's separate from basic Login Kit
// approval -- until that audit is granted, TikTok requires unaudited apps
// to post as SELF_ONLY (visible only to the connected account). Set
// TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE once the app has been audited.
const TIKTOK_PRIVACY_LEVEL = Deno.env.get('TIKTOK_PRIVACY_LEVEL') || 'SELF_ONLY'

async function waitForIgContainerReady(creationId: string, accessToken: string, maxAttempts: number) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const statusUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${creationId}`)
    statusUrl.searchParams.set('fields', 'status_code')
    statusUrl.searchParams.set('access_token', accessToken)
    const res = await fetch(statusUrl)
    const json = await res.json()
    if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to check media container status')
    if (json.status_code === 'FINISHED') return
    if (json.status_code === 'ERROR') throw new Error('Instagram failed to process the media container')
    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_DELAY_MS))
  }
  throw new Error('Timed out waiting for Instagram to process the media container')
}

async function publishToInstagram(post: Record<string, unknown>, igUserId: string, accessToken: string) {
  const isVideo = post.media_type === 'video'
  const createUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media`)
  if (isVideo) {
    createUrl.searchParams.set('media_type', 'REELS')
    createUrl.searchParams.set('video_url', post.media_url as string)
  } else {
    createUrl.searchParams.set('image_url', post.media_url as string)
  }
  createUrl.searchParams.set('caption', (post.body as string) ?? '')
  createUrl.searchParams.set('access_token', accessToken)
  const createRes = await fetch(createUrl, { method: 'POST' })
  const createJson = await createRes.json()
  if (!createRes.ok) throw new Error(createJson?.error?.message ?? 'Failed to create media container')
  const creationId = createJson.id as string

  // Video containers take longer to process than images.
  await waitForIgContainerReady(creationId, accessToken, isVideo ? 20 : 5)

  const publishUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media_publish`)
  publishUrl.searchParams.set('creation_id', creationId)
  publishUrl.searchParams.set('access_token', accessToken)
  const publishRes = await fetch(publishUrl, { method: 'POST' })
  const publishJson = await publishRes.json()
  if (!publishRes.ok) throw new Error(publishJson?.error?.message ?? 'Failed to publish media')

  return { platformMediaId: publishJson.id as string }
}

async function publishToFacebook(post: Record<string, unknown>, pageId: string, accessToken: string) {
  const isVideo = post.media_type === 'video'
  // Unlike Instagram's Content Publishing API, Page feed posts don't need a
  // create-container-then-publish dance -- /photos and /videos accept a
  // source URL directly and hand back the published post id synchronously.
  const publishUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/${isVideo ? 'videos' : 'photos'}`)
  if (isVideo) {
    publishUrl.searchParams.set('file_url', post.media_url as string)
    publishUrl.searchParams.set('description', (post.body as string) ?? '')
  } else {
    publishUrl.searchParams.set('url', post.media_url as string)
    publishUrl.searchParams.set('caption', (post.body as string) ?? '')
  }
  publishUrl.searchParams.set('access_token', accessToken)
  const publishRes = await fetch(publishUrl, { method: 'POST' })
  const publishJson = await publishRes.json()
  if (!publishRes.ok) throw new Error(publishJson?.error?.message ?? 'Failed to publish to Facebook Page')

  return { platformMediaId: (publishJson.post_id ?? publishJson.id) as string }
}

async function refreshTiktokTokenIfNeeded(
  supabase: ReturnType<typeof createClient>,
  socialProfileId: string,
  secret: { access_token: string; refresh_token: string | null; expires_at: string | null },
  clientKey: string,
  clientSecret: string,
) {
  const expiresAt = secret.expires_at ? new Date(secret.expires_at).getTime() : 0
  const stillValid = expiresAt - Date.now() > 5 * 60 * 1000
  if (stillValid) return secret.access_token
  if (!secret.refresh_token) throw new Error('TikTok access token expired and no refresh token is on file -- reconnect the account')

  const refreshRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: secret.refresh_token,
    }),
  })
  const refreshJson = await refreshRes.json()
  if (!refreshRes.ok || refreshJson.error) {
    throw new Error(refreshJson.error_description ?? refreshJson.error ?? 'Failed to refresh TikTok access token')
  }
  const newExpiresInSeconds = typeof refreshJson.expires_in === 'number' ? refreshJson.expires_in : 24 * 60 * 60

  await supabase
    .from('social_profile_secrets')
    .update({
      access_token: refreshJson.access_token,
      refresh_token: refreshJson.refresh_token ?? secret.refresh_token,
      expires_at: new Date(Date.now() + newExpiresInSeconds * 1000).toISOString(),
    })
    .eq('social_profile_id', socialProfileId)

  return refreshJson.access_token as string
}

async function queryTiktokCreatorInfo(accessToken: string) {
  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  })
  const json = await res.json()
  if (!res.ok || json.error?.code !== 'ok') {
    throw new Error(json.error?.message ?? 'Failed to query TikTok creator info')
  }
  return json.data as {
    privacy_level_options: string[]
    comment_disabled: boolean
    duet_disabled: boolean
    stitch_disabled: boolean
  }
}

async function publishToTiktok(post: Record<string, unknown>, accessToken: string) {
  if (post.media_type !== 'video') {
    throw new Error('TikTok only supports video posts')
  }

  // Required by TikTok's Content Posting API integration guidelines: a
  // direct-post request must use a privacy_level the creator's own account
  // actually allows (varies per account), not just whatever this app
  // defaults to -- posting with an unsupported privacy_level is rejected
  // outright, pointing at their content-sharing-guidelines doc rather than
  // naming the real problem.
  const creatorInfo = await queryTiktokCreatorInfo(accessToken)
  const privacyLevel = creatorInfo.privacy_level_options.includes(TIKTOK_PRIVACY_LEVEL)
    ? TIKTOK_PRIVACY_LEVEL
    : creatorInfo.privacy_level_options.find((level) => level === 'SELF_ONLY') ?? creatorInfo.privacy_level_options[0]
  if (!privacyLevel) throw new Error('TikTok creator info returned no usable privacy_level_options')

  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: {
        title: (post.body as string) ?? '',
        privacy_level: privacyLevel,
        disable_duet: creatorInfo.duet_disabled,
        disable_comment: creatorInfo.comment_disabled,
        disable_stitch: creatorInfo.stitch_disabled,
      },
      source_info: {
        // Requires the video's domain to be verified as a "URL Prefix" for
        // this TikTok app in the Developer Portal, the same way Meta
        // requires App Domains -- otherwise PULL_FROM_URL fails outright.
        source: 'PULL_FROM_URL',
        video_url: post.media_url as string,
      },
    }),
  })
  const initJson = await initRes.json()
  if (!initRes.ok || initJson.error?.code !== 'ok') {
    throw new Error(initJson.error?.message ?? 'Failed to start TikTok video publish')
  }
  const publishId = initJson.data.publish_id as string

  for (let attempt = 0; attempt < TIKTOK_STATUS_POLL_ATTEMPTS; attempt++) {
    const statusRes = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: publishId }),
    })
    const statusJson = await statusRes.json()
    if (!statusRes.ok || statusJson.error?.code !== 'ok') {
      throw new Error(statusJson.error?.message ?? 'Failed to check TikTok publish status')
    }
    const status = statusJson.data.status as string
    if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') {
      return { platformMediaId: publishId }
    }
    if (status === 'FAILED') {
      throw new Error(statusJson.data.fail_reason ?? 'TikTok failed to process the video')
    }
    await new Promise((resolve) => setTimeout(resolve, TIKTOK_STATUS_POLL_DELAY_MS))
  }
  throw new Error('Timed out waiting for TikTok to process the video')
}

async function refreshXTokenIfNeeded(
  supabase: ReturnType<typeof createClient>,
  socialProfileId: string,
  secret: { access_token: string; refresh_token: string | null; expires_at: string | null },
  clientId: string,
  clientSecret: string,
) {
  const expiresAt = secret.expires_at ? new Date(secret.expires_at).getTime() : 0
  const stillValid = expiresAt - Date.now() > 5 * 60 * 1000
  if (stillValid) return secret.access_token
  if (!secret.refresh_token) throw new Error('X access token expired and no refresh token is on file -- reconnect the account')

  const basicAuth = btoa(`${clientId}:${clientSecret}`)
  const refreshRes = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basicAuth}` },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: secret.refresh_token,
      client_id: clientId,
    }),
  })
  const refreshJson = await refreshRes.json()
  if (!refreshRes.ok || refreshJson.error) {
    throw new Error(refreshJson.error_description ?? refreshJson.error ?? 'Failed to refresh X access token')
  }
  const newExpiresInSeconds = typeof refreshJson.expires_in === 'number' ? refreshJson.expires_in : 2 * 60 * 60

  // X's refresh tokens are documented as single-use/rotating -- the old one
  // stops working once a new one is issued, so the response's refresh_token
  // (when present) must overwrite the stored one every time, not just the
  // access_token. Falls back to keeping the existing one only if a refresh
  // response ever omits it.
  await supabase
    .from('social_profile_secrets')
    .update({
      access_token: refreshJson.access_token,
      refresh_token: refreshJson.refresh_token ?? secret.refresh_token,
      expires_at: new Date(Date.now() + newExpiresInSeconds * 1000).toISOString(),
    })
    .eq('social_profile_id', socialProfileId)

  return refreshJson.access_token as string
}

async function waitForXMediaReady(mediaId: string, accessToken: string) {
  for (let attempt = 0; attempt < X_MEDIA_STATUS_POLL_ATTEMPTS; attempt++) {
    const statusUrl = new URL('https://api.x.com/2/media/upload')
    statusUrl.searchParams.set('command', 'STATUS')
    statusUrl.searchParams.set('media_id', mediaId)
    const res = await fetch(statusUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
    const json = await res.json()
    if (!res.ok) throw new Error(`media status: ${json?.errors?.[0]?.message ?? json?.detail ?? 'Failed to check X media processing status'}`)
    const processingInfo = json.data?.processing_info as { state?: string; check_after_secs?: number; error?: { message?: string } } | undefined
    if (!processingInfo || processingInfo.state === 'succeeded') return
    if (processingInfo.state === 'failed') {
      throw new Error(processingInfo.error?.message ?? 'X failed to process the uploaded media')
    }
    await new Promise((resolve) => setTimeout(resolve, (processingInfo.check_after_secs ?? 1) * 1000))
  }
  throw new Error('Timed out waiting for X to process the uploaded media')
}

async function uploadMediaToX(mediaUrl: string, mediaType: string, accessToken: string) {
  const fileRes = await fetch(mediaUrl)
  if (!fileRes.ok) throw new Error('Failed to download media for upload to X')
  const bytes = new Uint8Array(await fileRes.arrayBuffer())

  const isVideo = mediaType === 'video'
  const xMediaType = isVideo ? 'video/mp4' : 'image/png'
  const mediaCategory = isVideo ? 'tweet_video' : 'tweet_image'

  const initRes = await fetch('https://api.x.com/2/media/upload/initialize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: xMediaType, total_bytes: bytes.byteLength, media_category: mediaCategory }),
  })
  const initJson = await initRes.json()
  if (!initRes.ok) throw new Error(`media init: ${initJson?.errors?.[0]?.message ?? initJson?.detail ?? 'Failed to initialize X media upload'}`)
  const mediaId = initJson.data.id as string

  for (let offset = 0, segmentIndex = 0; offset < bytes.byteLength; offset += X_MEDIA_CHUNK_BYTES, segmentIndex++) {
    const chunk = bytes.slice(offset, offset + X_MEDIA_CHUNK_BYTES)
    const form = new FormData()
    form.set('segment_index', String(segmentIndex))
    form.set('media', new Blob([chunk]))
    const appendRes = await fetch(`https://api.x.com/2/media/upload/${mediaId}/append`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    })
    if (!appendRes.ok) {
      const appendJson = await appendRes.json().catch(() => null)
      throw new Error(`media append: ${appendJson?.errors?.[0]?.message ?? appendJson?.detail ?? `Failed to upload media chunk ${segmentIndex} to X`}`)
    }
  }

  const finalizeRes = await fetch(`https://api.x.com/2/media/upload/${mediaId}/finalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const finalizeJson = await finalizeRes.json()
  if (!finalizeRes.ok) throw new Error(`media finalize: ${finalizeJson?.errors?.[0]?.message ?? finalizeJson?.detail ?? 'Failed to finalize X media upload'}`)

  if (finalizeJson.data?.processing_info) {
    await waitForXMediaReady(mediaId, accessToken)
  }

  return mediaId
}

// Phase 12 appends a tracked short link to the caption on platforms with
// clickable captions, so a blind truncation would slice a URL in half --
// giving a tweet that is both unclickable and billed at X's $0.20
// with-a-URL rate instead of $0.015. A trailing URL is therefore kept whole
// and only the body above it is truncated. Counting the raw URL length
// over-counts (X wraps every URL to a 23-character t.co link), which errs
// toward a slightly shorter tweet rather than a rejected one.
function truncateForX(text: string): string {
  if (text.length <= X_TWEET_MAX_CHARS) return text

  const trailingUrl = text.match(/\s(https?:\/\/\S+)\s*$/)
  if (!trailingUrl || trailingUrl.index === undefined) {
    return `${text.slice(0, X_TWEET_MAX_CHARS - 1)}…`
  }

  const url = trailingUrl[1]
  // Budget for the body: the tweet, minus the URL, minus the "\n\n"
  // separator, minus the ellipsis.
  const bodyBudget = X_TWEET_MAX_CHARS - url.length - 3
  if (bodyBudget <= 0) return url
  const body = text.slice(0, trailingUrl.index).trimEnd()
  if (body.length <= bodyBudget) return `${body}\n\n${url}`
  return `${body.slice(0, bodyBudget)}…\n\n${url}`
}

async function publishToX(post: Record<string, unknown>, accessToken: string) {
  const mediaId = await uploadMediaToX(post.media_url as string, post.media_type as string, accessToken)

  const tweetRes = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: truncateForX((post.body as string) ?? ''), media: { media_ids: [mediaId] } }),
  })
  const tweetJson = await tweetRes.json()
  if (!tweetRes.ok || tweetJson.errors) {
    // X returns a bare RFC7807 problem (detail/title/type at the top level,
    // no `errors` array) for account/App-permission-level 403s, unlike the
    // `errors[0].message` shape most other v2 error responses use -- fall
    // back to `detail` so this case doesn't just say "Failed to publish tweet".
    throw new Error(
      `tweet create (HTTP ${tweetRes.status}): ${tweetJson.errors?.[0]?.message ?? tweetJson.detail ?? 'Failed to publish tweet'}`,
    )
  }

  return { platformMediaId: tweetJson.data.id as string }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const tiktokClientKey = Deno.env.get('TIKTOK_CLIENT_KEY')
  const tiktokClientSecret = Deno.env.get('TIKTOK_CLIENT_SECRET')
  const xClientId = Deno.env.get('X_CLIENT_ID')
  const xClientSecret = Deno.env.get('X_CLIENT_SECRET')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing required environment variables', { status: 500 })
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: duePosts, error: postsError } = await supabase
    .from('posts')
    .select('id, body, media_url, media_type, social_profile_id, publish_attempts')
    .eq('status', 'scheduled')
    .not('social_profile_id', 'is', null)
    .not('media_url', 'is', null)
    .lte('scheduled_for', new Date().toISOString())

  if (postsError) {
    return new Response(JSON.stringify({ error: postsError.message }), { status: 500 })
  }

  const results = []

  for (const post of duePosts ?? []) {
    try {
      const { data: profile, error: profileError } = await supabase
        .from('social_profiles')
        .select('platform, connection_status, external_id')
        .eq('id', post.social_profile_id)
        .single()
      if (profileError) throw profileError
      if (profile.connection_status !== 'connected' || !profile.external_id) {
        results.push({ postId: post.id, published: false, reason: 'profile is not connected' })
        continue
      }
      if (
        profile.platform !== 'instagram' &&
        profile.platform !== 'tiktok' &&
        profile.platform !== 'x' &&
        profile.platform !== 'facebook'
      ) {
        results.push({ postId: post.id, published: false, reason: `publishing not supported for platform ${profile.platform}` })
        continue
      }

      const { data: secret, error: secretError } = await supabase
        .from('social_profile_secrets')
        .select('access_token, refresh_token, expires_at')
        .eq('social_profile_id', post.social_profile_id)
        .single()
      if (secretError) throw secretError

      let platformMediaId: string
      if (profile.platform === 'instagram') {
        const result = await publishToInstagram(post, profile.external_id, secret.access_token as string)
        platformMediaId = result.platformMediaId
      } else if (profile.platform === 'facebook') {
        const result = await publishToFacebook(post, profile.external_id, secret.access_token as string)
        platformMediaId = result.platformMediaId
      } else if (profile.platform === 'tiktok') {
        if (!tiktokClientKey || !tiktokClientSecret) {
          throw new Error('TikTok client credentials are not configured')
        }
        const accessToken = await refreshTiktokTokenIfNeeded(
          supabase,
          post.social_profile_id as string,
          secret as { access_token: string; refresh_token: string | null; expires_at: string | null },
          tiktokClientKey,
          tiktokClientSecret,
        )
        const result = await publishToTiktok(post, accessToken)
        platformMediaId = result.platformMediaId
      } else {
        if (!xClientId || !xClientSecret) {
          throw new Error('X client credentials are not configured')
        }
        const accessToken = await refreshXTokenIfNeeded(
          supabase,
          post.social_profile_id as string,
          secret as { access_token: string; refresh_token: string | null; expires_at: string | null },
          xClientId,
          xClientSecret,
        )
        const result = await publishToX(post, accessToken)
        platformMediaId = result.platformMediaId
      }

      const { error: updateError } = await supabase
        .from('posts')
        .update({ status: 'published', published_at: new Date().toISOString(), platform_media_id: platformMediaId })
        .eq('id', post.id)
      if (updateError) throw updateError

      results.push({ postId: post.id, published: true, platformMediaId })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error'
      const attempts = ((post.publish_attempts as number | null) ?? 0) + 1
      if (attempts >= MAX_PUBLISH_ATTEMPTS) {
        await supabase
          .from('posts')
          .update({ status: 'failed', failure_reason: `${reason} (gave up after ${attempts} attempts)`, publish_attempts: attempts })
          .eq('id', post.id)
        results.push({ postId: post.id, published: false, reason, attempts, gaveUp: true })
      } else {
        await supabase.from('posts').update({ publish_attempts: attempts }).eq('id', post.id)
        results.push({ postId: post.id, published: false, reason, attempts })
      }
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
