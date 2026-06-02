# Deploying X402FeeSplitFacilitator

The contract is **chain-agnostic**: same bytecode, deploy once per chain, address recorded in `packages/shared/src/contracts.ts`.

## Prereqs

- A funded EOA on the target chain.
  - Base Sepolia: ~0.005 ETH (https://faucet.quicknode.com/base/sepolia).
  - Flare Coston2: ~5 C2FLR (https://coston2-faucet.towolabs.com).
  - GOAT Testnet3: ~0.001 BTC equivalent (https://bridge.testnet3.goat.network/faucet).
- `DEPLOYER_PK` env var set (hex, no `0x` prefix or with — both accepted by forge).
- For verification (optional): Etherscan/Routescan API keys.

## Per-chain commands

```bash
cd packages/contracts

# 1. Base Sepolia (DONE — 0x02f497ea02b2C1B525F107EbA3099728D235A544)
DEPLOYER_PK=$DEPLOYER_PK \
  forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --verify --etherscan-api-key $BASESCAN_KEY

# 2. Flare Coston2 — first deal target
DEPLOYER_PK=$DEPLOYER_PK \
  forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://coston2-api.flare.network/ext/C/rpc \
  --broadcast

# 3. GOAT Testnet3 — second deal target
DEPLOYER_PK=$DEPLOYER_PK \
  forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet3.goat.network \
  --broadcast

# 4. Mainnets (LAST — verify on test rails first)
DEPLOYER_PK=$DEPLOYER_PK forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://mainnet.base.org --broadcast --verify --etherscan-api-key $BASESCAN_KEY
DEPLOYER_PK=$DEPLOYER_PK forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.goat.network --broadcast
```

## After each deploy

1. Copy the printed address into `packages/shared/src/contracts.ts` under the matching `ChainKey`.
2. Set `feeReceiver` to a Gateway-controlled address. For testnets the deployer doubles as fee receiver (already set on Base Sepolia).
3. Smoke check: `cast call <facilitator> "MAX_FEE_BPS()(uint16)" --rpc-url <rpc>` should return `100`.
4. Rebuild shared so the Next.js gateway picks up the new addresses: `pnpm -F @n-payment/shared build`.
5. Update `STATUS.md` deploys table.

## Forwarder variant for Flare Coston2

Flare Coston2 supports both standard EIP-3009 (against MockUSDT0) AND the gasless Forwarder pattern. v0.2 deploys the **standard** `X402FeeSplitFacilitator` and uses MockUSDT0 as the asset — buyer signs EIP-3009, sponsor pays gas. The forwarder variant for fully gasless C2FLR is queued for v0.3.

## Audit + verification

- 100% line coverage Foundry tests + 512-run fuzz in `packages/contracts/test/`. CI gates 100% coverage on `X402FeeSplit*`.
- External audit: queued post-revenue.
- Until then, MAX_FEE_BPS = 100 (1% hard cap) limits worst-case loss from a contract bug.
