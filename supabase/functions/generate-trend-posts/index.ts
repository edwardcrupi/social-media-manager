// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs).
// For each user with automation_settings.auto_posting_enabled = true, asks
// Claude to search the web for trending topics in their niche and draft a
// handful of posts, generates an image per post via OpenAI, uploads it to
// Supabase Storage, and inserts everything into `posts` as
// `status: 'scheduled'` -- publish-scheduled-posts later actually posts
// these to the connected Instagram account.
//
// This intentionally skips structured outputs (`output_config.format`) in
// favor of a plain-text-JSON instruction: the interaction between structured
// outputs and server-side tools like web_search isn't documented, while
// "search, then reply with ONLY a JSON array" is a well-trodden, robust
// pattern that's easy to defend with a manual parse + fallback below.
import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

interface TrendPostIdea {
  title: string
  body: string
  tag: string
  source_url: string
  source_summary: string
}

const SCHEDULE_SPACING_HOURS = 12
const IMAGE_MODEL = 'gpt-image-2.5-flare'

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

function isTrendPostIdea(value: unknown): value is TrendPostIdea {
  if (typeof value !== 'object' || value === null) return false
  const idea = value as Record<string, unknown>
  return (
    typeof idea.title === 'string' &&
    typeof idea.body === 'string' &&
    typeof idea.tag === 'string' &&
    typeof idea.source_url === 'string' &&
    typeof idea.source_summary === 'string'
  )
}

// deno-lint-ignore no-explicit-any
async function generateAndUploadImage(supabase: any, openaiApiKey: string, userId: string, idea: TrendPostIdea) {
  const prompt = [
    `MANDATORY: render this exact headline as large, bold, legible white sans-serif text inside a dark gradient bar across the lower third of the image: "${idea.title}"`,
    `Background scene (photo-realistic, editorial style) illustrating this story: ${idea.title}. Context: ${idea.body}.`,
    'The background scene must NOT contain any other readable text, writing, signage, protest signs, screens, labels, or logos -- the ONLY legible text anywhere in the entire image is the headline described above.',
    `Double-check before finishing: the headline text overlay reads exactly "${idea.title}" and nothing else in the image is readable text.`,
  ].join(' ')
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: '1024x1024', quality: 'high' }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error?.message ?? 'Image generation failed')
  const b64 = json.data?.[0]?.b64_json
  if (!b64) throw new Error('No image data returned from OpenAI')

  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const path = `${userId}/${crypto.randomUUID()}.png`
  const { error: uploadError } = await supabase.storage
    .from('post-images')
    .upload(path, bytes, { contentType: 'image/png' })
  if (uploadError) throw uploadError

  const { data: publicUrlData } = supabase.storage.from('post-images').getPublicUrl(path)
  return publicUrlData.publicUrl as string
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anthropicApiKey || !openaiApiKey) {
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
        .gte('created_at', startOfDay.toISOString())

      // Capped independently of daily_auto_post_cap: even with concurrent
      // image generation, too many at once risks OpenAI rate limits and
      // Supabase's 150s function execution limit. A high daily cap just
      // means more invocations are needed to reach it, not bigger ones.
      const remaining = Math.min(4, Math.max(0, settings.daily_auto_post_cap - (alreadyToday ?? 0)))
      if (remaining === 0) {
        results.push({ userId, created: 0, reason: 'daily cap already reached' })
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
        `For each trend, draft a short-form social media post (60-100 words) in this brand voice: ${settings.brand_voice || 'clear, friendly, conversational'}.`,
        'Each post must reference a real, specific, currently-trending item you found via search -- do not invent trends.',
        '',
        'Respond with ONLY a JSON array (no markdown fences, no prose before or after) of objects shaped exactly like:',
        '{"title": string, "body": string, "tag": string, "source_url": string, "source_summary": string}',
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

      const ideas = parsed.filter(isTrendPostIdea).slice(0, remaining)
      const now = Date.now()
      const imageFailures: string[] = []

      // Run image generations concurrently -- Supabase Edge Functions have a
      // hard 150s execution limit, and generating images sequentially for
      // more than 2-3 ideas blows past that. Concurrent requests bound the
      // wall-clock time to the slowest single image instead of the sum.
      const imageResults = await Promise.allSettled(
        ideas.map((idea) => generateAndUploadImage(supabase, openaiApiKey, userId, idea)),
      )

      const rows = []
      for (let index = 0; index < ideas.length; index++) {
        const idea = ideas[index]
        const imageResult = imageResults[index]
        if (imageResult.status === 'rejected') {
          // Skip this idea entirely rather than publish an image-less post --
          // Instagram cannot publish a text-only feed post.
          const reason = imageResult.reason
          imageFailures.push(reason instanceof Error ? reason.message : 'image generation failed')
          continue
        }
        rows.push({
          user_id: userId,
          social_profile_id: instagramProfile?.id ?? null,
          title: idea.title,
          body: idea.body,
          tag: idea.tag,
          status: 'scheduled' as const,
          source: 'auto' as const,
          trend_source: { url: idea.source_url, summary: idea.source_summary },
          media_url: imageResult.value,
          scheduled_for: new Date(now + (index + 1) * SCHEDULE_SPACING_HOURS * 60 * 60 * 1000).toISOString(),
        })
      }

      if (rows.length > 0) {
        const { error: insertError } = await supabase.from('posts').insert(rows)
        if (insertError) throw insertError
      }

      results.push({
        userId,
        created: rows.length,
        ...(imageFailures.length > 0 ? { imageFailures } : {}),
      })
    } catch (error) {
      results.push({ userId, created: 0, reason: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
