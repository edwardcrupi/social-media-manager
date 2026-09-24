// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs,
// hourly is plenty -- Instagram's own insights data doesn't update faster
// than that). Pulls real reach/engagement data from the Graph API's
// insights endpoints for every connected Instagram account across all
// users, and writes it into platform_metrics. Runs against every connected
// account it finds rather than one user at a time, same shape as
// publish-scheduled-posts and check-video-jobs.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const GRAPH_VERSION = 'v26.0'
// Account-level metrics, split by the metric_type the Graph API actually
// requires for each -- confirmed against real error responses ("incompatible
// with the metric type") one metric at a time: `reach` is the only one that
// supports metric_type=time_series; profile_views, accounts_engaged, and
// total_interactions all 400 under time_series and require total_value
// instead. total_interactions and accounts_engaged are relatively new
// metric names -- Instagram deprecated `impressions` for accounts created
// after mid-2023 in favor of `reach`, and folded engagement into these two.
const TIME_SERIES_ACCOUNT_METRICS = ['reach']
const TOTAL_VALUE_ACCOUNT_METRICS = ['profile_views', 'accounts_engaged', 'total_interactions']
// Per-media metrics differ by media type -- `views` (not `plays`, which
// 400s with "must be one of the following values" against a real Reel --
// the valid name in this Graph API version) only exists for Reels, and
// posting it against a feed image 400s the whole request.
const IMAGE_MEDIA_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares']
const VIDEO_MEDIA_METRICS = ['reach', 'likes', 'comments', 'saved', 'shares', 'views', 'total_interactions']

type Metric = {
  user_id: string
  social_profile_id: string
  post_id: string | null
  metric_name: string
  metric_value: number
  metric_date: string
}

function dateOnly(isoOrDateLike: string) {
  return isoOrDateLike.slice(0, 10)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return 'unknown error'
}

async function fetchTimeSeriesAccountMetrics(igUserId: string, accessToken: string, socialProfileId: string, userId: string): Promise<Metric[]> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/insights`)
  url.searchParams.set('metric', TIME_SERIES_ACCOUNT_METRICS.join(','))
  url.searchParams.set('period', 'day')
  url.searchParams.set('metric_type', 'time_series')
  url.searchParams.set('access_token', accessToken)
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to fetch account insights')

  const metrics: Metric[] = []
  for (const entry of json.data ?? []) {
    for (const value of entry.values ?? []) {
      if (typeof value.value !== 'number' || !value.end_time) continue
      metrics.push({
        user_id: userId,
        social_profile_id: socialProfileId,
        post_id: null,
        metric_name: entry.name,
        metric_value: value.value,
        metric_date: dateOnly(value.end_time),
      })
    }
  }
  return metrics
}

// total_value metrics (profile_views) come back shaped differently --
// one aggregate { total_value: { value } } per metric, no per-day
// breakdown or end_time, so today's date is used as metric_date same as
// the media-metrics convention below.
async function fetchTotalValueAccountMetrics(igUserId: string, accessToken: string, socialProfileId: string, userId: string): Promise<Metric[]> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/insights`)
  url.searchParams.set('metric', TOTAL_VALUE_ACCOUNT_METRICS.join(','))
  url.searchParams.set('period', 'day')
  url.searchParams.set('metric_type', 'total_value')
  url.searchParams.set('access_token', accessToken)
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to fetch account insights')

  const today = dateOnly(new Date().toISOString())
  const metrics: Metric[] = []
  for (const entry of json.data ?? []) {
    const value = entry.total_value?.value
    if (typeof value !== 'number') continue
    metrics.push({
      user_id: userId,
      social_profile_id: socialProfileId,
      post_id: null,
      metric_name: entry.name,
      metric_value: value,
      metric_date: today,
    })
  }
  return metrics
}

async function fetchAccountMetrics(igUserId: string, accessToken: string, socialProfileId: string, userId: string): Promise<Metric[]> {
  const [timeSeries, totalValue] = await Promise.all([
    fetchTimeSeriesAccountMetrics(igUserId, accessToken, socialProfileId, userId),
    fetchTotalValueAccountMetrics(igUserId, accessToken, socialProfileId, userId),
  ])
  return [...timeSeries, ...totalValue]
}

async function fetchMediaMetrics(
  mediaId: string,
  postId: string,
  socialProfileId: string,
  userId: string,
  mediaType: string,
  accessToken: string,
): Promise<Metric[]> {
  const metricNames = mediaType === 'video' ? VIDEO_MEDIA_METRICS : IMAGE_MEDIA_METRICS
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/insights`)
  url.searchParams.set('metric', metricNames.join(','))
  url.searchParams.set('access_token', accessToken)
  const res = await fetch(url)
  const json = await res.json()
  // Media insights 400 if the post is less than 24h old -- not a real
  // failure, just too soon to have data yet.
  if (!res.ok) {
    if (typeof json?.error?.message === 'string' && json.error.message.includes('24 hours')) return []
    throw new Error(json?.error?.message ?? 'Failed to fetch media insights')
  }

  const today = dateOnly(new Date().toISOString())
  const metrics: Metric[] = []
  for (const entry of json.data ?? []) {
    const value = entry.values?.[0]?.value
    if (typeof value !== 'number') continue
    metrics.push({
      user_id: userId,
      social_profile_id: socialProfileId,
      post_id: postId,
      metric_name: entry.name,
      metric_value: value,
      metric_date: today,
    })
  }
  return metrics
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

  const { data: profiles, error: profilesError } = await supabase
    .from('social_profiles')
    .select('id, external_id, user_id')
    .eq('platform', 'instagram')
    .eq('connection_status', 'connected')
    .not('external_id', 'is', null)
  if (profilesError) {
    return new Response(JSON.stringify({ error: profilesError.message }), { status: 500 })
  }

  const results = []

  for (const profile of profiles ?? []) {
    try {
      const { data: secret, error: secretError } = await supabase
        .from('social_profile_secrets')
        .select('access_token')
        .eq('social_profile_id', profile.id)
        .single()
      if (secretError) throw secretError
      const accessToken = secret.access_token as string
      const igUserId = profile.external_id as string
      const ownerId = profile.user_id as string

      const accountMetrics = await fetchAccountMetrics(igUserId, accessToken, profile.id, ownerId)

      const { data: publishedPosts, error: postsError } = await supabase
        .from('posts')
        .select('id, media_type, platform_media_id')
        .eq('social_profile_id', profile.id)
        .eq('status', 'published')
        .not('platform_media_id', 'is', null)
      if (postsError) throw postsError

      const mediaMetrics: Metric[] = []
      for (const post of publishedPosts ?? []) {
        try {
          const metrics = await fetchMediaMetrics(
            post.platform_media_id as string,
            post.id,
            profile.id,
            ownerId,
            post.media_type as string,
            accessToken,
          )
          mediaMetrics.push(...metrics)
        } catch (postError) {
          results.push({
            socialProfileId: profile.id,
            postId: post.id,
            synced: false,
            reason: errorMessage(postError),
          })
        }
      }

      const allMetrics = [...accountMetrics, ...mediaMetrics]
      if (allMetrics.length > 0) {
        const { error: upsertError } = await supabase
          .from('platform_metrics')
          .upsert(allMetrics, { onConflict: 'social_profile_id,metric_scope,metric_name,metric_date' })
        if (upsertError) throw upsertError
      }

      results.push({ socialProfileId: profile.id, synced: true, metricsWritten: allMetrics.length })
    } catch (error) {
      results.push({ socialProfileId: profile.id, synced: false, reason: errorMessage(error) })
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
