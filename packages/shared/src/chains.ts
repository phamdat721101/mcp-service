/**
 * Chain registry. The Gateway, facilitator, contracts deploy scripts, and CLI
 * all import from here. Adding a chain = one entry; no app code changes.
 */

export type ChainKey =
  | 'base-mainnet'
  | 'base-sepolia'
  | 'morph-hoodi-testnet'
  | 'flare-coston2-testnet'
  | 'goat-testnet3'
  | 'goat-mainnet';

export interface ChainConfig {
  key: ChainKey;
  /** EIP-155 chain id. */
  chainId: number;
  /** Human label. */
  name: string;
  /** CAIP-2 string used in x402 envelope `network` field. */
  caip2: string;
  /** Public RPC. Override via env in production. */
  rpcUrl: string;
  /** Block explorer (for audit links). */
  explorer: string;
  /** USDC (or test stable) ERC-20 address. */
  usdc: `0x${string}`;
  /**
   * EIP-712 domain overrides for non-canonical USDC deployments.
   * Morph Hoodi USDC reports `name() = "USDC"` not `"USD Coin"` — must override.
   */
  usdcDomain: { name: string; version: string };
  /** Variant to deploy: standard EIP-3009 settle vs forwarder (Flare). */
  contractVariant: 'fee-split' | 'fee-split-forwarder';
  /** Whether buyers must use a sponsor wallet (sponsored gas). */
  sponsoredGas: boolean;
  /** Whether testnet (affects faucet links + reputation aggregation rules). */
  testnet: boolean;
}

export const CHAINS: Readonly<Record<ChainKey, ChainConfig>> = Object.freeze({
  'base-mainnet': {
    key: 'base-mainnet',
    chainId: 8453,
    name: 'Base',
    caip2: 'eip155:8453',
    rpcUrl: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDomain: { name: 'USD Coin', version: '2' },
    contractVariant: 'fee-split',
    sponsoredGas: false,
    testnet: false,
  },
  'base-sepolia': {
    key: 'base-sepolia',
    chainId: 84532,
    name: 'Base Sepolia',
    caip2: 'eip155:84532',
    rpcUrl: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcDomain: { name: 'USDC', version: '2' },
    contractVariant: 'fee-split',
    sponsoredGas: false,
    testnet: true,
  },
  'morph-hoodi-testnet': {
    key: 'morph-hoodi-testnet',
    chainId: 2910,
    name: 'Morph Hoodi',
    caip2: 'eip155:2910',
    rpcUrl: 'https://rpc-quicknode-holesky.morphl2.io',
    explorer: 'https://explorer-holesky.morphl2.io',
    usdc: '0x7433b41C6c5e1d58D4Da99483609520255ab661B',
    usdcDomain: { name: 'USDC', version: '2' },
    contractVariant: 'fee-split',
    sponsoredGas: true,
    testnet: true,
  },
  'flare-coston2-testnet': {
    key: 'flare-coston2-testnet',
    chainId: 114,
    name: 'Flare Coston2',
    caip2: 'eip155:114',
    rpcUrl: 'https://coston2-api.flare.network/ext/C/rpc',
    explorer: 'https://coston2-explorer.flare.network',
    // Set at deploy time — Coston2 uses MockUSDT0 for the x402 lighthouse.
    usdc: '0x0000000000000000000000000000000000000000',
    usdcDomain: { name: 'MockUSDT0', version: '1' },
    contractVariant: 'fee-split-forwarder',
    sponsoredGas: true,
    testnet: true,
  },
  'goat-testnet3': {
    key: 'goat-testnet3',
    chainId: 48816,
    name: 'GOAT Testnet3',
    caip2: 'eip155:48816',
    rpcUrl: 'https://rpc.testnet3.goat.network',
    explorer: 'https://explorer.testnet3.goat.network',
    // GOAT has no native USDC issuer; testnet uses a deterministic mock via
    // n-payment SDK's UsdcAcquisitionRouter.testnet() preset. Address set at deploy.
    usdc: '0x0000000000000000000000000000000000000000',
    usdcDomain: { name: 'USDC', version: '2' },
    contractVariant: 'fee-split',
    sponsoredGas: true,
    testnet: true,
  },
  'goat-mainnet': {
    key: 'goat-mainnet',
    chainId: 2345,
    name: 'GOAT Network',
    caip2: 'eip155:2345',
    rpcUrl: 'https://rpc.goat.network',
    explorer: 'https://explorer.goat.network',
    // Mainnet USDC arrives via LayerZero V2 OFT or PegBTC swap; address set at deploy.
    usdc: '0x0000000000000000000000000000000000000000',
    usdcDomain: { name: 'USDC', version: '2' },
    contractVariant: 'fee-split',
    sponsoredGas: false,
    testnet: false,
  },
});

export function getChain(key: ChainKey): ChainConfig {
  return CHAINS[key];
}

export function getMainnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => !c.testnet);
}

export function getTestnetChains(): ChainConfig[] {
  return Object.values(CHAINS).filter((c) => c.testnet);
}
