// Deno edge function, run on a schedule (Supabase Dashboard -> Cron Jobs).
// Drafts short vertical-video Reel concepts from trending topics (same
// approach as generate-trend-posts) and submits each to Seedance 2.5 via
// BytePlus ModelArk for video generation. Video generation is async and can
// take minutes, so this function only *submits* jobs -- it does not wait for
// them. check-video-jobs (a separate scheduled function) polls for
// completion and turns a finished job into a publishable post.
import Anthropic from 'npm:@anthropic-ai/sdk@0.124.0'
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import {
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

interface ReelIdea {
  title: string
  video_prompt: string
  caption: string
  tag: string
  source_url: string
  source_summary: string
  // Present only when the user has active affiliate_offers -- validated
  // against the real offer list before use, never trusted as an id.
  offer_id?: unknown
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

      // daily_reel_cap counts distinct ideas, not post rows -- see the same
      // comment in generate-trend-posts. All rows for the same idea share
      // the same title, so distinct titles today is the idea count.
      const { data: todaysRows } = await supabase
        .from('posts')
        .select('title')
        .eq('user_id', userId)
        .eq('source', 'auto')
        .eq('media_type', 'video')
        .gte('created_at', startOfDay.toISOString())
      const alreadyToday = new Set((todaysRows ?? []).map((row) => row.title)).size

      // Capped at 2 per invocation regardless of daily_reel_cap, same
      // reasoning as generate-trend-posts: protects against one huge,
      // expensive run if the cap is set high.
      const remaining = Math.min(2, Math.max(0, settings.daily_reel_cap - alreadyToday))
      if (remaining === 0) {
        results.push({ userId, created: 0, reason: 'daily reel cap already reached' })
        continue
      }

      // Unlike generate-trend-posts, TikTok is included here -- it only
      // supports video, which is exactly what this function produces.
      const { data: eligibleProfiles } = await supabase
        .from('social_profiles')
        .select('id, platform')
        .eq('user_id', userId)
        .in('platform', ['instagram', 'tiktok', 'x', 'facebook'])
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
        `For each trend, describe a ${VIDEO_DURATION_SECONDS}-second vertical (9:16) video Reel concept and a short caption in this brand voice: ${settings.brand_voice || 'clear, friendly, conversational'}.`,
        'Each concept must reference a real, specific, currently-trending item you found via search -- do not invent trends.',
        'The video_prompt should describe visuals, motion, and pacing concretely enough for a text-to-video model to render -- not just restate the headline.',
        // Instagram Reels overlays its own UI (captions bar, profile info,
        // like/comment icons) across the outer margin of the frame, and a
        // model given no sizing guidance tends to render on-screen text
        // edge-to-edge -- which then reads as cut off in the actual app even
        // though the raw video technically contains it in full.
        'If the video_prompt calls for any on-screen headline or caption text, this is a hard constraint, not a preference: keep it within Instagram Reels\' safe zone, centered horizontally, sized to fit comfortably within the middle 76% of the frame width, wrapped across as many short lines as it takes (two, three, or four) rather than ever sizing a line to span edge-to-edge, with a clear empty margin of at least 12% of the frame on every edge that no character may enter.',
        // Seedance's own content-moderation rejects finished videos outright
        // (no partial credit, no retry within the same job) for scenes it
        // reads as depicting the categories below -- discovered after a
        // real generation was flagged and silently dropped for a scene
        // built around covert/hidden-camera filming. These instructions
        // steer the *visual* description away from literal depictions of
        // sensitive scenarios, even when the underlying news topic itself
        // is fine to cover in the caption/title.
        'The video_prompt must avoid visuals that commonly trigger video-generation content moderation, even when the underlying news topic is otherwise fine to reference in the title/caption: no depictions of covert or hidden-camera filming/surveillance/spying, no realistic violence, weapons, or gore, no sexual or suggestive content, no self-harm, no illegal drug use, no hate symbols or extremist imagery, and no real, identifiable private individuals shown in a compromising or defamatory situation.',
        'Prefer visual metaphors, graphics, text-on-screen, or abstract/symbolic representation over literally staging a sensitive scenario -- e.g. depict a story about surveillance via glowing data streams or an eye-shaped icon rather than a person secretly filming someone.',
        // A second real rejection (2026-09-18, "the output video may contain
        // sensitive information") hit a prompt with no obviously sensitive
        // subject matter at all -- just an AI story illustrated as one
        // glowing orb literally assembling a second, smaller orb beneath it,
        // i.e. an AI autonomously building/replicating another AI. That
        // recursive self-improvement imagery is the most likely trigger, so
        // steer away from depicting it literally the same way surveillance
        // imagery is steered away from above, without banning AI-building-AI
        // stories from being covered at all.
        'When the story is about one AI system training, building, or improving another AI system, avoid depicting that literally as one entity autonomously constructing, assembling, or replicating a copy of another (e.g. an orb building a smaller orb, a robot building another robot) -- prefer a visual metaphor that implies progress or capability growth without showing autonomous self-replication, such as a single evolving/upgrading shape, a growing network graph, an ascending chart, or a tool being refined on a workbench by an unseen hand.',
        ...offerPromptLines(offers),
        performanceDigest ?? '',
        '',
        'Respond with ONLY a JSON array (no markdown fences, no prose before or after) of objects shaped exactly like:',
        offers.length > 0
          ? '{"title": string, "video_prompt": string, "caption": string, "tag": string, "source_url": string, "source_summary": string, "offer_id": string}'
          : '{"title": string, "video_prompt": string, "caption": string, "tag": string, "source_url": string, "source_summary": string}',
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
      const pendingLinks: PendingShortLink[] = []
      const submitFailures: string[] = []
      for (let index = 0; index < ideas.length; index++) {
        const idea = ideas[index]
        const jobResult = jobResults[index]
        if (jobResult.status === 'rejected') {
          const reason = jobResult.reason
          submitFailures.push(reason instanceof Error ? reason.message : 'video job submission failed')
          continue
        }
        const offer = resolveOffer(offers, idea.offer_id)
        const base = {
          user_id: userId,
          title: idea.title,
          tag: idea.tag,
          status: 'generating' as const,
          source: 'auto' as const,
          media_type: 'video' as const,
          video_job_id: jobResult.value,
          video_prompt: idea.video_prompt,
          trend_source: { url: idea.source_url, summary: idea.source_summary },
        }
        // Fan out to every connected eligible profile -- the video job is
        // only submitted once per idea above, so every row here shares the
        // same video_job_id. check-video-jobs groups by video_job_id so the
        // finished render is only downloaded/re-uploaded once and applied to
        // every matching row, not once per platform.
        const targets: { id: string | null; platform: string | null }[] =
          eligibleProfiles && eligibleProfiles.length > 0
            ? eligibleProfiles.map((profile) => ({ id: profile.id as string, platform: profile.platform as string }))
            : [{ id: null, platform: null }]

        for (const target of targets) {
          // One short link per post row -- see the same comment in
          // generate-trend-posts. The post id is generated here so the links
          // can be built before the insert without relying on PostgREST
          // returning inserted rows in input order.
          const postId = crypto.randomUUID()
          const slug = offer ? newSlug() : null
          const linkUrl = slug ? shortLinkUrl(supabaseUrl, slug) : null
          rows.push({
            ...base,
            id: postId,
            social_profile_id: target.id,
            body: captionWithLink(idea.caption, target.platform, linkUrl, settings.x_inline_links_enabled === true),
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
              utm_campaign: idea.tag || null,
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
        submitted: rows.length,
        linksCreated: linkResult.inserted,
        // A failed link means a published caption may point at a slug that
        // resolves to nothing -- worth seeing in the invocation output rather
        // than only discovering from a dead click.
        ...(linkResult.failed.length > 0 ? { failedLinkSlugs: linkResult.failed } : {}),
        ...(offers.length === 0 ? { note: 'no active affiliate_offers -- posts created without tracked links' } : {}),
        ...(performanceDigest ? { performanceDigest: 'included' } : {}),
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
