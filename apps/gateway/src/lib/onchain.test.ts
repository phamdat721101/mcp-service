import { describe, expect, it } from 'vitest';
import { buildSettleArgs, SettleArgsError } from './onchain';

const ENVELOPE = {
  x402Version: 2,
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      payTo: '0x02f497ea02b2C1B525F107EbA3099728D235A544',
      maxAmountRequired: '10000',
      extra: {
        publisherPayTo: '0x100690a32B562fd45e685BC2E63bbfF566d452db',
        gatewayFeeBps: 50,
        gatewayFeeReceiver: '0x100690a32B562fd45e685BC2E63bbfF566d452db',
        paymentId: '0x' + 'a'.repeat(64),
      },
    },
  ],
};

const PAYLOAD = {
  authorization: {
    from: '0xBuyer000000000000000000000000000000000001',
    to: '0x02f497ea02b2C1B525F107EbA3099728D235A544',
    value: '10000',
    validAfter: '0',
    validBefore: '9999999999',
    nonce: '0x' + 'b'.repeat(64),
    v: 27,
    r: '0x' + 'c'.repeat(64),
    s: '0x' + 'd'.repeat(64),
  },
};

describe('buildSettleArgs', () => {
  it('builds typed args from a rewritten envelope + EIP-3009 payload', () => {
    const out = buildSettleArgs(ENVELOPE, PAYLOAD);
    expect(out.chain).toBe('base-sepolia');
    expect(out.amount).toBe(10000n);
    expect(out.feeBps).toBe(50);
    expect(out.paymentId).toBe('0x' + 'a'.repeat(64));
    expect(out.publisherPayTo).toBe('0x100690a32b562fd45e685bc2e63bbff566d452db');
  });

  it('rejects an envelope with mismatched value vs maxAmountRequired', () => {
    const bad = { ...PAYLOAD, authorization: { ...PAYLOAD.authorization, value: '20000' } };
    expect(() => buildSettleArgs(ENVELOPE, bad)).toThrow(SettleArgsError);
  });

  it('rejects unknown CAIP-2 network', () => {
    const env2 = { ...ENVELOPE, accepts: [{ ...ENVELOPE.accepts[0]!, network: 'eip155:9999' }] };
    expect(() => buildSettleArgs(env2, PAYLOAD)).toThrow(/unsupported-chain/);
  });

  it('rejects an envelope without accepts', () => {
    expect(() => buildSettleArgs({ x402Version: 2 }, PAYLOAD)).toThrow(/envelope/);
  });

  it('rejects a payload missing signature components', () => {
    const bad = { authorization: { ...PAYLOAD.authorization, v: undefined as unknown as number } };
    expect(() => buildSettleArgs(ENVELOPE, bad)).toThrow(/payload/);
  });
});
