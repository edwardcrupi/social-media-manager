-- video_prompt: the exact text sent to Seedance for video generation.
-- Previously discarded after submission -- neither our own database nor
-- BytePlus ModelArk's task-status API retains it, so there was no way to
-- answer "what prompt produced this video" after the fact.
alter table posts add column video_prompt text;
