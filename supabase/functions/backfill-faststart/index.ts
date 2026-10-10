// Deno edge function, run by hand (not on a cron) until it reports nothing
// left to do. Rewrites already-uploaded videos so their `moov` atom sits at
// the front of the file -- see _shared/faststart.ts for why, and migration
// 0018 for the egress incident that prompted it.
//
// check-video-jobs now does this for every new video at generation time, for
// free, because it already holds the bytes. This function is only for the
// videos uploaded before that existed. Without it those files stay expensive
// to read one frame from, so the queue's one-time poster capture would have
// to download each of them in full -- exactly what this avoids.
//
// Resumable and idempotent: it probes each object with a ~64-byte range
// request and only downloads the ones that actually need reordering, so
// re-running it after everything is converted costs almost nothing. Work is
// capped per invocation to stay well inside the 150s function limit.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0'
import { IMMUTABLE_CACHE_CONTROL } from '../_shared/storage.ts'
import { toFaststart } from '../_shared/faststart.ts'

const BUCKET = 'post-videos'
const DEFAULT_LIMIT = 8
const MAX_LIMIT = 25
// Downloading, reordering and re-uploading a ~15MB video runs a few seconds.
// Stop starting new ones well before the hard 150s cutoff so the function
// returns a report rather than being killed mid-file.
const TIME_BUDGET_MS = 110_000

/** Reads just enough of the file to see whether moov already leads. */
async function isAlreadyFaststart(url: string): Promise<boolean | null> {
  const res = await fetch(url, { headers: { Range: 'bytes=0-63' } })
  if (!res.ok && res.status !== 206) return null
  const head = new Uint8Array(await res.arrayBuffer())
  if (head.length < 16) return null
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const ftypSize = view.getUint32(0)
  const ftypType = String.fromCharCode(...head.slice(4, 8))
  if (ftypType !== 'ftyp' || ftypSize < 8 || ftypSize + 8 > head.length) return null
  const nextType = String.fromCharCode(...head.slice(ftypSize + 4, ftypSize + 8))
  return nextType === 'moov'
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Use POST', { status: 405 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response('Missing required environment variables', { status: 500 })
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let limit = DEFAULT_LIMIT
  try {
    const body = await req.json()
    if (typeof body?.limit === 'number') limit = Math.min(Math.max(1, body.limit), MAX_LIMIT)
  } catch {
    // No body is fine -- use the default.
  }

  // Drive off posts.media_url rather than a bucket listing, so this only
  // touches objects the app actually references.
  const { data: rows, error } = await supabase
    .from('posts')
    .select('media_url')
    .eq('media_type', 'video')
    .not('media_url', 'is', null)
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }

  // The per-platform fan-out means several rows share one upload.
  const urls = [...new Set((rows ?? []).map((row) => row.media_url as string))]
  const marker = `/object/public/${BUCKET}/`

  const started = Date.now()
  const results: Record<string, unknown>[] = []
  let converted = 0
  let alreadyOk = 0
  let remaining = 0

  for (const url of urls) {
    const at = url.indexOf(marker)
    if (at === -1) {
      results.push({ url, status: 'skipped', reason: 'not a post-videos object' })
      continue
    }
    const path = decodeURIComponent(url.slice(at + marker.length))

    if (Date.now() - started > TIME_BUDGET_MS || converted >= limit) {
      remaining++
      continue
    }

    try {
      const probe = await isAlreadyFaststart(url)
      if (probe === true) {
        alreadyOk++
        continue
      }

      const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(path)
      if (downloadError) throw downloadError
      const bytes = new Uint8Array(await blob.arrayBuffer())

      const result = toFaststart(bytes)
      if (!result.changed) {
        alreadyOk++
        results.push({ path, status: 'unchanged', reason: result.reason })
        continue
      }

      // Same path, so every posts.media_url already pointing here stays
      // valid and nothing in the database has to change.
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, result.bytes, {
          contentType: 'video/mp4',
          cacheControl: IMMUTABLE_CACHE_CONTROL,
          upsert: true,
        })
      if (uploadError) throw uploadError

      converted++
      results.push({ path, status: 'converted', bytes: result.bytes.length, offsetsPatched: result.offsetsPatched })
    } catch (err) {
      results.push({ path, status: 'error', error: err instanceof Error ? err.message : 'unknown error' })
    }
  }

  return new Response(
    JSON.stringify({
      totalVideos: urls.length,
      converted,
      alreadyFaststart: alreadyOk,
      notAttemptedThisRun: remaining,
      done: remaining === 0,
      elapsedMs: Date.now() - started,
      results,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
