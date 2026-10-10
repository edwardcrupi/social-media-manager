import { useEffect, useRef, useState } from 'react'
import { useSavePoster } from '../../hooks/useSavePoster'

// Thumbnail for a video post.
//
// Once a post has a poster_url this is just an <img> -- a ~40KB JPEG. Until
// then it shows a neutral tile and, when scrolled into view, captures the
// poster from the video once and stores it (see lib/posterCapture.ts).
//
// What it deliberately no longer does is render <video preload="metadata"
// src="...#t=0.5"> per row. Seedance's MP4s put moov after mdat, so that
// pulled most of a 10-17MB file to paint a 56px tile, on every page load,
// once per platform row -- 600+MB of cached egress in a day. Migration 0018
// has the full accounting.
export function VideoThumb({
  postId,
  mediaUrl,
  posterUrl,
}: {
  postId: string
  mediaUrl: string
  posterUrl: string | null
}) {
  const savePoster = useSavePoster()
  const ref = useRef<HTMLSpanElement>(null)
  // Without IntersectionObserver there is nothing to wait for, so start in
  // the seen state rather than flipping it from inside an effect.
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')

  // Only capture what the user actually scrolls to. A capture costs a moov
  // read plus one keyframe on a faststart video -- cheap, but not free, and
  // there's no reason to pay it for rows nobody has looked at.
  useEffect(() => {
    if (posterUrl || seen) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [posterUrl, seen])

  const { mutate } = savePoster
  useEffect(() => {
    if (posterUrl || !seen) return
    mutate({ postId, mediaUrl })
    // Keyed on the video, not the row: sibling rows sharing this upload are
    // collapsed onto one capture in queuePosterCapture, and save-poster
    // writes the result back to all of them.
  }, [posterUrl, seen, postId, mediaUrl, mutate])

  return (
    <span className="queue-thumb-wrap" ref={ref}>
      {posterUrl ? (
        <img className="queue-thumb" src={posterUrl} alt="" loading="lazy" />
      ) : (
        <span className="queue-thumb queue-thumb-video" />
      )}
      <span className="queue-thumb-play" aria-hidden="true">
        ▶
      </span>
    </span>
  )
}
