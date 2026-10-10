-- Phase 12 Step 2: link-in-bio page config.
--
-- Instagram gives one bio link and its captions aren't clickable, so the
-- single link has to become N -- one per published post, each pointing at
-- that post's short link so clicks log through the existing redirect path
-- with no new tracking code.
--
-- These live on automation_settings rather than a new table because it's
-- already exactly one row per user and this is the same kind of per-user
-- config. bio_slug is what the public URL is keyed on
-- (/functions/v1/bio/<bio_slug>) -- null means the page is off, since the
-- bio function refuses to serve anything without a slug match.
alter table automation_settings
  add column bio_slug text unique,
  add column bio_headline text,
  add column bio_subhead text,
  add column bio_avatar_url text,
  add column bio_handle text;

-- Postgres treats every NULL as distinct, so the unique constraint above
-- doesn't stop multiple users having the page switched off.
