// Captures a still frame from a video in a canvas, so a video post can get a
// ~40KB poster JPEG once and never be downloaded in full for its thumbnail
// again. See supabase/migrations/0018_post_poster_url.sql for the egress
// problem this solves.
//
// This is deliberately a browser-side capture. Supabase Edge Functions run
// on Deno with no ffmpeg and no practical H.264 decoder, and Seedance's task
// response isn't known to carry a cover image -- whereas the browser already
// has a hardware video decoder, and Storage serves these objects with
// `access-control-allow-origin: *`, so a cross-origin canvas readback is not
// tainted and toDataURL works.

// 9:16 at 320px wide is ~2.5x the 56px tile the queue draws, so it stays
// crisp on a retina screen while still landing well under 100KB at q0.7.
const POSTER_WIDTH = 320
const POSTER_QUALITY = 0.7
// Far enough in to be past any fade-from-black opening frame, which is what
// the old `#t=0.5` thumbnail hack was reaching for too.
const SEEK_SECONDS = 0.5
const CAPTURE_TIMEOUT_MS = 30_000

function captureFrame(mediaUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.playsInline = true
    // 'metadata', never 'auto'. On a faststart file this fetches the 13KB
    // moov and then, on the seek below, a range request for just that
    // keyframe region -- about 150KB. 'auto' tells the browser to buffer as
    // much as it can and pulls most of the 13MB file, which defeats the
    // entire point of the faststart work. This was 'auto' for one session
    // and cost ~180MB of egress across 14 captures.
    video.preload = 'metadata'

    let settled = false
    const timer = setTimeout(() => fail('Timed out reading the video'), CAPTURE_TIMEOUT_MS)

    function cleanup() {
      clearTimeout(timer)
      // Detaching the src aborts any still-streaming request rather than
      // letting it run to completion in the background.
      video.removeAttribute('src')
      video.load()
    }

    function fail(message: string) {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(message))
    }

    function draw() {
      if (settled) return
      const width = POSTER_WIDTH
      const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 16 / 9
      const height = Math.max(1, Math.round(width * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) return fail('Could not get a 2d canvas context')
      try {
        context.drawImage(video, 0, 0, width, height)
        const dataUrl = canvas.toDataURL('image/jpeg', POSTER_QUALITY)
        settled = true
        cleanup()
        resolve(dataUrl.slice(dataUrl.indexOf(',') + 1))
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Could not read the frame')
      }
    }

    video.addEventListener('error', () => fail('Could not load the video'))
    video.addEventListener('seeked', draw, { once: true })
    video.addEventListener(
      'loadeddata',
      () => {
        // A video shorter than the seek target (or one already sitting on it)
        // never fires `seeked`, so draw whatever frame is decoded instead of
        // waiting for an event that isn't coming.
        const target = Math.min(SEEK_SECONDS, (video.duration || SEEK_SECONDS * 2) / 2)
        if (Math.abs(video.currentTime - target) < 0.01) draw()
        else video.currentTime = target
      },
      { once: true },
    )

    video.src = mediaUrl
  })
}

// Captures run strictly one at a time. Each one pulls a full video, so firing
// all of them at once would recreate the very stampede this is fixing -- the
// difference being that this one is paid once per video, ever, instead of on
// every page load.
let tail: Promise<unknown> = Promise.resolve()
const inFlight = new Map<string, Promise<string>>()
// A video whose capture fails is not retried for the rest of the session.
// Without this, `seen` resets on every remount (navigation, or a Vite HMR
// reload during development), the observer fires again, and a persistently
// failing video is re-read from Storage every single time the queue is
// opened -- a slow leak of exactly the kind this module exists to stop.
const failed = new Set<string>()

export function queuePosterCapture(mediaUrl: string): Promise<string> {
  // Several post rows share one uploaded video (the per-platform fan-out), so
  // collapse concurrent requests for the same URL onto one capture.
  const existing = inFlight.get(mediaUrl)
  if (existing) return existing
  if (failed.has(mediaUrl)) {
    return Promise.reject(new Error('Poster capture already failed for this video this session'))
  }

  const run = tail.then(
    () => captureFrame(mediaUrl),
    () => captureFrame(mediaUrl),
  )
  tail = run.catch(() => {})
  const tracked = run
    .catch((error) => {
      failed.add(mediaUrl)
      throw error
    })
    .finally(() => inFlight.delete(mediaUrl))
  inFlight.set(mediaUrl, tracked)
  return tracked
}
