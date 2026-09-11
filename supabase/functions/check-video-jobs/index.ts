// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs,
// every 3-5 min recommended). Polls Seedance (BytePlus ModelArk) for posts
// stuck in status='generating', and on success downloads the finished video
// into Supabase Storage and flips the post to 'scheduled' so
// publish-scheduled-posts can pick it up later. Video generation commonly
// takes minutes, well past Supabase's 150s function execution limit, which
// is exactly why this is a separate polling function rather than part of
// generate-reel-posts.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const ARK_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3'
const SCHEDULE_DELAY_HOURS = 1

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
    .select('id, user_id, video_job_id')
    .eq('status', 'generating')
    .not('video_job_id', 'is', null)

  if (pendingError) {
    return new Response(JSON.stringify({ error: pendingError.message }), { status: 500 })
  }

  const results = []

  for (const post of pendingPosts ?? []) {
    try {
      const statusRes = await fetch(`${ARK_BASE_URL}/contents/generations/tasks/${post.video_job_id}`, {
        headers: { Authorization: `Bearer ${arkApiKey}` },
      })
      const statusJson = await statusRes.json()
      if (!statusRes.ok) throw new Error(statusJson?.error?.message ?? 'Failed to check video job status')

      if (statusJson.status !== 'succeeded') {
        if (typeof statusJson.status === 'string' && statusJson.status.includes('fail')) {
          await supabase.from('posts').delete().eq('id', post.id)
          results.push({ postId: post.id, status: 'failed', removed: true })
        } else {
          results.push({ postId: post.id, status: statusJson.status ?? 'unknown', stillWaiting: true })
        }
        continue
      }

      const videoUrl = statusJson.content?.video_url
      if (!videoUrl) throw new Error('Seedance reported success but returned no video_url')

      const videoRes = await fetch(videoUrl, { headers: { Authorization: `Bearer ${arkApiKey}` } })
      if (!videoRes.ok) throw new Error(`Failed to download generated video (HTTP ${videoRes.status})`)
      const videoBytes = new Uint8Array(await videoRes.arrayBuffer())

      const path = `${post.user_id}/${crypto.randomUUID()}.mp4`
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
        .eq('id', post.id)
      if (updateError) throw updateError

      results.push({ postId: post.id, status: 'ready', mediaUrl: publicUrlData.publicUrl })
    } catch (error) {
      results.push({ postId: post.id, error: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
