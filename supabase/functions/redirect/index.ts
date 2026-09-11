// Deno edge function, public (--no-verify-jwt) -- this is the actual URL
// people click in bios/captions, so it can't require a Supabase session.
// Path shape: /functions/v1/redirect/<slug>
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing required environment variables', { status: 500 })
  }

  const url = new URL(req.url)
  const slug = url.pathname.split('/').filter(Boolean).pop()
  if (!slug || slug === 'redirect') {
    return new Response('Not found', { status: 404 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)
  const { data: link, error } = await supabase
    .from('short_links')
    .select('id, destination_url, utm_source, utm_medium, utm_campaign, utm_content')
    .eq('slug', slug)
    .maybeSingle()

  if (error || !link) {
    return new Response('Not found', { status: 404 })
  }

  const clientIp = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()

  // Logged best-effort; a logging failure should never block the redirect.
  try {
    await supabase.from('link_clicks').insert({
      short_link_id: link.id,
      referrer: req.headers.get('referer'),
      user_agent: req.headers.get('user-agent'),
      ip_hash: clientIp ? await hashIp(clientIp) : null,
      country: req.headers.get('cf-ipcountry'),
    })
  } catch {
    // swallow -- see comment above
  }

  const destination = new URL(link.destination_url)
  if (link.utm_source) destination.searchParams.set('utm_source', link.utm_source)
  if (link.utm_medium) destination.searchParams.set('utm_medium', link.utm_medium)
  if (link.utm_campaign) destination.searchParams.set('utm_campaign', link.utm_campaign)
  if (link.utm_content) destination.searchParams.set('utm_content', link.utm_content)

  return Response.redirect(destination.toString(), 302)
})
