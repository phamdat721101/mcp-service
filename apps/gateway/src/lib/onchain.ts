/**
 * On-chain helpers for the gateway settle path.
 *
 * Two functions:
 *   1. `buildSettleArgs(envelope, payload)` — PURE. Validates shapes and
 *      returns the typed argument tuple expected by FeeSplit.settle.
 *   2. `settleOnChain(chain, args, sponsorPk)` — side effects: builds viem
 *      clients, submits the tx, waits one confirmation, decodes Settled
 *      event, returns a typed receipt.
 *
 * SOLID:
 *   - Single Responsibility per function (one pure, one side-effect).
 *   - Open-Closed: adding a chain = add an env var name + mapping; nothing
 *     in the body needs editing.
 *   - Dependency Inversion: callers pass a sponsor private key in. The route
 *     reads it from env once; tests pass a fake.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAINS, CONTRACTS, FEE_SPLIT_ABI, type ChainKey } from '@n-payment/shared';

export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string; // base units
  validAfter: string; // unix seconds
  validBefore: string;
  nonce: Hex; // 0x-bytes32
  v: number;
  r: Hex;
  s: Hex;
}

export interface SettleArgs {
  chain: ChainKey;
  token: Address;
  from: Address;
  amount: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  v: number;
  r: Hex;
  s: Hex;
  publisherPayTo: Address;
  feeBps: number;
  feeReceiver: Address;
  paymentId: Hex;
}

export class SettleArgsError extends Error {
  constructor(public readonly reason: 'envelope' | 'payload' | 'mismatch' | 'unsupported-chain') {
    super(`settle.${reason}`);
    this.name = 'SettleArgsError';
  }
}

/**
 * Combine the rewritten envelope (with extra metadata) with the buyer's
 * signed EIP-3009 payload to build the contract call args.
 */
export function buildSettleArgs(envelope: unknown, payload: unknown): SettleArgs {
  const accept = pickAccept(envelope);
  const auth = pickAuth(payload);
  const extra = accept.extra ?? {};

  const chain = caip2ToChainKey(accept.network);
  if (!chain) throw new SettleArgsError('unsupported-chain');
  if (auth.value !== accept.maxAmountRequired) throw new SettleArgsError('mismatch');

  return {
    chain,
    token: accept.asset.toLowerCase() as Address,
    from: auth.from.toLowerCase() as Address,
    amount: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
    v: auth.v,
    r: auth.r,
    s: auth.s,
    publisherPayTo: (extra.publisherPayTo as Address).toLowerCase() as Address,
    feeBps: Number(extra.gatewayFeeBps),
    feeReceiver: (extra.gatewayFeeReceiver as Address).toLowerCase() as Address,
    paymentId: extra.paymentId as Hex,
  };
}

export interface SettleReceipt {
  txHash: Hex;
  blockNumber: bigint;
  fee: bigint;
  publisherAmount: bigint;
  amount: bigint;
  paymentId: Hex;
}

export async function settleOnChain(
  args: SettleArgs,
  sponsorPk: Hex,
  publicClientOverride?: PublicClient,
): Promise<SettleReceipt> {
  const chainCfg = CHAINS[args.chain];
  const feeSplit = CONTRACTS[args.chain].feeSplit;
  if (feeSplit === '0x0000000000000000000000000000000000000000') {
    throw new SettleArgsError('unsupported-chain');
  }

  const transport = http(chainCfg.rpcUrl);
  const publicClient = publicClientOverride ?? createPublicClient({ transport });
  const wallet = createWalletClient({
    account: privateKeyToAccount(sponsorPk),
    transport,
    chain: { id: chainCfg.chainId, name: chainCfg.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [chainCfg.rpcUrl] } } } as never,
  });

  const txHash = await wallet.writeContract({
    address: feeSplit,
    abi: FEE_SPLIT_ABI,
    functionName: 'settle',
    args: [
      args.token,
      args.from,
      args.amount,
      args.validAfter,
      args.validBefore,
      args.nonce,
      args.v,
      args.r,
      args.s,
      args.publisherPayTo,
      args.feeBps,
      args.feeReceiver,
      args.paymentId,
    ],
  } as never);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const settled = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({ abi: FEE_SPLIT_ABI, data: log.data, topics: log.topics });
      } catch {
        return null;
      }
    })
    .find((e) => e?.eventName === 'Settled');

  const eventArgs = (settled?.args ?? {}) as { fee?: bigint; amount?: bigint };
  const fee = eventArgs.fee ?? 0n;
  const amount = eventArgs.amount ?? args.amount;
  return {
    txHash,
    blockNumber: receipt.blockNumber,
    fee,
    amount,
    publisherAmount: amount - fee,
    paymentId: args.paymentId,
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────

interface AcceptShape {
  network: string;
  asset: Address;
  maxAmountRequired: string;
  payTo: Address;
  extra?: Record<string, unknown>;
}

function pickAccept(envelope: unknown): AcceptShape {
  if (
    typeof envelope !== 'object' ||
    envelope === null ||
    !Array.isArray((envelope as { accepts?: unknown[] }).accepts)
  ) {
    throw new SettleArgsError('envelope');
  }
  const a = (envelope as { accepts: AcceptShape[] }).accepts[0];
  if (!a || typeof a.network !== 'string' || typeof a.asset !== 'string') throw new SettleArgsError('envelope');
  return a;
}

function pickAuth(payload: unknown): Eip3009Authorization {
  if (typeof payload !== 'object' || payload === null) throw new SettleArgsError('payload');
  const p = payload as { authorization?: Eip3009Authorization; signature?: { v?: number; r?: Hex; s?: Hex } };
  const a = p.authorization;
  if (!a || typeof a.from !== 'string' || typeof a.value !== 'string') throw new SettleArgsError('payload');
  // Allow signature fields either flattened on auth or nested under .signature.
  const v = a.v ?? p.signature?.v;
  const r = a.r ?? p.signature?.r;
  const s = a.s ?? p.signature?.s;
  if (typeof v !== 'number' || !r || !s) throw new SettleArgsError('payload');
  return { ...a, v, r, s };
}

function caip2ToChainKey(network: string): ChainKey | null {
  for (const cfg of Object.values(CHAINS)) {
    if (cfg.caip2 === network) return cfg.key;
  }
  return null;
}

const SPONSOR_ENV: Record<ChainKey, string> = {
  'base-mainnet': 'SPONSOR_PK_BASE_MAINNET',
  'base-sepolia': 'SPONSOR_PK_BASE_SEPOLIA',
  'morph-hoodi-testnet': 'SPONSOR_PK_MORPH_HOODI',
  'flare-coston2-testnet': 'SPONSOR_PK_FLARE_COSTON2',
  'goat-testnet3': 'SPONSOR_PK_GOAT_TESTNET3',
  'goat-mainnet': 'SPONSOR_PK_GOAT_MAINNET',
};

export function sponsorKeyFor(chain: ChainKey): Hex {
  const v = process.env[SPONSOR_ENV[chain]];
  if (!v) throw new SettleArgsError('unsupported-chain');
  return (v.startsWith('0x') ? v : `0x${v}`) as Hex;
}
