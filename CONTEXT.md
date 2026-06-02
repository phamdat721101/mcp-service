# CONTEXT — n-payment Gateway

> Read this first. Every other doc in this repo is a depth-first child of what's here.

## What this is

`mcp-service` is the hosted **paid MCP-as-a-Service** product on top of the [n-payment SDK](https://www.npmjs.com/package/n-payment). Publishers ship a paid MCP server in 5 minutes; AI agents in Claude Desktop / Cursor / Bedrock / Codex / ChatGPT discover and pay for tools in USDC. We host the gateway, facilitator, dashboard, billing, and reputation. Publishers keep 99%+ of revenue; we keep $19/$49/$99 in tier fees + 0.5% on settled volume above the tier's allowance.

The beachhead, market context, architecture review, and 90-day plan live in `/Users/phamdat/biz-team/bd-team/research/n-payment/2026-06-01-sdk-v019-deep-dive/` (READMEs 01–05).

## Core architecture in one paragraph

A buyer's AI agent makes an MCP `tools/call` against `mcp.n-payment.dev/mcp/<handle>/<server>`. The Gateway (Vercel) proxies to the publisher's origin and rewrites the resulting `-32402` envelope so `payTo` points at our `X402FeeSplitFacilitator.sol` and `extra.publisherPayTo` carries the publisher's address + `gatewayFeeBps`. The buyer signs an EIP-3009 authorization. The facilitator (Fly.io, multi-region) verifies the signature, then settles via `X402FeeSplitFacilitator.settle(...)`, which atomically splits `(amount × (10000 − feeBps) / 10000)` to the publisher and the residue to our fee wallet. Sponsorship gas is paid by a per-publisher sponsor wallet generated through `OWSWallet` from the SDK; the encrypted private key lives in Supabase Vault. SIWE auth via Privy → JWT → Supabase RLS. Rate limiting, nonce dedupe, and short-TTL caches all live in Supabase Postgres (no Upstash in v0.1).

## Repo layout

```
apps/
  gateway/        Next.js (Vercel)        — dashboard, /api/*, /mcp/*, /p/* (public reputation)
  facilitator/    Hono on Node (Fly.io)   — /x402/v2/{supported,verify,settle}
  cli/            @n-payment/gateway      — login, publish, status
packages/
  contracts/      Foundry                 — X402FeeSplitFacilitator.sol + tests + deploys
  shared/         TypeScript              — types, error taxonomy, contract addresses, chain registry
  lighthouse-mcps/                        — reference paid MCP servers
.kiro/steering/                            — split product/architecture/coding/security/testing docs
```

## The 4 chains we support at launch

| Chain | Use | Facilitator | Sponsor |
|---|---|---|---|
| Base mainnet (8453) | Revenue rail (USDC `0x833589…2913`) | `X402FeeSplitFacilitator` (deployed) | Buyer pays gas (CDP-style) or sponsor (paid tier) |
| Base Sepolia (84532) | Testing | Same contract | Per-publisher sponsor |
| Morph Hoodi (2910) | Sponsored EIP-3009, zero-ETH buyer | `X402FeeSplitFacilitator` | Per-publisher sponsor (always) |
| Flare Coston2 (114) | Gasless FXRP via forwarder | `X402FeeSplitForwarder` (forwarder variant) | Per-publisher sponsor |

## Pricing & business model

- **Free**: 1 server / 1 paid tool / 1,000 settled tx/mo / public reputation page.
- **Pro $19/mo**: unlimited servers, 10 tools/server, 10K tx/mo, custom domain, sponsored facilitator, webhooks.
- **Team $49/mo**: 100K tx/mo, multi-publisher access, ERC-8004 reputation registration helpers, advanced analytics.
- **Enterprise $99+/mo**: unlimited tx, SLA, support, private deploy.
- **Volume fee**: 0.5% on settled USDC volume **above the tier's included allowance**. Skimmed atomically on-chain by `X402FeeSplitFacilitator`.

## Quality bar (non-negotiable)

- ≥80% line coverage in `apps/gateway`, `apps/facilitator`, `packages/contracts`.
- P95 verify+settle < 500ms warm / 1.5s cold.
- 99.5% uptime with public status page.
- All public errors have stable `code` strings (see `packages/shared/src/errors.ts`).
- No new chain or protocol = no `apps/*/src/client.ts` edit (use `packages/shared/src/chain-registry.ts`).
- No publisher's data is reachable from another publisher's session — RLS is mandatory, never service-role from user-facing routes.

## What lives where (when in doubt)

- **Type a payment touches?** `packages/shared/src/types.ts`. Reuse `n-payment` types where possible.
- **Error to throw?** `packages/shared/src/errors.ts` — never `throw new Error(...)`.
- **Contract address or ABI?** `packages/shared/src/contracts.ts`.
- **Chain config?** `packages/shared/src/chains.ts`. Mirrors `n-payment/src/chains.ts` shape.
- **DB query?** `apps/gateway/src/db/` — typed Supabase client, never raw SQL strings in route handlers.
- **Sign with sponsor?** `apps/facilitator/src/treasury.ts` — never instantiate viem accounts directly.
- **Cron/job?** Vercel Cron in `apps/gateway/src/app/api/cron/*`.

## Conventions (enforced by lint + review)

- TypeScript strict, no `any` outside test fixtures.
- Each module owns one responsibility (SOLID); files > 250 LOC are a code-smell signal.
- No new file unless it earns its existence; prefer extending an existing file.
- Public functions documented with one-line summary + invariants.
- Tests colocated `*.test.ts` next to source.
- Use `bigint` for token amounts; never `number`.
- Never log private keys, raw EIP-3009 auths, or full Privy JWTs. `audit_entries` is the system of record.

## The n-payment SDK is a peer, not a fork

- We depend on `n-payment` from npm.
- We contribute back: F7 (error taxonomy), F5 (unified PaymentChallenge), F2 (two-pass amount-aware policy) ship as upstream PRs first, then we consume the published version.
- Do not fork the SDK into this repo.

## Where to start reading code

1. `packages/contracts/src/X402FeeSplitFacilitator.sol` — the on-chain piece is the simplest to read.
2. `apps/facilitator/src/server.ts` — entry point of the per-payment hot path.
3. `apps/gateway/src/app/mcp/[handle]/[server]/route.ts` — the proxy + envelope rewrite.
4. `apps/gateway/supabase/migrations/0001_init.sql` — data model.
5. `apps/cli/src/commands/publish.ts` — what a publisher actually does.

## How to extend safely

Adding a chain: edit `packages/shared/src/chains.ts` + deploy the contract via `packages/contracts/script/Deploy.s.sol` + add the address to `packages/shared/src/contracts.ts`. No app code change.

Adding a tier feature: gate it on `billing_accounts.tier` check in `apps/gateway/src/lib/billing/tier.ts`, never inline.

Adding an audit dimension: extend `audit_entries` in a new migration, then index it in the analytics SQL views. Never re-aggregate from raw events at request time.
