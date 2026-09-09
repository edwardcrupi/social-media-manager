-- Social media manager: initial schema.
-- Single-owner model: every row is scoped to the auth.users row that created it.

create extension if not exists pgcrypto;

-- social_profiles: one row per platform account (manual data until OAuth lands)
create table social_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  platform text not null check (platform in ('instagram', 'tiktok', 'pinterest', 'other')),
  display_name text not null,
  handle text not null,
  tone text,
  accent text not null default 'coral' check (accent in ('coral', 'yellow', 'blue')),
  follower_count integer,
  connection_status text not null default 'manual'
    check (connection_status in ('manual', 'pending', 'connected', 'error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- social_profile_secrets: OAuth tokens. No RLS policies at all -- only the
-- service_role key (used inside Edge Functions, never shipped to the browser)
-- can read or write this table.
create table social_profile_secrets (
  social_profile_id uuid primary key references social_profiles(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

-- posts: content queue items, manual or auto-drafted from trending topics
create table posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  social_profile_id uuid references social_profiles(id),
  title text not null,
  body text,
  tag text,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'scheduled', 'published')),
  source text not null default 'manual' check (source in ('manual', 'auto')),
  trend_source jsonb,
  scheduled_for timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- short_links: UTM-tagged redirect links per post/campaign
create table short_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  post_id uuid references posts(id),
  slug text not null unique,
  destination_url text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  created_at timestamptz not null default now()
);

-- link_clicks: append-only click log, written only by the redirect Edge Function
create table link_clicks (
  id uuid primary key default gen_random_uuid(),
  short_link_id uuid not null references short_links(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  referrer text,
  user_agent text,
  ip_hash text,
  country text
);

-- revenue_events: manual entries now, later reconciled against link_clicks
create table revenue_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  short_link_id uuid references short_links(id),
  post_id uuid references posts(id),
  source text not null,
  amount numeric(10, 2) not null,
  currency text not null default 'USD',
  occurred_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

-- automation_settings: one row per user, controls trend-based auto-drafting.
-- auto_posting_enabled defaults to false -- the kill switch is off until the
-- user explicitly turns it on.
create table automation_settings (
  user_id uuid primary key references auth.users(id) default auth.uid(),
  niche_description text,
  brand_voice text,
  topic_blocklist text[] not null default '{}',
  daily_auto_post_cap integer not null default 2,
  auto_posting_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Row Level Security
alter table social_profiles enable row level security;
alter table social_profile_secrets enable row level security; -- no policies = locked to service_role
alter table posts enable row level security;
alter table short_links enable row level security;
alter table link_clicks enable row level security;
alter table revenue_events enable row level security;
alter table automation_settings enable row level security;

create policy "owner rw" on social_profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner rw" on posts for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner rw" on short_links for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner rw" on revenue_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner rw" on automation_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- link_clicks has no user_id column; scope select via the parent short_link's owner.
-- No insert policy for anon/authenticated -- only the redirect Edge Function
-- (service_role) inserts rows here.
create policy "owner select" on link_clicks for select using (
  exists (
    select 1 from short_links sl
    where sl.id = link_clicks.short_link_id and sl.user_id = auth.uid()
  )
);
