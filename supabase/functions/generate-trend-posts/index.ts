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
import {
  campaignSlug,
  captionWithLink,
  fetchActiveOffers,
  fetchPerformanceDigest,
  insertShortLinks,
  newSlug,
  offerPromptLines,
  resolveOffer,
  shortLinkUrl,
} from '../_shared/monetization.ts'
import type { PendingShortLink } from '../_shared/monetization.ts'

interface TrendPostIdea {
  title: string
  body: string
  tag: string
  source_url: string
  source_summary: string
  // Present only when the user has active affiliate_offers -- validated
  // against the real offer list before use, never trusted as an id.
  offer_id?: unknown
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
    // Even with an 8%-margin instruction as a separate sentence, real
    // published posts still came back with headline text touching or
    // crossing the left/right edges -- the model was still defaulting to
    // one line sized to fill the width first and treating margin as a
    // secondary preference. Folding the margin/wrap/font-size constraint
    // directly into the MANDATORY sentence (rather than as a follow-up
    // sentence) and bumping 8% -> 12% is meant to make it non-negotiable
    // rather than something the model trades off against "large and bold."
    `MANDATORY, hard constraint: render this exact headline as bold, legible white sans-serif text inside a dark gradient bar across the lower third of the image: "${idea.title}". The text block must stay inset by a clear empty margin of at least 12% of the image width from BOTH the left and right edges -- no letter, stroke, or shadow may ever enter that margin. To satisfy this, shrink the font size and wrap the headline across as many lines as it takes (two, three, or four) rather than ever sizing a line to span the full width edge-to-edge.`,
    `Background scene (photo-realistic, editorial style) illustrating this story: ${idea.title}. Context: ${idea.body}.`,
    'The background scene must NOT contain any other readable text, writing, signage, protest signs, screens, labels, or logos -- the ONLY legible text anywhere in the entire image is the headline described above.',
    `Double-check before finishing: measure the headline's widest rendered line against the canvas width -- if any character falls within 12% of the left or right edge, shrink the font and re-wrap. Confirm the overlay reads exactly "${idea.title}" and nothing else in the image is readable text.`,
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

      // daily_auto_post_cap counts distinct ideas, not post rows -- since
      // each idea now fans out to one row per connected eligible platform
      // (see below), counting rows would let a single connected profile use
      // up the cap N times faster than three connected profiles. All rows
      // for the same idea share the same title, so distinct titles today is
      // the idea count.
      const { data: todaysRows } = await supabase
        .from('posts')
        .select('title')
        .eq('user_id', userId)
        .eq('source', 'auto')
        .eq('media_type', 'image')
        .gte('created_at', startOfDay.toISOString())
      const alreadyToday = new Set((todaysRows ?? []).map((row) => row.title)).size

      // Capped independently of daily_auto_post_cap: even with concurrent
      // image generation, too many at once risks OpenAI rate limits and
      // Supabase's 150s function execution limit. A high daily cap just
      // means more invocations are needed to reach it, not bigger ones.
      const remaining = Math.min(4, Math.max(0, settings.daily_auto_post_cap - alreadyToday))
      if (remaining === 0) {
        results.push({ userId, created: 0, reason: 'daily cap already reached' })
        continue
      }

      // TikTok has no image-posting capability, so it's excluded here (see
      // generate-reel-posts for the video equivalent, which includes it).
      const { data: eligibleProfiles } = await supabase
        .from('social_profiles')
        .select('id, platform')
        .eq('user_id', userId)
        .in('platform', ['instagram', 'x', 'facebook'])
        .eq('connection_status', 'connected')

      // Phase 12 Step 1: every post gets a tracked link to one of these.
      // No offers configured is a valid state (posts just go out untracked,
      // as they did before this phase) -- it must not break generation.
      const offers = await fetchActiveOffers(supabase, userId)
      // Phase 12 Step 3: omitted entirely below the minimum post count.
      const performanceDigest = await fetchPerformanceDigest(supabase, userId)

