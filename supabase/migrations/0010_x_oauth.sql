-- Support for the X (Twitter) OAuth 2.0 + PKCE connection flow.

-- X's OAuth 2.0 authorization code exchange requires a PKCE code_verifier
-- that must survive from x-oauth-start (where it's generated) to
-- x-oauth-callback (where it's used) -- neither Instagram's nor TikTok's
-- flow needed this, so the column is nullable and only ever set by the X
-- flow. Reuses the existing single-use oauth_states row rather than a new
-- table.
alter table oauth_states add column code_verifier text;

alter table oauth_states drop constraint oauth_states_provider_check;
alter table oauth_states add constraint oauth_states_provider_check
  check (provider in ('instagram', 'tiktok', 'x'));

alter table social_profiles drop constraint social_profiles_platform_check;
alter table social_profiles add constraint social_profiles_platform_check
  check (platform in ('instagram', 'tiktok', 'pinterest', 'x', 'other'));
