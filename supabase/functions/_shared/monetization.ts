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
import { truncateForX, xCaptionBudget } from './x-text.ts'

export interface AffiliateOffer {
  id: string
  program_name: string
  destination_url: string
  keywords: string[]
  category: string | null
  priority: number
  // Appended wherever this offer's link appears in a caption. Required for
  // affiliate links (FTC endorsement guides, and Amazon's Associates
  // agreement mandates specific wording); null for your own destinations.
  disclosure: string | null
}

// Below this many published posts with real metrics, the performance digest
// is omitted from the prompt entirely rather than sent thin -- under-powered
// data would just teach the model noise, confidently.
const MIN_POSTS_FOR_DIGEST = 20
const DIGEST_POST_LIMIT = 20

export async function fetchActiveOffers(supabase: any, userId: string): Promise<AffiliateOffer[]> {
  const { data, error } = await supabase
    .from('affiliate_offers')
    .select('id, program_name, destination_url, keywords, category, priority, disclosure')
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
    // The same caption is published to every connected platform, but the URL
    // is only appended on the ones with clickable captions. A caption ending
    // in "here ->" therefore points at nothing on Instagram and X. Observed
    // on the first real run of this feature, not hypothetical.
    'The caption text itself must read completely naturally with NO link in it, because the link is only appended on some platforms -- Instagram and TikTok captions are not clickable and will never show it. Never write "link below", "link in caption", "tap here", "here ->", or any phrasing that assumes the reader can see a URL. Do not append the URL yourself; that is handled automatically.',
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

// The post's tag is used as utm_campaign, and tags come back as hashtag
// strings ("#MetaCharm #AIgadgets"), which land in analytics URL-encoded and
// unreadable. Normalized to a plain campaign token instead.
export function campaignSlug(tag: string | null | undefined): string | null {
  if (!tag) return null
  const cleaned = tag
    .toLowerCase()
    .replace(/#/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return cleaned || null
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
  disclosure?: string | null,
): string {
  if (!url) return body
  if (platform === 'facebook' || (platform === 'x' && xInlineLinksEnabled)) {
    // The disclosure travels with the link: it belongs in the caption where
    // the link actually appears, not somewhere a reader has to go looking.
    const tail = disclosure ? `${disclosure}\n${url}` : url
    return `${body}\n\n${tail}`
  }
  return body
}

// Builds the caption for one platform's post row.
//
// X gets its own separately-drafted caption rather than the long one cut down
// to size. Instagram captions run 60-100 words, which is roughly double X's
// limit, so truncating produced a post that stopped mid-sentence -- legal,
// but bad writing published automatically to a public account. The model
// drafts `x_caption` to a budget instead, and truncateForX stays as a guard
// for the cases that budget can't cover (a missing or over-long x_caption, a
// manually-created post, a row generated before x_caption existed).
export function captionForPlatform(args: {
  platform: string | null
  body: string
  xCaption?: unknown
  url: string | null
  xInlineLinksEnabled: boolean
  disclosure: string | null
}): string {
  const { platform, body, xCaption, url, xInlineLinksEnabled, disclosure } = args
  if (platform !== 'x') {
    return captionWithLink(body, platform, url, xInlineLinksEnabled, disclosure)
  }
  const drafted = typeof xCaption === 'string' && xCaption.trim().length > 0 ? xCaption.trim() : body
  return truncateForX(captionWithLink(drafted, 'x', url, xInlineLinksEnabled, disclosure))
}

// Prompt lines asking for the X-native caption, sized to whatever will be
// appended to it on this account's configuration.
export function xCaptionPromptLines(
  offers: AffiliateOffer[],
  xInlineLinksEnabled: boolean,
): string[] {
  // The offer (and so the disclosure) is chosen by the model after this
  // prompt is built, so budget against the longest disclosure on file.
  const longestDisclosure = offers
    .map((offer) => offer.disclosure ?? '')
    .reduce((longest, current) => (current.length > longest.length ? current : longest), '')
  const willAppendLink = xInlineLinksEnabled && offers.length > 0
  const hardLimit = xCaptionBudget(willAppendLink, longestDisclosure || null)
  // Budget expressed in WORDS, not characters. Two real runs asked for a
  // character count (280, then 250 with headroom) and both came back over the
  // limit and were trimmed -- the exact outcome this feature exists to avoid.
  // Models count words far better than characters, so the ask is a word
  // target with the character cap kept only as a backstop. ~7 characters per
  // word including the space is a deliberately conservative conversion.
  const wordBudget = Math.max(18, Math.floor((hardLimit - 30) / 7))
  return [
    `Also write "x_caption": a version of the same post written natively for X, at most ${wordBudget} words (hard limit ${hardLimit} characters -- stay clearly under it). It must be a complete, self-contained post that stands on its own -- NOT the longer caption cut short, and it must never end mid-sentence or trail off. Keep the same story and voice; cut detail rather than running long. Do not include any URL in it.`,
  ]
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
  // `reach > 0` is filtered in SQL, not in JS after the fact. Filtering a
  // fixed window client-side made the gate depend on an arbitrary fetch size:
  // measured against real data, 136 published rows contained only 19 with
  // metrics in the newest 60, so the digest was suppressed at 19/20 while 51
  // qualifying posts existed. The fan-out is why -- three of every four rows
  // are X/Facebook/TikTok, which have no insights sync and can never have
  // reach, so "recent rows" is a poor proxy for "rows with data".
  //
  // "Posts with metrics" is the real bar, not "posts published": a post whose
  // insights haven't synced reads as a zero-reach failure and would teach
  // exactly the wrong lesson.
  const { data, error } = await supabase
    .from('post_performance')
    .select('title, tag, platform, media_type, reach, clicks, revenue, published_at')
    .eq('user_id', userId)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .gt('reach', 0)
    .order('published_at', { ascending: false })
    .limit(DIGEST_POST_LIMIT)
  if (error || !data) return null
  if (data.length < MIN_POSTS_FOR_DIGEST) return null

  const lines = data.map((row: any) => {
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
