-- Support for the Instagram (Facebook Login for Business) OAuth connection flow.

-- oauth_states: short-lived, single-use CSRF tokens minted while an
-- authenticated user starts a connection flow. No RLS policies -- only the
-- service_role key (used inside Edge Functions) reads or writes this table,
-- since the callback that consumes a row is hit directly by Meta with no
-- Supabase Auth session.
create table oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id),
  provider text not null check (provider in ('instagram', 'tiktok')),
  created_at timestamptz not null default now()
);
alter table oauth_states enable row level security;

-- external_id: the platform's own account id (e.g. Instagram Business
-- Account id), used to find-or-update the right row on reconnect instead of
-- creating a duplicate profile every time.
alter table social_profiles add column external_id text;
create unique index social_profiles_user_platform_external_id_idx
  on social_profiles (user_id, platform, external_id)
  where external_id is not null;
