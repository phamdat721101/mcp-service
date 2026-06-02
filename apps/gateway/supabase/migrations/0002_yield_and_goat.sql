-- 0002_yield_and_goat.sql — adds GOAT chains + the yield_positions table.
--
-- yield_positions tracks publisher idle USDC supplied to Aave (or simulated on
-- testnets). One row per (publisher, chain). Read via RLS by the owner;
-- written exclusively by service-role cron.

alter type chain_t add value if not exists 'goat-testnet3';
alter type chain_t add value if not exists 'goat-mainnet';

create table if not exists yield_positions (
  publisher_id uuid not null references publishers(id) on delete cascade,
  chain chain_t not null,
  supplied_usdc bigint not null default 0 check (supplied_usdc >= 0),
  accrued_usdc bigint not null default 0 check (accrued_usdc >= 0),
  apy_bps integer not null default 0,
  last_swept_at timestamptz,
  last_synced_at timestamptz not null default now(),
  primary key (publisher_id, chain)
);

create or replace function set_yield_synced() returns trigger language plpgsql as $$
begin
  new.last_synced_at := now();
  return new;
end$$;

create trigger yield_positions_synced before update on yield_positions
  for each row execute function set_yield_synced();

alter table yield_positions enable row level security;

create policy yield_positions_self_read on yield_positions for select
  using (publisher_id = current_publisher_id());
