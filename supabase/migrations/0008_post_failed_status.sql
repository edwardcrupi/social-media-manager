-- 'failed' status: check-video-jobs previously deleted a post outright when
-- Seedance's own content-moderation rejected the finished video, leaving no
-- trace of what happened. It now marks the post 'failed' instead, with the
-- rejection reason recorded, so it's visible in the Content Queue.
alter table posts drop constraint posts_status_check;
alter table posts add constraint posts_status_check
  check (status in ('draft', 'ready', 'generating', 'scheduled', 'published', 'failed'));

alter table posts add column failure_reason text;
