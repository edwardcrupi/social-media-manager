-- Phase 12 Step 3: feed performance back into generation.
--
-- The pipeline has never known which of its own posts worked. Real per-post
-- reach/engagement has been syncing into platform_metrics since Phase 9 and
-- clicks into link_clicks since Phase 3, both unused by the thing that would
-- benefit most: the prompt that decides what to post next.
--
-- One view so the Edge Functions do a single query instead of N. Queried
-- service-role-side from Deno, but security_invoker keeps it correctly
-- scoped if the frontend ever selects from it too (the frontend's
-- hand-rolled-types limitation from Phase 3 doesn't apply here -- this is a
-- flat view, not an embedded select).
create view post_performance
with (security_invoker = on) as
select
  p.id as post_id,
  p.user_id,
  p.title,
  p.tag,
  p.media_type,
  p.status,
  p.published_at,
  sp.platform,
  metrics.reach,
  metrics.views,
  metrics.engagement,
  clicks.click_count as clicks,
  rev.revenue
from posts p
left join social_profiles sp on sp.id = p.social_profile_id
-- platform_metrics keeps one row per metric per day and Instagram's per-media
-- insights are lifetime cumulative, so the latest value for a metric is its
-- max across dates -- summing the daily rows would multiply a post's reach by
-- however many days it has been synced.
left join lateral (
  select
    coalesce(max(latest.value) filter (where latest.metric_name = 'reach'), 0) as reach,
    coalesce(max(latest.value) filter (where latest.metric_name = 'views'), 0) as views,
    coalesce(sum(latest.value) filter (
      where latest.metric_name in ('likes', 'comments', 'saved', 'shares')
    ), 0) as engagement
  from (
    select pm.metric_name, max(pm.metric_value) as value
    from platform_metrics pm
    where pm.post_id = p.id
    group by pm.metric_name
  ) latest
) metrics on true
left join lateral (
  select count(*) as click_count
  from link_clicks lc
  join short_links sl on sl.id = lc.short_link_id
  where sl.post_id = p.id
) clicks on true
left join lateral (
  select coalesce(sum(re.amount), 0) as revenue
  from revenue_events re
  where re.post_id = p.id and re.status <> 'reversed'
) rev on true;
