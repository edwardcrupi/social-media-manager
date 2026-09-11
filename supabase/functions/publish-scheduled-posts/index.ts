// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs,
// every 15-30 min recommended). Finds posts whose scheduled_for has arrived
// and actually publishes them to the connected Instagram account -- no
// review step, per the product decision that auto-drafted posts should go
// out unattended. Only posts with both a linked, connected social_profile
// and a media_url are eligible (Instagram cannot publish a text-only post).
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const GRAPH_VERSION = 'v26.0'
const CONTAINER_POLL_DELAY_MS = 3000

async function waitForContainerReady(igUserId: string, creationId: string, accessToken: string, maxAttempts: number) {
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing required environment variables', { status: 500 })
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: duePosts, error: postsError } = await supabase
    .from('posts')
    .select('id, body, media_url, media_type, social_profile_id')
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
      if (profile.platform !== 'instagram' || profile.connection_status !== 'connected' || !profile.external_id) {
        results.push({ postId: post.id, published: false, reason: 'profile not a connected Instagram account' })
        continue
      }

      const { data: secret, error: secretError } = await supabase
        .from('social_profile_secrets')
        .select('access_token')
        .eq('social_profile_id', post.social_profile_id)
        .single()
      if (secretError) throw secretError

      const igUserId = profile.external_id
      const accessToken = secret.access_token as string

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
      await waitForContainerReady(igUserId, creationId, accessToken, isVideo ? 20 : 5)

      const publishUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media_publish`)
      publishUrl.searchParams.set('creation_id', creationId)
      publishUrl.searchParams.set('access_token', accessToken)
      const publishRes = await fetch(publishUrl, { method: 'POST' })
      const publishJson = await publishRes.json()
      if (!publishRes.ok) throw new Error(publishJson?.error?.message ?? 'Failed to publish media')

      const { error: updateError } = await supabase
        .from('posts')
        .update({ status: 'published', published_at: new Date().toISOString() })
        .eq('id', post.id)
      if (updateError) throw updateError

      results.push({ postId: post.id, published: true, instagramMediaId: publishJson.id })
    } catch (error) {
      results.push({ postId: post.id, published: false, reason: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
