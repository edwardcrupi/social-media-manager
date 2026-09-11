-- Support for AI-generated video Reels (Seedance 2.5 via BytePlus ModelArk).
-- Video generation is asynchronous and can take minutes, unlike image
-- generation -- posts sit in 'generating' until check-video-jobs finds the
-- job finished and flips them to 'scheduled'.

alter table posts
  add column media_type text not null default 'image' check (media_type in ('image', 'video')),
  add column video_job_id text;

alter table posts drop constraint posts_status_check;
alter table posts add constraint posts_status_check
  check (status in ('draft', 'ready', 'generating', 'scheduled', 'published'));

-- Separate, conservative cap: video costs roughly 10-20x a single generated
-- image, so it must not silently ride on daily_auto_post_cap (tuned for
-- cheap images) once reels are enabled.
alter table automation_settings add column daily_reel_cap integer not null default 1;

insert into storage.buckets (id, name, public)
values ('post-videos', 'post-videos', true)
on conflict (id) do nothing;
