-- 0001_init.sql — n-payment Gateway core schema
--
-- Design rules (per .kiro/steering/architecture.md and security-and-keys.md):
--   * RLS enabled on every table; default deny.
--   * Service-role bypasses RLS only in cron jobs + webhook handlers + facilitator audit writer.
--   * audit_entries is append-only — no UPDATE / DELETE policies, ever.
--   * Encrypted secrets (sponsor wallet keys) live in pgsodium-backed columns.

create extension if not exists "uuid-ossp";
create extension if not exists "pgsodium" with schema pgsodium;

-- ─── enums ──────────────────────────────────────────────────────────────────

create type tier_t as enum ('free', 'pro', 'team', 'enterprise');
create type chain_t as enum ('base-mainnet', 'base-sepolia', 'morph-hoodi-testnet', 'flare-coston2-testnet');
create type audit_status_t as enum ('settled', 'origin-error', 'settle-failed', 'policy-blocked', 'rate-limited');
create type sponsor_status_t as enum ('provisioning', 'ready', 'low-balance', 'rotating', 'decommissioned');

-- ─── publishers ─────────────────────────────────────────────────────────────

create table publishers (
  id uuid primary key default uuid_generate_v4(),
  -- one wallet per publisher; SIWE/Privy-validated lowercased 0x-address
  wallet_address text not null unique check (wallet_address ~ '^0x[a-f0-9]{40}$'),
  email text,
  -- handle drives URL paths (mcp.n-payment.dev/p/{handle}/{slug})
  handle text not null unique check (handle ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$'),
  custom_domain text unique,
  created_at timestamptz not null default now()
);

-- ─── billing_accounts ───────────────────────────────────────────────────────

create table billing_accounts (
  publisher_id uuid primary key references publishers(id) on delete cascade,
  stripe_customer text unique,
  tier tier_t not null default 'free',
  -- monthly tx allowance, reset by cron at month boundary
  included_volume_tx integer not null default 1000,
  settled_volume_tx integer not null default 0,
  -- USDC base units settled this month (for the metered volume fee invoice)
  settled_usdc bigint not null default 0,
  period_start timestamptz not null default date_trunc('month', now()),
  updated_at timestamptz not null default now()
);

-- ─── mcp_servers ────────────────────────────────────────────────────────────

create table mcp_servers (
  id uuid primary key default uuid_generate_v4(),
  publisher_id uuid not null references publishers(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$'),
  origin_url text not null check (origin_url ~ '^https://'),
  display_name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publisher_id, slug)
);

create index mcp_servers_status_idx on mcp_servers(status) where status = 'active';

-- ─── paid_tools ─────────────────────────────────────────────────────────────

create table paid_tools (
  id uuid primary key default uuid_generate_v4(),
  mcp_server_id uuid not null references mcp_servers(id) on delete cascade,
  name text not null check (name ~ '^[a-zA-Z0-9_-]{1,64}$'),
  description text,
  -- price in USDC base units (1_000_000 = $1)
  price_micros bigint not null check (price_micros >= 0),
  chain chain_t not null,
  schema_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (mcp_server_id, name)
);

-- ─── sponsor_wallets ────────────────────────────────────────────────────────
-- per-publisher per-chain sponsor wallet. encrypted_key uses pgsodium
-- column-level encryption: see security-and-keys.md.

create table sponsor_wallets (
  id uuid primary key default uuid_generate_v4(),
  publisher_id uuid not null references publishers(id) on delete cascade,
  chain chain_t not null,
  address text not null check (address ~ '^0x[a-f0-9]{40}$'),
  -- pgsodium-encrypted secp256k1 private key. NEVER read in user-facing routes.
  encrypted_key bytea not null,
  -- last observed balance in chain-native gas units (wei for EVM)
  balance numeric(78, 0) not null default 0,
  status sponsor_status_t not null default 'provisioning',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publisher_id, chain)
);

security label for pgsodium on column sponsor_wallets.encrypted_key is
  'ENCRYPT WITH KEY ID 00000000-0000-0000-0000-000000000000 SECURITY INVOKER';

-- ─── audit_entries ──────────────────────────────────────────────────────────
-- append-only. one row per facilitator settlement attempt.

