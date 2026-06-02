# mcp-service — n-payment Portal

> Open portal for API providers and web3 projects to publish paid MCP servers in 60 seconds. USDC settlement on Base, Flare, GOAT — and your idle balance auto-yields on Aave.

```
mcp.n-payment.dev
```

Built on the [n-payment SDK](https://www.npmjs.com/package/n-payment) (v0.19) — `createPaidMcpServer`, `FlareX402Adapter`, `GoatX402Client`, and `aave: { autoYield }` do the heavy lifting; this repo is the hosted portal that wraps it with a fee-aware `X402FeeSplitFacilitator` contract, publisher onboarding, and a one-page visual demo.

## What it does

1. **Publish** — connect wallet, paste your HTTPS MCP origin, get a public URL: `mcp.n-payment.dev/api/mcp/<address>/<slug>`.
2. **Get paid** — Claude / Cursor / Bedrock / ChatGPT / Codex agents discover and pay in USDC.
3. **Earn yield** — settled USDC auto-sweeps to Aave; you see APY ticking on the dashboard and can withdraw any time.
4. **Three testnets at launch** — Base Sepolia (live), Flare Coston2, GOAT Testnet3.

## Repo layout

```
apps/gateway/         Next.js on Vercel — the entire product
  src/
    app/
      page.tsx        Single-page demo UI (server component)
      api/
        auth/siwe/    SIWE login → Supabase JWT
        publish/      Register MCP server
        mcp/[h]/[s]/  Buyer-facing JSON-RPC proxy + envelope rewrite
        settle/       FeeSplit.settle() via viem
        yield/        Read revenue + Aave position
        demo/run/     End-to-end demo flow used by the UI
        cron/sweep/   Vercel Cron — sweep idle USDC into Aave
        healthz/      Boring 200
    components/Demo.tsx   Client island — connect → SIWE → publish → run
    lib/{auth,siwe,supabase,proxy,onchain,yield,log}.ts
  supabase/migrations/  0001_init.sql + 0002_yield_and_goat.sql

packages/
  contracts/    Foundry — X402FeeSplitFacilitator.sol (1% hard cap)
  shared/       TypeScript — chains, contracts, errors, types, redact
```

## Quick start (local)

```bash
./scripts/run.sh
# → http://localhost:3000
```

That single command:

1. checks tooling (node ≥20, pnpm, optional forge/cast)
2. scaffolds `.env.local` if missing (dev defaults, never overwrites real values)
3. installs deps (`pnpm install --frozen-lockfile`)
4. builds `packages/shared/dist`
5. runs vitest + forge tests
6. smoke-checks the Base Sepolia contract (`cast call MAX_FEE_BPS`)
7. starts the Next.js dev server on port 3000
8. polls `/api/healthz`, prints the URL + demo flow, tails logs

Useful flags:

```bash
./scripts/run.sh --skip-tests           # save ~10s when iterating
./scripts/run.sh --skip-onchain         # offline-friendly
./scripts/run.sh --port 3001 --open     # alt port + open browser
./scripts/run.sh --prod                 # next build && next start (production)
```

To run only the read-only smoke check (no dev server):

```bash
./scripts/check.sh
```

## Deploy

| Surface | Target | Doc |
|---|---|---|
| Gateway + Demo | Vercel + Supabase | this README's "Vercel" section |
| Contracts | Foundry → 4 chains | `packages/contracts/DEPLOY.md` |

### Vercel

1. Create a Supabase project. Run `apps/gateway/supabase/migrations/{0001,0002}_*.sql` against it.
2. Deploy with the [Vercel button](https://vercel.com/new/clone?repository-url=https://github.com/phamdat721101/n-payment-mcp) (or `vercel --prod`).
3. Set env from `.env.example` (Supabase keys, sponsor PKs, demo buyer PK, CRON_BEARER).
4. Vercel Cron auto-attaches the daily 06:00 UTC `/api/cron/sweep` per `apps/gateway/vercel.json` (Hobby-tier compatible).
5. Smoke: visit the preview URL → connect a wallet → publish → click "Run paid call" → see a real Base Sepolia tx hash.

### Contracts

Deploy `X402FeeSplitFacilitator` per chain (commands in `packages/contracts/DEPLOY.md`). Copy each address into `packages/shared/src/contracts.ts`, rebuild shared, redeploy gateway. **Status:** Base Sepolia live (`0x02f4…A544`); Flare + GOAT pending user-funded keys.

## How it makes revenue

- **0.5% volume fee** (1% on Free tier) skimmed atomically on-chain by `X402FeeSplitFacilitator.settle()`. No collections risk; one tx pays publisher + fee receiver.
- Free / Pro $19 / Team $49 / Enterprise tiers — Stripe billing arrives after first paid customer.

## Quality bar

- ≥80% coverage on `apps/gateway`, ≥90% on `packages/shared`, 100% on `X402FeeSplit*`.
- Single Vercel deployment + one Supabase project = entire product.
- All public errors carry stable `code` strings (`packages/shared/src/errors.ts`).
- `bigint` for token amounts everywhere.
- File budget: ≤250 LOC healthy; SOLID enforced at PR review.

## License

MIT.
