import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';
import { SiweError, verifySiwe } from './siwe';

const PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

async function fixture(overrides: Partial<{ domain: string; expiresIn: number; nonce: string }> = {}) {
  const account = privateKeyToAccount(PK);
  const msg = new SiweMessage({
    domain: overrides.domain ?? 'localhost:3000',
    address: account.address,
    statement: 'Sign in to n-payment Portal',
    uri: `http://${overrides.domain ?? 'localhost:3000'}`,
    version: '1',
    chainId: 84532,
    nonce: overrides.nonce ?? 'abc123def456',
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + (overrides.expiresIn ?? 60_000)).toISOString(),
  });
  const raw = msg.prepareMessage();
  const signature = await account.signMessage({ message: raw });
  return { raw, signature, address: account.address.toLowerCase() };
}

describe('verifySiwe', () => {
  it('returns the lowercased address on a valid signature', async () => {
    const { raw, signature, address } = await fixture();
    const out = await verifySiwe(raw, signature, 'localhost:3000');
    expect(out.address).toBe(address);
    expect(out.chainId).toBe(84532);
  });

  it('rejects a wrong-domain message', async () => {
    const { raw, signature } = await fixture({ domain: 'evil.example' });
    await expect(verifySiwe(raw, signature, 'localhost:3000')).rejects.toBeInstanceOf(SiweError);
  });

  it('rejects an expired message', async () => {
    const { raw, signature } = await fixture({ expiresIn: -1000 });
    await expect(verifySiwe(raw, signature, 'localhost:3000')).rejects.toMatchObject({ reason: 'expired' });
  });

  it('rejects a tampered signature', async () => {
    const { raw } = await fixture();
    await expect(
      verifySiwe(
        raw,
        ('0x' + 'ff'.repeat(65)) as `0x${string}`,
        'localhost:3000',
      ),
    ).rejects.toMatchObject({ reason: 'signature' });
  });

  it('rejects a lowercase (non-EIP-55) address — locks the buildSiweMessage contract', async () => {
    const { raw, signature } = await fixture();
    const lowered = raw.replace(/0x[0-9a-fA-F]{40}/, (m) => m.toLowerCase());
    await expect(verifySiwe(lowered, signature, 'localhost:3000')).rejects.toMatchObject({ reason: 'parse' });
  });

  it('accepts the message when its domain is in the allowed list (multi-domain support)', async () => {
    const { raw, signature, address } = await fixture();
    const out = await verifySiwe(raw, signature, ['mcp.n-payment.dev', 'localhost:3000']);
    expect(out.address).toBe(address);
  });

  it('rejects when the message domain is not in the allowed list', async () => {
    const { raw, signature } = await fixture({ domain: 'attacker.example' });
    await expect(verifySiwe(raw, signature, ['localhost:3000', 'mcp.n-payment.dev'])).rejects.toMatchObject({
      reason: 'wrong-domain',
    });
  });
});
