-- seed.sql — local dev only. Production uses real publisher signups.
insert into publishers (id, wallet_address, email, handle)
values (
  '00000000-0000-0000-0000-000000000001',
  '0x742d35cc6634c0532925a3b844bc9e7595f0beb1',
  'demo@n-payment.dev',
  'demo'
) on conflict do nothing;

insert into billing_accounts (publisher_id, tier, included_volume_tx)
values ('00000000-0000-0000-0000-000000000001', 'free', 1000)
on conflict do nothing;

insert into mcp_servers (id, publisher_id, slug, origin_url, display_name, description)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-000000000001',
  'weather',
  'https://example-weather.vercel.app',
  'Demo Weather MCP',
  'A reference paid MCP server for local testing.'
) on conflict do nothing;

insert into paid_tools (mcp_server_id, name, description, price_micros, chain)
values (
  '00000000-0000-0000-0000-0000000000a1',
  'forecast',
  'Get the forecast for a city',
  10000,
  'base-sepolia'
) on conflict do nothing;
