// Deno edge function. Stores a poster still for a video post, so the Content
// Queue can draw a thumbnail from a ~40KB JPEG instead of from the 10-17MB
// video itself. Called by the front end, which captures the frame in a
// canvas the first (and only) time it renders a video row with no poster --
// see src/lib/posterCapture.ts and migration 0018 for why.
//
// This exists as a function rather than a direct client upload so that
// Storage stays write-only to the service role, matching every other bucket
// write in this app -- the alternative was opening post-thumbnails to
// authenticated clients with a storage RLS policy, which is a much wider
// grant than "let the owner of this post attach one poster to it".
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import { IMMUTABLE_CACHE_CONTROL } from '../_shared/storage.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// A 9:16 still at the size the queue renders it on a retina screen lands
// around 30-60KB at JPEG q0.7. Anything meaningfully past this is not a
// thumbnail, so reject it rather than storing it.
const MAX_POSTER_BYTES = 512 * 1024

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Use POST' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Missing required environment variables' }, 500)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return json({ error: 'Not signed in' }, 401)
  }

  let payload: { postId?: unknown; posterBase64?: unknown }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const { postId, posterBase64 } = payload
  if (typeof postId !== 'string' || typeof posterBase64 !== 'string') {
    return json({ error: 'postId and posterBase64 are required' }, 400)
  }

  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(posterBase64), (c) => c.charCodeAt(0))
  } catch {
    return json({ error: 'posterBase64 is not valid base64' }, 400)
  }
  if (bytes.length === 0) return json({ error: 'Poster is empty' }, 400)
  if (bytes.length > MAX_POSTER_BYTES) {
    return json({ error: `Poster exceeds ${MAX_POSTER_BYTES} bytes` }, 413)
  }
  // Don't take the client's word for the content type -- check the JPEG SOI
  // marker, since this lands in a public bucket.
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return json({ error: 'Poster must be a JPEG' }, 400)
  }

  // Read through the user client so RLS decides ownership; a postId belonging
  // to someone else simply doesn't come back.
  const { data: post, error: postError } = await userClient
    .from('posts')
    .select('id, media_url, media_type')
    .eq('id', postId)
    .maybeSingle()
  if (postError) return json({ error: postError.message }, 500)
  if (!post) return json({ error: 'Post not found' }, 404)
  if (post.media_type !== 'video' || !post.media_url) {
    return json({ error: 'Post has no video to poster' }, 400)
  }

  const service = createClient(supabaseUrl, serviceRoleKey)
  const path = `${user.id}/${crypto.randomUUID()}.jpg`
  const { error: uploadError } = await service.storage
    .from('post-thumbnails')
    .upload(path, bytes, { contentType: 'image/jpeg', cacheControl: IMMUTABLE_CACHE_CONTROL })
  if (uploadError) return json({ error: uploadError.message }, 500)

  const { data: publicUrlData } = service.storage.from('post-thumbnails').getPublicUrl(path)
  const posterUrl = publicUrlData.publicUrl

  // The per-platform fan-out points several post rows at one uploaded video,
  // so attach the poster to every row sharing this media_url, not just the
  // one that happened to be on screen. Without this the other rows would
  // each capture their own identical poster -- re-downloading the same video
  // once per platform, which is the exact duplication this is meant to end.
  // Scoped to the caller: another user's row pointing at the same URL (not
  // possible today, single-owner, but cheap to hold true) is left alone.
  const { data: updated, error: updateError } = await service
    .from('posts')
    .update({ poster_url: posterUrl })
    .eq('media_url', post.media_url)
    .eq('user_id', user.id)
    .is('poster_url', null)
    .select('id')
  if (updateError) return json({ error: updateError.message }, 500)

  return json({ posterUrl, updatedPostIds: (updated ?? []).map((row) => row.id) })
})
