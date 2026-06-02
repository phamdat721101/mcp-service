import { describe, expect, it } from 'vitest';
import {
  AmountExceedsCapError,
  asGatewayError,
  CHAINS,
  computeFeeSplit,
  ERROR_REGISTRY,
  GatewayError,
  isGatewayError,
  PaymentDeclinedError,
  redact,
  TIER_FEE_BPS,
} from './index.js';

describe('errors', () => {
  it('every code in ERROR_REGISTRY has an http + json-rpc mapping', () => {
    for (const meta of Object.values(ERROR_REGISTRY)) {
      expect(meta.httpStatus).toBeGreaterThanOrEqual(400);
      expect(meta.jsonRpcCode).toBeLessThanOrEqual(0);
      expect(meta.defaultMessage.length).toBeGreaterThan(0);
    }
  });

  it('PaymentDeclinedError carries the correct code + status', () => {
    const e = new PaymentDeclinedError({ details: { reason: 'auth-expired' } });
    expect(e.code).toBe('payment.declined');
    expect(e.httpStatus).toBe(402);
    expect(e.jsonRpcCode).toBe(-32402);
    expect(e.toJSON()).toMatchObject({ code: 'payment.declined', details: { reason: 'auth-expired' } });
  });

  it('AmountExceedsCapError serializes to JSON-RPC error.data', () => {
    const e = new AmountExceedsCapError({ details: { cap: '100' } });
    expect(e.toJsonRpcError()).toMatchObject({
      code: -32402,
      data: { code: 'payment.amount.exceeds-cap', cap: '100' },
    });
  });

  it('isGatewayError detects both classes and shape-compatible objects', () => {
    expect(isGatewayError(new PaymentDeclinedError())).toBe(true);
    expect(isGatewayError(new Error('x'))).toBe(false);
    expect(isGatewayError({ code: 'payment.declined', httpStatus: 402, jsonRpcCode: -32402 })).toBe(true);
  });

  it('asGatewayError wraps unknown values without losing context', () => {
    expect(asGatewayError(new Error('boom')).code).toBe('internal.error');
    const ge = new PaymentDeclinedError();
    expect(asGatewayError(ge)).toBe(ge);
    expect(asGatewayError('plain string').message).toBe('plain string');
  });

  it('GatewayError preserves the original cause for debugging', () => {
    const cause = new Error('underlying');
    const e = new GatewayError('internal.error', { cause });
    expect(e.cause).toBe(cause);
  });
});

describe('chains', () => {
  it('every ChainKey has a config', () => {
    for (const key of [
      'base-mainnet',
      'base-sepolia',
      'morph-hoodi-testnet',
      'flare-coston2-testnet',
      'goat-testnet3',
      'goat-mainnet',
    ] as const) {
      expect(CHAINS[key].chainId).toBeGreaterThan(0);
    }
  });

  it('Morph Hoodi USDC domain uses "USDC" not "USD Coin"', () => {
    expect(CHAINS['morph-hoodi-testnet'].usdcDomain.name).toBe('USDC');
  });

  it('Flare Coston2 uses the forwarder variant', () => {
    expect(CHAINS['flare-coston2-testnet'].contractVariant).toBe('fee-split-forwarder');
  });

  it('GOAT Testnet3 chainId = 48816 with BTC-secured RPC', () => {
    expect(CHAINS['goat-testnet3'].chainId).toBe(48816);
    expect(CHAINS['goat-testnet3'].rpcUrl).toContain('testnet3.goat.network');
  });
});

describe('computeFeeSplit', () => {
  it('splits 1_000_000 @ 50 bps = 5000 fee + 995_000 publisher', () => {
    expect(computeFeeSplit(1_000_000n, 50)).toEqual({ fee: 5000n, publisherAmount: 995_000n });
  });

  it('rounds toward zero on odd amounts', () => {
    expect(computeFeeSplit(1n, 50)).toEqual({ fee: 0n, publisherAmount: 1n });
  });

  it('rejects feeBps > 100', () => {
    expect(() => computeFeeSplit(1n, 101)).toThrow(RangeError);
  });

  it('rejects negative feeBps', () => {
    expect(() => computeFeeSplit(1n, -1)).toThrow(RangeError);
  });

  it('zero fee leaves publisher whole', () => {
    expect(computeFeeSplit(123n, 0)).toEqual({ fee: 0n, publisherAmount: 123n });
  });

  it('TIER_FEE_BPS — Pro/Team are 50 bps; Free is 100 bps; Enterprise 0', () => {
    expect(TIER_FEE_BPS).toMatchObject({ free: 100, pro: 50, team: 50, enterprise: 0 });
  });
});

describe('redact', () => {
  it('redacts top-level secret-shaped fields', () => {
    const out = redact({ wallet: '0xabc', privateKey: 'x', signature: 's', api_token: 't' });
    expect(out).toMatchObject({ wallet: '0xabc', privateKey: '[redacted]', signature: '[redacted]', api_token: '[redacted]' });
  });

  it('redacts nested secret fields', () => {
    const out = redact({ payment: { amount: 1n, authorization: { v: 27, r: 'xx', s: 'yy' } } });
    expect((out as any).payment.authorization).toBe('[redacted]');
  });

  it('handles arrays', () => {
    const out = redact([{ secret: 'a' }, { ok: 'b' }]);
    expect(out).toEqual([{ secret: '[redacted]' }, { ok: 'b' }]);
  });

  it('does not mutate the input', () => {
    const input = { secret: 'before' };
    redact(input);
    expect(input.secret).toBe('before');
  });
});
