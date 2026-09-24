// Phase 12 Steps 1 & 3: the pieces both generation functions need to attach
// a tracked offer link to every post they create, and to feed real
// performance data back into the prompt that decides what to post next.
//
// Shared rather than duplicated (unlike the small JSON-parsing helpers each
// function carries its own copy of) because this is ~150 lines of logic with
// real failure modes -- a divergence between the image and video pipelines
// here would silently mean one of them stops earning. Supabase's CLI bundles
// relative imports outside the function directory, so `_shared` deploys with
// each function; it is not itself a deployable function.

// deno-lint-ignore-file no-explicit-any

export interface AffiliateOffer {
  id: string
  program_name: string
  destination_url: string
  keywords: string[]
  category: string | null
  priority: number
}

// Below this many published posts with real metrics, the performance digest
// is omitted from the prompt entirely rather than sent thin -- under-powered
// data would just teach the model noise, confidently.
const MIN_POSTS_FOR_DIGEST = 20
const DIGEST_POST_LIMIT = 20
// Fetched wider than the digest itself on purpose: the most recent posts are
// the ones whose insights haven't synced yet, and fetching exactly
// DIGEST_POST_LIMIT rows before filtering those out would make the gate
// "the last 20 published posts ALL have metrics" rather than "there are 20
// posts with metrics" -- which in practice would almost never be true.
const DIGEST_FETCH_LIMIT = 60

export async function fetchActiveOffers(supabase: any, userId: string): Promise<AffiliateOffer[]> {
  const { data, error } = await supabase
    .from('affiliate_offers')
    .select('id, program_name, destination_url, keywords, category, priority')
    .eq('user_id', userId)
    .eq('active', true)
    .order('priority', { ascending: false })
  if (error) throw error
  return (data ?? []) as AffiliateOffer[]
}

// Prompt lines describing the available offers. Claude picks the offer inside
// the call it already makes rather than via a second API call or a keyword
// matcher here -- it has the drafted post in context, which is exactly what
// the choice depends on.
export function offerPromptLines(offers: AffiliateOffer[]): string[] {
  if (offers.length === 0) return []
  const list = offers
    .map((offer) => {
      const parts = [`id: ${offer.id}`, `program: ${offer.program_name}`]
      if (offer.category) parts.push(`category: ${offer.category}`)
      if (offer.keywords.length > 0) parts.push(`fits topics about: ${offer.keywords.join(', ')}`)
      return `- ${parts.join(' | ')}`
    })
    .join('\n')
  return [
    '',
    'Each post also carries a tracked link to one of the offers below. Pick the offer that fits the post most naturally and return its id as "offer_id". If none fits well, still pick the closest one -- every post must carry a link.',
    list,
    '',
  ]
}

// Never returns null when any offer exists: a hallucinated or missing
// offer_id falls back to the highest-priority active offer, since a
// link-less post is the exact failure mode this whole phase exists to fix.
export function resolveOffer(offers: AffiliateOffer[], offerId: unknown): AffiliateOffer | null {
  if (offers.length === 0) return null
  if (typeof offerId === 'string') {
    const match = offers.find((offer) => offer.id === offerId)
    if (match) return match
  }
  return offers[0] // fetchActiveOffers orders by priority desc
}

export function newSlug(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10)
}

export function shortLinkUrl(supabaseUrl: string, slug: string): string {
  return `${supabaseUrl}/functions/v1/redirect/${slug}`
}

// Link placement differs per platform and getting it wrong is either wasted
// caption space or wasted money:
// - instagram/tiktok: captions are NOT clickable, so a URL in the caption
//   accomplishes nothing -- those platforms reach the link via the bio page.
// - facebook: clickable and free.
// - x: clickable, but X bills $0.20/post with a URL vs $0.015 without (13x),
//   so it's behind automation_settings.x_inline_links_enabled (default off).
export function captionWithLink(
  body: string,
  platform: string | null | undefined,
  url: string | null,
  xInlineLinksEnabled: boolean,
): string {
  if (!url) return body
  if (platform === 'facebook' || (platform === 'x' && xInlineLinksEnabled)) {
    return `${body}\n\n${url}`
  }
  return body
}

export interface PendingShortLink {
  user_id: string
  post_id: string
  slug: string
  destination_url: string
  affiliate_offer_id: string
  utm_source: string
  utm_medium: string
  utm_campaign: string | null
}

// Inserted one row at a time on purpose: a slug collision (or any other
// single-row failure) would abort a batch insert and leave every other post
// in the run link-less, which is worse than losing one link.
//
// Retried once, with the same slug rather than a fresh one: by this point the
// slug is already written into the caption of a post that will publish, so a
// different slug would resolve to nothing when someone clicks it. The retry
// is for a transient write failure; a genuine slug collision (10 hex chars)
// will just fail twice, which is what the returned failure list is for.
export async function insertShortLinks(
  supabase: any,
  links: PendingShortLink[],
): Promise<{ inserted: number; failed: string[] }> {
  let inserted = 0
  const failed: string[] = []
  for (const link of links) {
    let { error } = await supabase.from('short_links').insert(link)
    if (error) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      ;({ error } = await supabase.from('short_links').insert(link))
    }
    if (error) failed.push(link.slug)
    else inserted++
  }
  return { inserted, failed }
}

// A compact digest of how recent posts actually performed, for the prompt.
// Returns null (rather than an empty or partial block) when there isn't
// enough real data yet -- see MIN_POSTS_FOR_DIGEST.
export async function fetchPerformanceDigest(supabase: any, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('post_performance')
    .select('title, tag, platform, media_type, reach, clicks, revenue, published_at')
    .eq('user_id', userId)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .order('published_at', { ascending: false })
    .limit(DIGEST_FETCH_LIMIT)
  if (error || !data) return null

  // "Posts with metrics" is the real bar, not "posts published" -- a post
  // whose insights haven't synced yet reads as a zero-reach failure and
  // would teach exactly the wrong lesson.
  const withMetrics = data.filter((row: any) => Number(row.reach) > 0)
  if (withMetrics.length < MIN_POSTS_FOR_DIGEST) return null

  const lines = withMetrics.slice(0, DIGEST_POST_LIMIT).map((row: any) => {
    const reach = Number(row.reach)
    const clicks = Number(row.clicks)
    const revenue = Number(row.revenue)
    const clickRate = reach > 0 ? ((clicks / reach) * 100).toFixed(2) : '0.00'
    return `- "${row.title}" [${row.media_type}${row.platform ? `, ${row.platform}` : ''}${row.tag ? `, ${row.tag}` : ''}] reach ${reach}, clicks ${clicks} (${clickRate}% of reach), revenue ${revenue}`
  })

  return [
    '',
    'Here is how this account\'s own recent posts actually performed. Bias toward the topics, angles, and formats in the top quartile by clicks-as-a-percentage-of-reach, and away from the bottom quartile. Do not copy these posts or reuse their trends -- they are evidence about what resonates, not source material:',
    ...lines,
    '',
  ].join('\n')
}
