-- platform_media_id: the id Instagram/TikTok hands back on successful
-- publish (Instagram media id / TikTok publish id). Needed so
-- sync-instagram-insights can fetch per-media insights against the right
-- object -- publish-scheduled-posts previously discarded this id entirely.
alter table posts add column platform_media_id text;

-- platform_metrics: real reach/engagement data pulled from the Instagram
-- Graph API insights endpoints, replacing the Insights page's previous
-- reliance on aggregates computed purely from local posts/revenue_events.
-- post_id null = an account-level metric (reach, profile_views, etc.);
-- post_id set = a per-post metric (likes, comments, saved, ...).
-- metric_date lets the same metric_name be stored once per day rather than
-- overwritten in place, giving a short trend history without a separate
-- time-series table.
--
-- metric_scope exists purely so upserts can conflict-detect correctly: a
-- plain unique index on a nullable post_id wouldn't work, since Postgres
-- treats every NULL as distinct from every other NULL, so two account-level
-- syncs on the same day would never be recognized as the same row and
-- would just keep inserting duplicates.
create table platform_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  social_profile_id uuid not null references social_profiles(id) on delete cascade,
  post_id uuid references posts(id) on delete cascade,
  metric_scope text generated always as (coalesce(post_id::text, 'account')) stored,
  metric_name text not null,
  metric_value numeric not null,
  metric_date date not null default current_date,
  updated_at timestamptz not null default now()
);

alter table platform_metrics enable row level security;

-- No insert/update/delete policy -- only sync-instagram-insights
-- (service_role) writes here, same pattern as link_clicks.
create policy "owner select" on platform_metrics for select using (auth.uid() = user_id);

create unique index platform_metrics_unique_idx
  on platform_metrics (social_profile_id, metric_scope, metric_name, metric_date);
