-- posts.poster_url: a small JPEG still for video posts, so the Content Queue
-- can draw a thumbnail without ever downloading the video itself.
--
-- Discovered 2026-09-28, from 600+MB of Supabase *cached* egress in a single
-- day. This is a second, separate leak from the 0012 retry storm, and the
-- "cached" part is the tell: 0012 was server-side re-downloads, this one is
-- the same objects fetched over and over by the browser.
--
-- The queue rendered one <video preload="metadata" src="...#t=0.5"> per video
-- row. Two things made that far more expensive than it looks:
--   1. Seedance's MP4s are not faststart -- mdat precedes moov -- so
--      "metadata" cannot be satisfied from the head of the file, and the
--      #t=0.5 seek hint forces a frame decode. The browser ends up pulling
--      most of a 10-17MB file just to paint a 56x56 tile.
--   2. The per-platform fan-out points ~3.2 post rows at each uploaded video
--      (20 of 30 objects are referenced by 4 rows each), so one page load
--      requested 30 distinct objects 97 times. The 67 duplicate requests hit
--      a warm CDN -- which is exactly why this billed as cached egress.
--
-- 97 video rows over 30 objects totalling 372MiB works out to roughly 830MB
-- of cached egress per full render of the page.
--
-- Backfilled opportunistically by the front end rather than in a batch job:
-- a video row whose poster_url is null is captured from the video once, in
-- the browser, uploaded through the save-poster function, and then never
-- downloaded in full again. Videos generated before this column existed
-- therefore cost one last full download each, and nothing after that.
alter table posts add column poster_url text;

-- Public, same as post-images/post-videos (both created via the dashboard
-- and so absent from this migration history -- this one is recorded here so
-- it is reproducible). Posters are written only by the save-poster edge
-- function under the service role, so no storage RLS policy is needed.
insert into storage.buckets (id, name, public)
values ('post-thumbnails', 'post-thumbnails', true)
on conflict (id) do nothing;
