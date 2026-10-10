-- posts.social_profile_id had no ON DELETE behavior (default RESTRICT),
-- meaning removing any profile with even one post attached failed outright
-- with a foreign-key violation -- and the Profiles page's delete button
-- swallowed that error silently, making it look like the button did
-- nothing. SET NULL detaches the post from the deleted profile instead of
-- blocking the delete or destroying post/revenue history.
alter table posts drop constraint posts_social_profile_id_fkey;
alter table posts add constraint posts_social_profile_id_fkey
  foreign key (social_profile_id) references social_profiles(id) on delete set null;
