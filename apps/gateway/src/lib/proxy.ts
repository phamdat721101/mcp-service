/**
 * Envelope rewrite — the gateway's "wedge".
 *
 * Takes the publisher's -32402 envelope (where `payTo = publisher`) and
 * returns one where `payTo = X402FeeSplitFacilitator` and `extra` carries
 * publisherPayTo, gatewayFeeBps, gatewayFeeReceiver, paymentId.
 *
 * Pure function. Caller provides:
 *   - the parsed envelope (already base64-decoded)
 *   - the rewrite context (chain-resolved addresses + fee policy)
 *
 * SOLID:
 *   - Single Responsibility: shape transformation only. Base64 + HTTP framing
 *     happen at the route boundary.
 *   - Open-Closed: chain-specific quirks (Flare forwarder envelope) extend by
 *     branching on `ctx.scheme`, never by editing existing branches.
 */

export interface RewriteContext {
  feeSplitAddress: `0x${string}`;
  publisherPayTo: `0x${string}`;
  gatewayFeeBps: number;
  gatewayFeeReceiver: `0x${string}`;
  paymentId: `0x${string}`;
  scheme?: 'exact' | 'flare-forwarder';
}

export interface AcceptItem {
  scheme?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  maxAmountRequired?: string;
  validAfter?: string | number;
  validBefore?: string | number;
  extra?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Envelope {
  x402Version: number;
  accepts: AcceptItem[];
  [k: string]: unknown;
}

export class EnvelopeError extends Error {
  constructor(public readonly reason: 'malformed' | 'no-accepts' | 'fee-too-high') {
    super(`envelope.${reason}`);
    this.name = 'EnvelopeError';
  }
}

const MAX_FEE_BPS = 100; // matches X402FeeSplitFacilitator.MAX_FEE_BPS

export function rewriteEnvelope(input: unknown, ctx: RewriteContext): Envelope {
  if (!isObject(input) || typeof input.x402Version !== 'number' || !Array.isArray(input.accepts)) {
    throw new EnvelopeError('malformed');
  }
  if (input.accepts.length === 0) throw new EnvelopeError('no-accepts');
  if (ctx.gatewayFeeBps < 0 || ctx.gatewayFeeBps > MAX_FEE_BPS) throw new EnvelopeError('fee-too-high');

  const accepts: AcceptItem[] = input.accepts.map((a) => {
    if (!isObject(a)) throw new EnvelopeError('malformed');
    return {
      ...a,
      payTo: ctx.feeSplitAddress,
      extra: {
        ...((isObject(a.extra) ? a.extra : {}) as Record<string, unknown>),
        publisherPayTo: ctx.publisherPayTo,
        gatewayFeeBps: ctx.gatewayFeeBps,
        gatewayFeeReceiver: ctx.gatewayFeeReceiver,
        paymentId: ctx.paymentId,
      },
    };
  });

  return { ...input, accepts } as Envelope;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
