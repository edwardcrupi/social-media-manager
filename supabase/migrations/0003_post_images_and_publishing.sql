-- Support for auto-generated post images and real Instagram publishing.

alter table posts add column media_url text;

-- Public bucket for auto-generated post images. Public read (Instagram's
-- servers must be able to fetch the image over plain HTTPS); writes only
-- ever happen via the service_role key from Edge Functions.
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do nothing;
