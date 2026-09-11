// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs).
// Drafts short vertical-video Reel concepts from trending topics (same
// approach as generate-trend-posts) and submits each to Seedance 2.5 via
// BytePlus ModelArk for video generation. Video generation is async and can
// take minutes, so this function only *submits* jobs -- it does not wait for
// them. check-video-jobs (a separate scheduled function) polls for
// completion and turns a finished job into a publishable post.
import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

interface ReelIdea {
  title: string
  video_prompt: string
  caption: string
  tag: string
  source_url: string
  source_summary: string
}

const ARK_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3'
const VIDEO_MODEL = 'dreamina-seedance-2-5-260628'
const VIDEO_DURATION_SECONDS = 15

function extractJsonArray(text: string): unknown {
  try {
    return JSON.parse(text.trim())
  } catch {
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end === -1 || end < start) throw new Error('No JSON array found in model output')
    return JSON.parse(text.slice(start, end + 1))
  }
}

function isReelIdea(value: unknown): value is ReelIdea {
  if (typeof value !== 'object' || value === null) return false
  const idea = value as Record<string, unknown>
  return (
    typeof idea.title === 'string' &&
    typeof idea.video_prompt === 'string' &&
    typeof idea.caption === 'string' &&
    typeof idea.tag === 'string' &&
    typeof idea.source_url === 'string' &&
    typeof idea.source_summary === 'string'
  )
}

async function submitVideoJob(arkApiKey: string, idea: ReelIdea): Promise<string> {
  const res = await fetch(`${ARK_BASE_URL}/contents/generations/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${arkApiKey}` },
    body: JSON.stringify({
      model: VIDEO_MODEL,
      content: [{ type: 'text', text: idea.video_prompt }],
      generate_audio: true,
      ratio: '9:16',
      duration: VIDEO_DURATION_SECONDS,
      output_format: 'mp4',
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Failed to submit video generation job')
  if (!json.id) throw new Error('No task id returned from Seedance')
  return json.id as string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const arkApiKey = Deno.env.get('ARK_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anthropicApiKey || !arkApiKey) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const anthropic = new Anthropic({ apiKey: anthropicApiKey })

  const { data: settingsRows, error: settingsError } = await supabase
    .from('automation_settings')
    .select('*')
    .eq('auto_posting_enabled', true)

  if (settingsError) {
    return new Response(JSON.stringify({ error: settingsError.message }), { status: 500 })
  }

  const results = []

  for (const settings of settingsRows ?? []) {
    const userId = settings.user_id as string
    try {
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)

      const { count: alreadyToday } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('source', 'auto')
        .eq('media_type', 'video')
        .gte('created_at', startOfDay.toISOString())

      // Capped at 2 per invocation regardless of daily_reel_cap, same
      // reasoning as generate-trend-posts: protects against one huge,
      // expensive run if the cap is set high.
      const remaining = Math.min(2, Math.max(0, settings.daily_reel_cap - (alreadyToday ?? 0)))
      if (remaining === 0) {
        results.push({ userId, created: 0, reason: 'daily reel cap already reached' })
        continue
      }

      const { data: instagramProfile } = await supabase
        .from('social_profiles')
        .select('id')
        .eq('user_id', userId)
        .eq('platform', 'instagram')
        .eq('connection_status', 'connected')
        .maybeSingle()

      const blocklist: string[] = settings.topic_blocklist ?? []
      const prompt = [
        `Search the web for ${remaining} distinct, currently trending topics or news stories`,
        settings.niche_description ? `relevant to this niche: ${settings.niche_description}.` : 'in general consumer/business interest.',
        blocklist.length > 0 ? `Do not use any topic related to: ${blocklist.join(', ')}.` : '',
        `For each trend, describe a ${VIDEO_DURATION_SECONDS}-second vertical (9:16) video Reel concept and a short caption in this brand voice: ${settings.brand_voice || 'clear, friendly, conversational'}.`,
        'Each concept must reference a real, specific, currently-trending item you found via search -- do not invent trends.',
        'The video_prompt should describe visuals, motion, and pacing concretely enough for a text-to-video model to render -- not just restate the headline.',
        '',
        'Respond with ONLY a JSON array (no markdown fences, no prose before or after) of objects shaped exactly like:',
        '{"title": string, "video_prompt": string, "caption": string, "tag": string, "source_url": string, "source_summary": string}',
      ]
        .filter(Boolean)
        .join(' ')

      const response = await anthropic.messages.create({
        model: 'claude-opus-5',
        max_tokens: 8000,
        output_config: { effort: 'medium' },
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: prompt }],
      })

      if (response.stop_reason === 'refusal') {
        results.push({ userId, created: 0, reason: 'model declined the request' })
        continue
      }

      const textBlock = [...response.content].reverse().find((block) => block.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        results.push({ userId, created: 0, reason: 'no text in model response' })
        continue
      }

      const parsed = extractJsonArray(textBlock.text)
      if (!Array.isArray(parsed)) {
        results.push({ userId, created: 0, reason: 'model output was not a JSON array' })
        continue
      }

      const ideas = parsed.filter(isReelIdea).slice(0, remaining)
      const jobResults = await Promise.allSettled(ideas.map((idea) => submitVideoJob(arkApiKey, idea)))

      const rows = []
      const submitFailures: string[] = []
      for (let index = 0; index < ideas.length; index++) {
        const idea = ideas[index]
        const jobResult = jobResults[index]
        if (jobResult.status === 'rejected') {
          const reason = jobResult.reason
          submitFailures.push(reason instanceof Error ? reason.message : 'video job submission failed')
          continue
        }
        rows.push({
          user_id: userId,
          social_profile_id: instagramProfile?.id ?? null,
          title: idea.title,
          body: idea.caption,
          tag: idea.tag,
          status: 'generating' as const,
          source: 'auto' as const,
          media_type: 'video' as const,
          video_job_id: jobResult.value,
          trend_source: { url: idea.source_url, summary: idea.source_summary },
        })
      }

      if (rows.length > 0) {
        const { error: insertError } = await supabase.from('posts').insert(rows)
        if (insertError) throw insertError
      }

      results.push({
        userId,
        submitted: rows.length,
        ...(submitFailures.length > 0 ? { submitFailures } : {}),
      })
    } catch (error) {
      results.push({ userId, submitted: 0, reason: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
