/**
 * Unified payment shapes the Gateway, Facilitator, and CLI all consume.
 *
 * These are the F5 equivalent from the SDK upgrade plan, scoped to what we
 * need locally. When the upstream n-payment PR lands the same shape, this
 * file collapses to a re-export.
 */
import type { ChainKey } from './chains.js';

export type ProtocolScheme = 'eip3009' | 'eip3009-forwarder';

/** Normalized payment challenge — one shape regardless of upstream envelope. */
export interface PaymentChallenge {
  protocol: 'x402';
  chain: ChainKey;
  scheme: ProtocolScheme;
  asset: `0x${string}`;
  /** Where the buyer's USDC ultimately goes (= X402FeeSplitFacilitator on our gateway). */
  payTo: `0x${string}`;
  amount: bigint;
  /** Unix seconds when the auth must be settled by. */
  expiresAt: number;
  /** Optional facilitator URL the buyer should hit (defaults to ours). */
  facilitator?: string;
  /** Gateway-injected metadata (the rewrite from the publisher's bare envelope). */
  extra: {
    publisherPayTo: `0x${string}`;
    gatewayFeeBps: number;
    gatewayFeeReceiver: `0x${string}`;
    paymentId: `0x${string}`;
  };
  /** Original envelope kept for audit + debugging. */
  raw: Record<string, unknown>;
}

/** Normalized receipt after on-chain settlement. */
export interface PaymentReceipt {
  protocol: 'x402';
  chain: ChainKey;
  paymentId: `0x${string}`;
  txHash: `0x${string}`;
  amount: bigint;
  fee: bigint;
  publisherAmount: bigint;
  asset: `0x${string}`;
  blockNumber: bigint;
  settledAt: number;
}

/** Compute fee math the way the contract does (integer division toward zero). */
export function computeFeeSplit(amount: bigint, feeBps: number): { fee: bigint; publisherAmount: bigint } {
  if (feeBps < 0 || feeBps > 100) throw new RangeError(`feeBps out of range [0,100]: ${feeBps}`);
  const fee = (amount * BigInt(feeBps)) / 10000n;
  return { fee, publisherAmount: amount - fee };
}

/** Tier → fee bps lookup. Single source consumed by gateway + facilitator. */
export const TIER_FEE_BPS: Record<'free' | 'pro' | 'team' | 'enterprise', number> = {
  free: 100, // 1% (capped per product.md)
  pro: 50, // 0.5%
  team: 50, // 0.5%
  enterprise: 0, // negotiated
};