create table audit_entries (
  id uuid primary key default uuid_generate_v4(),
  mcp_server_id uuid not null references mcp_servers(id) on delete cascade,
  paid_tool_id uuid references paid_tools(id) on delete set null,
  payment_id text not null check (payment_id ~ '^0x[a-f0-9]{64}$'),
  buyer_address text not null check (buyer_address ~ '^0x[a-f0-9]{40}$'),
  publisher_address text not null check (publisher_address ~ '^0x[a-f0-9]{40}$'),
  chain chain_t not null,
  amount bigint not null check (amount >= 0),
  fee bigint not null check (fee >= 0),
  publisher_amount bigint not null check (publisher_amount >= 0),
  tx_hash text check (tx_hash is null or tx_hash ~ '^0x[a-f0-9]{64}$'),
  status audit_status_t not null,
  latency_ms integer,
  error_code text,
  created_at timestamptz not null default now()
);

create unique index audit_entries_payment_id_idx on audit_entries(payment_id);
create index audit_entries_mcp_server_created_idx on audit_entries(mcp_server_id, created_at desc);
create index audit_entries_publisher_created_idx
  on audit_entries(mcp_server_id, status, created_at desc)
  where status = 'settled';

-- ─── reputation ─────────────────────────────────────────────────────────────

create table reputation (
  mcp_server_id uuid primary key references mcp_servers(id) on delete cascade,
  total_calls bigint not null default 0,
  failed_calls bigint not null default 0,
  p95_latency_ms integer,
  erc8004_token text,
  last_aggregated_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ─── rate_limit_buckets (Supabase replaces Upstash) ────────────────────────
-- Token-bucket-shaped rate limiter. Keyed by (key, window_start) where
-- window_start is the floor of the current interval. Cron prunes old rows.

create table rate_limit_buckets (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

create index rate_limit_buckets_prune_idx on rate_limit_buckets(window_start);

-- ─── verified_nonces (replay-protection cache) ──────────────────────────────
-- Facilitator records (chain, nonce) at /verify time; /settle re-checks
-- before signing. Cron prunes by expires_at.

create table verified_nonces (
  chain chain_t not null,
  nonce bytea not null,
  expires_at timestamptz not null,
  primary key (chain, nonce)
);

create index verified_nonces_prune_idx on verified_nonces(expires_at);

-- ─── helpers ────────────────────────────────────────────────────────────────

create or replace function current_publisher_id() returns uuid language sql stable as $$
  select id from publishers where wallet_address = lower(coalesce(auth.jwt() ->> 'wallet_address', ''))
$$;

-- updated_at trigger generator
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

create trigger mcp_servers_updated_at before update on mcp_servers
  for each row execute function set_updated_at();
create trigger sponsor_wallets_updated_at before update on sponsor_wallets
  for each row execute function set_updated_at();
create trigger billing_accounts_updated_at before update on billing_accounts
  for each row execute function set_updated_at();
create trigger reputation_updated_at before update on reputation
  for each row execute function set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table publishers enable row level security;
alter table billing_accounts enable row level security;
alter table mcp_servers enable row level security;
alter table paid_tools enable row level security;
alter table sponsor_wallets enable row level security;
alter table audit_entries enable row level security;
alter table reputation enable row level security;
alter table rate_limit_buckets enable row level security;
alter table verified_nonces enable row level security;

-- publishers: readable by self only; service-role inserts at signup
create policy publishers_self_read on publishers for select
  using (id = current_publisher_id());

-- billing_accounts: read self
create policy billing_self_read on billing_accounts for select
  using (publisher_id = current_publisher_id());

-- mcp_servers: full CRUD scoped to self
create policy mcp_servers_self_all on mcp_servers for all
  using (publisher_id = current_publisher_id())
  with check (publisher_id = current_publisher_id());

-- paid_tools: scoped via mcp_server.publisher_id
create policy paid_tools_self_all on paid_tools for all
  using (
    exists (select 1 from mcp_servers s where s.id = paid_tools.mcp_server_id and s.publisher_id = current_publisher_id())
  )
  with check (
    exists (select 1 from mcp_servers s where s.id = paid_tools.mcp_server_id and s.publisher_id = current_publisher_id())
  );

-- sponsor_wallets: read-only address+balance+status. encrypted_key NEVER selectable from user role.
revoke select (encrypted_key) on sponsor_wallets from anon, authenticated;
create policy sponsor_wallets_self_read_meta on sponsor_wallets for select
  using (publisher_id = current_publisher_id());

-- audit_entries: read-only for self via mcp_servers join (NO insert/update/delete from user role)
create policy audit_entries_self_read on audit_entries for select
  using (
    exists (select 1 from mcp_servers s where s.id = audit_entries.mcp_server_id and s.publisher_id = current_publisher_id())
  );

-- reputation: world-readable (public reputation pages); writes only via service role
create policy reputation_public_read on reputation for select using (true);

-- ─── seed (for local dev) ───────────────────────────────────────────────────

-- not run in production; seeds done via apps/gateway/supabase/seed.sql
