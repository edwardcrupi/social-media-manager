// Deno edge function, public (--no-verify-jwt) -- real people open this from
// an Instagram/TikTok bio with no Supabase session, same reasoning as
// `redirect`.
//
// Phase 12 Step 2: Instagram gives exactly one bio link and its captions
// aren't clickable, so this turns that one link into one per published post.
// Every link on the page points at /functions/v1/redirect/<slug>, so clicks
// log through the existing Phase 3 path -- there is no tracking code here at
// all.
//
// Path shape: /functions/v1/bio/<bio_slug>, where bio_slug is set on
// automation_settings. No slug set means no page (404), so the page is off
// by default rather than exposing a user's post history the moment this
// function is deployed.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

const MAX_POSTS = 24

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// The caption already contains the tracked URL on platforms with clickable
// captions (X/Facebook); repeating it as visible text on the bio page is
// noise, since the whole card is the link here.
function stripTrailingUrl(body: string): string {
  return body.replace(/\s*https?:\/\/\S+\s*$/, '').trim()
}

function renderPage(
  settings: Record<string, unknown>,
  entries: { title: string; body: string; mediaUrl: string | null; mediaType: string; href: string | null }[],
): string {
  const headline = escapeHtml((settings.bio_headline as string) || (settings.bio_handle as string) || 'Latest posts')
  const subhead = settings.bio_subhead ? escapeHtml(settings.bio_subhead as string) : ''
  const handle = settings.bio_handle ? escapeHtml(settings.bio_handle as string) : ''
  const avatar = settings.bio_avatar_url ? escapeHtml(settings.bio_avatar_url as string) : ''

  const cards = entries
    .map((entry) => {
      const inner = [
        entry.mediaUrl && entry.mediaType === 'image'
          ? `<img class="thumb" src="${escapeHtml(entry.mediaUrl)}" alt="" loading="lazy" />`
          : entry.mediaUrl
            ? `<video class="thumb" src="${escapeHtml(entry.mediaUrl)}#t=0.5" preload="metadata" muted playsinline></video>`
            : '<div class="thumb thumb-empty"></div>',
        `<div class="card-text"><strong>${escapeHtml(entry.title)}</strong><span>${escapeHtml(entry.body)}</span></div>`,
      ].join('')
      return entry.href
        ? `<a class="card" href="${escapeHtml(entry.href)}" rel="nofollow noopener">${inner}</a>`
        : `<div class="card card-static">${inner}</div>`
    })
    .join('')

  // Deliberately self-contained: no external CSS, fonts, or scripts, so the
  // page can't break on a CDN and loads fast on mobile, which is the only
  // way anyone will ever open it.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${headline}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 16px 56px;
    background: #14100f; color: #f6f1ec;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center;
  }
  header { text-align: center; max-width: 520px; margin-bottom: 28px; }
  .avatar { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; margin-bottom: 14px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .handle { color: #ff7a59; font-size: 14px; margin: 0 0 8px; }
  .subhead { color: #b9aea6; font-size: 15px; line-height: 1.5; margin: 0; }
  main { width: 100%; max-width: 520px; display: flex; flex-direction: column; gap: 12px; }
  .card {
    display: flex; gap: 14px; align-items: center; padding: 12px;
    background: #1d1817; border: 1px solid #2c2523; border-radius: 14px;
    text-decoration: none; color: inherit;
  }
  .card:hover { border-color: #ff7a59; }
  .card-static { opacity: 0.6; }
  .thumb { width: 64px; height: 64px; border-radius: 10px; object-fit: cover; flex: none; background: #2c2523; }
  .card-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .card-text strong { font-size: 15px; line-height: 1.3; }
  .card-text span {
    font-size: 13px; color: #b9aea6; line-height: 1.4;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .empty { color: #b9aea6; font-size: 15px; text-align: center; }
</style>
</head>
<body>
<header>
  ${avatar ? `<img class="avatar" src="${avatar}" alt="" />` : ''}
  <h1>${headline}</h1>
  ${handle ? `<p class="handle">${handle}</p>` : ''}
  ${subhead ? `<p class="subhead">${subhead}</p>` : ''}
</header>
<main>
  ${cards || '<p class="empty">Nothing published yet.</p>'}
</main>
</body>
</html>`
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const url = new URL(req.url)
  const slug = url.pathname.split('/').filter(Boolean).pop()
  if (!slug || slug === 'bio') {
    return new Response('Not found', { status: 404 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: settings, error: settingsError } = await supabase
    .from('automation_settings')
    .select('user_id, bio_slug, bio_headline, bio_subhead, bio_avatar_url, bio_handle')
    .eq('bio_slug', slug)
    .maybeSingle()

  if (settingsError || !settings) {
    return new Response('Not found', { status: 404 })
  }

  // Over-fetch, then collapse: fan-out means one idea is several published
  // rows (one per platform) with the same title, and a bio page listing the
  // same post four times is worse than useless.
  const { data: posts } = await supabase
    .from('posts')
    .select('id, title, body, media_url, media_type, published_at')
    .eq('user_id', settings.user_id)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(MAX_POSTS * 4)

  const seen = new Set<string>()
  const chosen = (posts ?? []).filter((post) => {
    if (seen.has(post.title)) return false
    seen.add(post.title)
    return true
  }).slice(0, MAX_POSTS)

  const { data: links } = chosen.length > 0
    ? await supabase
        .from('short_links')
        .select('post_id, slug')
        .in('post_id', chosen.map((post) => post.id))
    : { data: [] }

  const slugByPost = new Map<string, string>()
  for (const link of links ?? []) {
    if (link.post_id) slugByPost.set(link.post_id as string, link.slug as string)
  }

  const entries = chosen.map((post) => {
    const linkSlug = slugByPost.get(post.id as string)
    return {
      title: post.title as string,
      body: stripTrailingUrl((post.body as string) ?? ''),
      mediaUrl: (post.media_url as string) ?? null,
      mediaType: (post.media_type as string) ?? 'image',
      // A post created before Phase 12 (or while no offers existed) has no
      // link -- it still renders, just not as a clickable card.
      href: linkSlug ? `${supabaseUrl}/functions/v1/redirect/${linkSlug}` : null,
    }
  })

  return new Response(renderPage(settings, entries), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
})
