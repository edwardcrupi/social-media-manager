-- Impact.com live revenue reconciliation: revenue_events gains an
-- idempotency key (for postback upserts keyed by Impact's ActionId) and a
-- status so provisional/reversed affiliate conversions don't read as final.
alter table revenue_events add column external_ref text;
alter table revenue_events add column status text not null default 'confirmed'
  check (status in ('pending', 'confirmed', 'reversed'));
create unique index revenue_events_external_ref_key
  on revenue_events (user_id, external_ref) where external_ref is not null;