      const blocklist: string[] = settings.topic_blocklist ?? []
      const prompt = [
        `Search the web for ${remaining} distinct, currently trending topics or news stories`,
        settings.niche_description ? `relevant to this niche: ${settings.niche_description}.` : 'in general consumer/business interest.',
        blocklist.length > 0 ? `Do not use any topic related to: ${blocklist.join(', ')}.` : '',
        `For each trend, draft a short-form social media post (60-100 words) in this brand voice: ${settings.brand_voice || 'clear, friendly, conversational'}.`,
        'Each post must reference a real, specific, currently-trending item you found via search -- do not invent trends.',
        ...offerPromptLines(offers),
        performanceDigest ?? '',
        '',
        'Respond with ONLY a JSON array (no markdown fences, no prose before or after) of objects shaped exactly like:',
        offers.length > 0
          ? '{"title": string, "body": string, "tag": string, "source_url": string, "source_summary": string, "offer_id": string}'
          : '{"title": string, "body": string, "tag": string, "source_url": string, "source_summary": string}',
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
      const pendingLinks: PendingShortLink[] = []
      for (let index = 0; index < ideas.length; index++) {
        const idea = ideas[index]
        const imageResult = imageResults[index]
        if (imageResult.status === 'rejected') {
          // Skip this idea entirely rather than publish an image-less post --
          // Instagram/X cannot publish a text-only feed post via this app.
          const reason = imageResult.reason
          imageFailures.push(reason instanceof Error ? reason.message : 'image generation failed')
          continue
        }
        const offer = resolveOffer(offers, idea.offer_id)
        const base = {
          user_id: userId,
          title: idea.title,
          tag: idea.tag,
          status: 'scheduled' as const,
          source: 'auto' as const,
          trend_source: { url: idea.source_url, summary: idea.source_summary },
          media_url: imageResult.value,
          scheduled_for: new Date(now + (index + 1) * SCHEDULE_SPACING_HOURS * 60 * 60 * 1000).toISOString(),
        }
        // Fan out the same generated image to every connected eligible
        // profile -- the image is only generated once per idea above. If
        // nothing is connected yet, still keep the post as an unassigned
        // draft rather than waste the generation.
        const targets: { id: string | null; platform: string | null }[] =
          eligibleProfiles && eligibleProfiles.length > 0
            ? eligibleProfiles.map((profile) => ({ id: profile.id as string, platform: profile.platform as string }))
            : [{ id: null, platform: null }]

        for (const target of targets) {
          // One short link per post row, not per idea: fan-out already
          // produces a row per platform and short_links.post_id is a
          // single-post FK, so per-row is both the natural shape and free
          // per-platform attribution -- which platform actually converts is
          // otherwise unanswerable.
          //
          // The post id is generated here rather than left to the column
          // default so the links can be built before the insert, without
          // relying on PostgREST returning inserted rows in input order.
          const postId = crypto.randomUUID()
          const slug = offer ? newSlug() : null
          const linkUrl = slug ? shortLinkUrl(supabaseUrl, slug) : null
          rows.push({
            ...base,
            id: postId,
            social_profile_id: target.id,
            body: captionWithLink(idea.body, target.platform, linkUrl, settings.x_inline_links_enabled === true, offer?.disclosure),
          })
          if (offer && slug) {
            pendingLinks.push({
              user_id: userId,
              post_id: postId,
              slug,
              destination_url: offer.destination_url,
              affiliate_offer_id: offer.id,
              utm_source: target.platform ?? 'unassigned',
              utm_medium: 'social',
              utm_campaign: campaignSlug(idea.tag),
            })
          }
        }
      }

      if (rows.length > 0) {
        const { error: insertError } = await supabase.from('posts').insert(rows)
        if (insertError) throw insertError
      }

      // After the posts insert, never before: short_links.post_id is a real
      // FK, and a link whose post failed to insert would be orphaned.
      const linkResult = pendingLinks.length > 0
        ? await insertShortLinks(supabase, pendingLinks)
        : { inserted: 0, failed: [] as string[] }

      results.push({
        userId,
        created: rows.length,
        linksCreated: linkResult.inserted,
        // A failed link means a published caption may point at a slug that
        // resolves to nothing -- worth seeing in the invocation output rather
        // than only discovering from a dead click.
        ...(linkResult.failed.length > 0 ? { failedLinkSlugs: linkResult.failed } : {}),
        ...(offers.length === 0 ? { note: 'no active affiliate_offers -- posts created without tracked links' } : {}),
        ...(performanceDigest ? { performanceDigest: 'included' } : {}),
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
