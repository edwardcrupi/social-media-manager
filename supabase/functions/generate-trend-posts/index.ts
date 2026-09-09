// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs).
// For each user with automation_settings.auto_posting_enabled = true, asks
// Claude to search the web for trending topics in their niche and draft a
// handful of posts, then inserts them into `posts` as `status: 'scheduled'`.
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anthropicApiKey) {
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

      const remaining = Math.max(0, settings.daily_auto_post_cap - (alreadyToday ?? 0))
      if (remaining === 0) {
        results.push({ userId, created: 0, reason: 'daily cap already reached' })
        continue
      }

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
      const rows = ideas.map((idea, index) => ({
        user_id: userId,
        title: idea.title,
        body: idea.body,
        tag: idea.tag,
        status: 'scheduled' as const,
        source: 'auto' as const,
        trend_source: { url: idea.source_url, summary: idea.source_summary },
        scheduled_for: new Date(now + (index + 1) * SCHEDULE_SPACING_HOURS * 60 * 60 * 1000).toISOString(),
      }))

      if (rows.length > 0) {
        const { error: insertError } = await supabase.from('posts').insert(rows)
        if (insertError) throw insertError
      }

      results.push({ userId, created: rows.length })
    } catch (error) {
      results.push({ userId, created: 0, reason: error instanceof Error ? error.message : 'unknown error' })
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
