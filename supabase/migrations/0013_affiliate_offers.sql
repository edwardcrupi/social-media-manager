-- Phase 12 Step 1: attach an offer to every generated post.
--
-- Until now the content pipeline (generate-trend-posts / generate-reel-posts)
-- and the attribution stack (short_links -> redirect -> link_clicks ->
-- revenue_events) had no connection to each other at all: not one reference
-- to short_links existed in either generation function, so every
-- auto-published post went out with no offer and nothing tracked. This table
-- is what the generation functions match an idea against so each post row
-- gets its own short link.
--
-- destination_url is deliberately unconstrained: an affiliate network's
-- tracking link, a product page, or (with no network approved yet) your own
-- newsletter signup are all valid rows, and the click-tracking half works
-- identically for all of them.
create table affiliate_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) default auth.uid(),
  program_name text not null,
  destination_url text not null,
  -- Matched against the drafted post by Claude inside the existing
  -- generation call, not by a keyword matcher here -- these are hints for
  -- that prompt, not a query filter.
  keywords text[] not null default '{}',
  category text,
  -- Highest priority active offer is the fallback when the model returns no
  -- offer_id or hallucinates one; a post must never end up link-less.
  priority integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table affiliate_offers enable row level security;
create policy "owner rw" on affiliate_offers for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Which offer a link was created for. Without this, per-offer performance is
-- unanswerable once a second offer exists -- destination_url alone doesn't
-- survive an offer being edited or retired.
alter table short_links
  add column affiliate_offer_id uuid references affiliate_offers(id) on delete set null;

-- The generation functions and the post_performance view (0015) both look up
-- links by post; short_links had no index on post_id at all.
create index short_links_post_id_idx on short_links (post_id) where post_id is not null;

-- X bills $0.20 per post containing a URL vs $0.015 without -- 13x. Inline X
-- links are therefore opt-in per user rather than on by default, to be
-- switched on once there's real conversion data to justify the cost.
-- Instagram/TikTok captions aren't clickable at all, so they never get an
-- inline URL regardless of this setting (the bio page in 0014 is their path);
-- Facebook captions are clickable and free, so they always get one.
alter table automation_settings
  add column x_inline_links_enabled boolean not null default false;
