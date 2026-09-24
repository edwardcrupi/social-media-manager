-- Schema drift repair, found 2026-09-24 while pushing the Phase 12
-- migrations: `create view post_performance` failed with
-- `column re.status does not exist`, even though 0005 is recorded as applied
-- in the remote migration history. It is recorded but its columns are not
-- there -- a recorded-but-not-applied migration, not a missing one, so
-- `supabase db push` will never re-run 0005 on its own.
--
-- This has been silently wrong in production since Phase 7: the frontend's
-- RevenueEventRow type declares both columns and RevenuePage reads
-- `event.status` (filtering 'reversed' out of the chart, labelling
-- 'pending'), so every one of those reads has been comparing against
-- `undefined`. Phase 7 itself is dead (the Impact publisher account was
-- never approved, and impact-conversion-postback was never deployed), so
-- nothing has been *writing* these columns -- which is why the drift went
-- unnoticed.
--
-- Written idempotently rather than as a straight copy of 0005 so it is safe
-- on any database where 0005 did apply correctly.
alter table revenue_events add column if not exists external_ref text;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'revenue_events' and column_name = 'status'
  ) then
    alter table revenue_events add column status text not null default 'confirmed'
      check (status in ('pending', 'confirmed', 'reversed'));
  end if;
end $$;

create unique index if not exists revenue_events_external_ref_key
  on revenue_events (user_id, external_ref) where external_ref is not null;
