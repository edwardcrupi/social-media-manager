-- publish_attempts: tracks how many times publish-scheduled-posts has tried
-- and failed to publish a post. Without this, a post whose target platform
-- is broken (e.g. a persistent 403) stays status='scheduled' forever and
-- gets re-selected -- and its media re-downloaded from Storage -- on every
-- single cron run indefinitely, with no backoff or cap. Discovered
-- 2026-09-23 after 29 X posts sat stuck since 2026-09-16, retried every 15
-- minutes for 6+ days, driving Supabase Storage egress far past the free
-- tier's 5.5GB bandwidth quota.
alter table posts add column publish_attempts integer not null default 0;
