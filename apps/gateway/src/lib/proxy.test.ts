import { describe, expect, it } from 'vitest';
import { EnvelopeError, rewriteEnvelope, type RewriteContext } from './proxy';

const CTX: RewriteContext = {
  feeSplitAddress: '0x02f497ea02b2C1B525F107EbA3099728D235A544',
  publisherPayTo: '0x100690a32B562fd45e685BC2E63bbfF566d452db',
  gatewayFeeBps: 50,
  gatewayFeeReceiver: '0x100690a32B562fd45e685BC2E63bbfF566d452db',
  paymentId: ('0x' + 'a'.repeat(64)) as `0x${string}`,
};

const BASE_ENV = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: '0xpublisheroriginal000000000000000000000000',
      maxAmountRequired: '10000',
    },
  ],
};

describe('rewriteEnvelope', () => {
  it('rewrites payTo to the FeeSplit contract', () => {
    const out = rewriteEnvelope(BASE_ENV, CTX);
    expect(out.accepts[0]!.payTo).toBe(CTX.feeSplitAddress);
  });

  it('injects publisherPayTo + gatewayFeeBps + receiver + paymentId into extra', () => {
    const out = rewriteEnvelope(BASE_ENV, CTX);
    expect(out.accepts[0]!.extra).toMatchObject({
      publisherPayTo: CTX.publisherPayTo,
      gatewayFeeBps: 50,
      gatewayFeeReceiver: CTX.gatewayFeeReceiver,
      paymentId: CTX.paymentId,
    });
  });

  it('preserves other accept fields (asset, amount, validity)', () => {
    const out = rewriteEnvelope(BASE_ENV, CTX);
    expect(out.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      maxAmountRequired: '10000',
    });
  });

  it('rejects malformed envelopes', () => {
    expect(() => rewriteEnvelope({}, CTX)).toThrow(EnvelopeError);
    expect(() => rewriteEnvelope({ x402Version: 2, accepts: [] }, CTX)).toThrow(/no-accepts/);
  });

  it('rejects fee bps above 100 (matches contract MAX_FEE_BPS)', () => {
    expect(() => rewriteEnvelope(BASE_ENV, { ...CTX, gatewayFeeBps: 101 })).toThrow(/fee-too-high/);
  });

  it('is idempotent — second pass with same ctx yields equal output', () => {
    const a = rewriteEnvelope(BASE_ENV, CTX);
    const b = rewriteEnvelope(a, CTX);
    expect(b).toEqual(a);
  });
});
