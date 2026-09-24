-- Support for the Facebook Page OAuth connection flow. Reuses the same Meta
-- app as Instagram (see 0002_instagram_oauth.sql) since both are Page-linked
-- Facebook Login for Business flows -- Facebook just connects the Page
-- itself rather than an Instagram Business Account hanging off it.

alter table oauth_states drop constraint oauth_states_provider_check;
alter table oauth_states add constraint oauth_states_provider_check
  check (provider in ('instagram', 'tiktok', 'x', 'facebook'));

alter table social_profiles drop constraint social_profiles_platform_check;
alter table social_profiles add constraint social_profiles_platform_check
  check (platform in ('instagram', 'tiktok', 'pinterest', 'x', 'facebook', 'other'));
