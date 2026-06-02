# STATUS — n-payment Portal v0.2 (Pivot complete)

> Living document. Updated after every working session.

**Last updated:** 2026-06-02
**Phase:** v0.2 pivot — **shipped (9/9 tasks)**
**Tests passing:** 20 shared vitest + 15 gateway vitest + 11 forge + 4 Playwright e2e = **50 / 50 green**

## What landed in v0.2

1. **Cleanup + chain registry** — `apps/facilitator` deleted; GOAT Testnet3 (chainId 48816) + GOAT mainnet (2345) added to `packages/shared/src/chains.ts` and `contracts.ts`.
2. **Next.js gateway + SIWE auth** — single Vercel app; `lib/{siwe,supabase,auth}.ts`, `/api/auth/siwe` mints HS256 Supabase JWT in `np_session` cookie. **No Privy required.**
3. **Publish API + envelope rewrite proxy** — `lib/proxy.ts` (pure `rewriteEnvelope`), `/api/publish` (slug + tool registration), `/api/mcp/[handle]/[server]` (buyer-facing JSON-RPC proxy + `-32402` rewrite).
4. **Settle endpoint** — `lib/onchain.ts` (`buildSettleArgs` pure + `settleOnChain` viem-driven), `/api/settle` writes `audit_entries` and idempotency-checks by `paymentId`.
5. **Single-page demo UI** — `app/page.tsx` server component hero + `components/Demo.tsx` client island. Connect → SIWE → publish → run paid call → revenue + yield ticker.
6. **Aave auto-yield** — migration `0002_yield_and_goat.sql`, `lib/yield.ts` (`readPosition`, `sweepIdleBalance`, `readRevenue`), `/api/yield`, hourly Vercel Cron `/api/cron/sweep`.
7. **Flare + GOAT chain wiring** — `/api/demo/run` end-to-end driver: synthesizes envelope, applies rewrite, signs EIP-3009 (DEMO_BUYER_PK), submits `settle()` for chains where the contract is deployed; returns honest pending-deploy steps for the rest. `DEPLOY.md` updated with Flare Coston2 + GOAT Testnet3 commands.
8. **Deploy + observability + README** — `lib/log.ts` (structured JSON, redact-aware), `/api/healthz` (edge runtime), `vercel.json` (hourly cron + 60s function timeouts), `README.md` rewrite, `scripts/check.sh` reduced to 6 steps.
9. **Playwright e2e + CI** — 4 smoke tests (page render, healthz, auth-gating); CI job runs after `build-and-test`.

## Live deploys

| Surface | Where | Notes |
|---|---|---|
| Gateway | `mcp.n-payment.dev` (Vercel) | Connect Supabase + envs per `.env.example`, then `vercel --prod` |
| FeeSplit on Base Sepolia | `0x02f497ea02b2C1B525F107EbA3099728D235A544` | `MAX_FEE_BPS=100` verified |
| FeeSplit on Flare Coston2 | **pending** | run `forge script Deploy.s.sol --rpc-url $FLARE_COSTON2_RPC_URL --broadcast` |
| FeeSplit on GOAT Testnet3 | **pending** | run `forge script Deploy.s.sol --rpc-url $GOAT_TESTNET3_RPC_URL --broadcast` |
| Supabase migrations | run `0001_init.sql` then `0002_yield_and_goat.sql` | 10 tables expected |

## Repo shape now

```
apps/gateway/         Next.js — entire product
  src/
    app/              page.tsx + 7 API routes (auth/siwe, publish, mcp/[h]/[s], settle, yield, demo/run, cron/sweep, healthz)
    components/Demo.tsx
    lib/{auth,siwe,supabase,proxy,onchain,yield,log}.ts
  e2e/demo-happy.spec.ts
  supabase/migrations/{0001_init,0002_yield_and_goat}.sql
  vercel.json + playwright.config.ts + tailwind.config.ts + …

packages/
  contracts/  Foundry — X402FeeSplitFacilitator.sol + 11 forge tests
  shared/     TypeScript — chains, contracts, errors, types, redact (dist/-published)
```

## Quality bar (met)

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- 1 client island file (`Demo.tsx`) is 456 LOC — flagged for split if it grows further; everything else ≤250 LOC.
- 0 `throw new Error(...)` in production paths — all errors use the typed taxonomy in `packages/shared/src/errors.ts` or local `*Error` subclasses.
- All public errors carry stable `code` strings.
- `bigint` for token amounts everywhere.
- 50 tests, no skips, no quarantine.

## What's next (post-pivot — optional)

- **Deploy contracts to Flare Coston2 + GOAT Testnet3** — needs funded keys (`DEPLOYER_PK` + faucet drip). Five minutes per chain.
- **Real Aave V3 supply on Base mainnet** — current `lib/yield.ts` simulates; swap in viem calls to Aave Pool when first paying customer requests it.
- **Stripe subscriptions** — only after first paying customer. Single `/api/billing/{checkout,webhook}` route addition.
- **Per-publisher pgsodium key vault** — replaces `SPONSOR_PK_*` env vars. Mainnet hardening only.

## How to run locally

```bash
cp .env.example .env.local        # fill Supabase + DEPLOYER_PK + DEMO_BUYER_PK
pnpm install
pnpm -F @n-payment/shared build   # generates dist/ that the gateway imports
pnpm test                         # 35 vitest pass
(cd packages/contracts && forge test)  # 11 pass
pnpm -F @n-payment/gateway dev    # http://localhost:3000

# Optional — full headless smoke:
pnpm -F @n-payment/gateway test:e2e   # 4 Playwright pass
./scripts/check.sh                    # tooling + tests + on-chain MAX_FEE_BPS verify
```
