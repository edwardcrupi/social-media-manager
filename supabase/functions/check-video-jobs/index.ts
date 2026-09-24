// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs,
// every 3-5 min recommended). Polls Seedance (BytePlus ModelArk) for posts
// stuck in status='generating', and on success downloads the finished video
// into Supabase Storage and flips the post to 'scheduled' so
// publish-scheduled-posts can pick it up later. Video generation commonly
// takes minutes, well past Supabase's 150s function execution limit, which
// is exactly why this is a separate polling function rather than part of
// generate-reel-posts.
//
// A job that fails specifically because Seedance's own auto-composed audio
// track was flagged for copyright (not the visuals) gets one automatic
// resubmit with audio disabled rather than being marked failed outright --
// see isAudioCopyrightFailure/resubmitWithoutAudio below.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const ARK_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3'
const SCHEDULE_DELAY_HOURS = 1
const VIDEO_MODEL = 'dreamina-seedance-2-5-260628'
const VIDEO_DURATION_SECONDS = 15

// Seedance's own auto-composed background music/audio (generate-reel-posts
// always submits with generate_audio: true and no audio direction in the
// prompt -- the visuals are all that's actually specified) occasionally gets
// flagged as resembling copyrighted audio, distinct from a visual-content
// rejection. Since nothing about the requested video changes, resubmitting
// the same prompt with audio turned off recovers the idea instead of losing
// it outright. This can't loop: a generate_audio: false resubmit has no
// audio to be flagged for copyright, so this same branch can't fire again
// on its own retry.
function isAudioCopyrightFailure(reason: string): boolean {
  return /audio/i.test(reason) && /copyright/i.test(reason)
}

async function resubmitWithoutAudio(arkApiKey: string, videoPrompt: string): Promise<string> {
  const res = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${arkApiKey}` },
    body: JSON.stringify({
      model: VIDEO_MODEL,
      content: [{ type: 'text', text: videoPrompt }],
      generate_audio: false,
      ratio: '9:16',
      duration: VIDEO_DURATION_SECONDS,
      output_format: 'mp4',
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to resubmit video generation job without audio')
  if (!json.id) throw new Error('No task id returned from Seedance on audio-less resubmit')
  return json.id as string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const arkApiKey = Deno.env.get('ARK_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !arkApiKey) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  const { data: pendingPosts, error: pendingError } = await supabase
    .from('posts')
    .select('id, user_id, video_job_id, video_prompt')
    .eq('status', 'generating')
    .not('video_job_id', 'is', null)

  if (pendingError) {
    return new Response(JSON.stringify({ error: pendingError.message }), { status: 500 })
  }

  // Since generate-reel-posts fans one video job out to a post row per
  // connected eligible profile (Instagram/TikTok/X), multiple rows here can
  // share the same video_job_id -- group by job so a still-processing job
  // is only polled once, and a finished one is only downloaded from ARK and
  // re-uploaded to Storage once (all sharing rows point at that one upload)
  // rather than once per platform.
  const postsByJobId = new Map<string, { id: string; user_id: string; video_prompt: string | null }[]>()
  for (const post of pendingPosts ?? []) {
    const jobId = post.video_job_id as string
    const existing = postsByJobId.get(jobId)
    if (existing) existing.push(post)
    else postsByJobId.set(jobId, [post])
  }

  const results = []

  for (const [jobId, posts] of postsByJobId) {
    const postIds = posts.map((post) => post.id)
    try {
      const statusRes = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${jobId}`, {
        headers: { Authorization: `Bearer ${arkApiKey}` },
      })
      const statusJson = await statusRes.json()
      if (!statusRes.ok) throw new Error(statusJson?.error?.message ?? 'Failed to check video job status')

      if (statusJson.status !== 'succeeded') {
        if (typeof statusJson.status === 'string' && statusJson.status.includes('fail')) {
          const failureReason = statusJson.error?.message ?? statusJson.error?.code ?? 'Video generation failed'
          const videoPrompt = posts[0].video_prompt

          if (isAudioCopyrightFailure(failureReason) && videoPrompt) {
            try {
              const newJobId = await resubmitWithoutAudio(arkApiKey, videoPrompt)
              await supabase.from('posts').update({ video_job_id: newJobId }).in('id', postIds)
              results.push({ postIds, status: 'retrying_without_audio', previousJobId: jobId, newJobId })
              continue
            } catch (retryError) {
              const retryFailureReason = `${failureReason} (audio-less retry also failed: ${retryError instanceof Error ? retryError.message : 'unknown error'})`
              await supabase.from('posts').update({ status: 'failed', failure_reason: retryFailureReason }).in('id', postIds)
              results.push({ postIds, status: 'failed', reason: retryFailureReason })
              continue
            }
          }

          await supabase.from('posts').update({ status: 'failed', failure_reason: failureReason }).in('id', postIds)
          results.push({ postIds, status: 'failed', reason: failureReason })
        } else {
          results.push({ postIds, status: statusJson.status ?? 'unknown', stillWaiting: true })
        }
        continue
      }

      const videoUrl = statusJson.content?.video_url
      if (!videoUrl) throw new Error('Seedance reported success but returned no video_url')

      const videoRes = await fetch(videoUrl, { headers: { Authorization: `Bearer ${arkApiKey}` } })
      if (!videoRes.ok) throw new Error(`Failed to download generated video (HTTP ${videoRes.status})`)
      const videoBytes = new Uint8Array(await videoRes.arrayBuffer())

      const path = `${posts[0].user_id}/${crypto.randomUUID()}.mp4`
      const { error: uploadError } = await supabase.storage
        .from('post-videos')
        .upload(path, videoBytes, { contentType: 'video/mp4' })
      if (uploadError) throw uploadError

      const { data: publicUrlData } = supabase.storage.from('post-videos').getPublicUrl(path)

      const { error: updateError } = await supabase
        .from('posts')
        .update({
          media_url: publicUrlData.publicUrl,
          status: 'scheduled',
          scheduled_for: new Date(Date.now() + SCHEDULE_DELAY_HOURS * 60 * 60 * 1000).toISOString(),
        })
        .in('id', postIds)
      if (updateError) throw updateError

      results.push({ postIds, status: 'ready', mediaUrl: publicUrlData.publicUrl })
    } catch (error) {
      results.push({ postIds, error: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
