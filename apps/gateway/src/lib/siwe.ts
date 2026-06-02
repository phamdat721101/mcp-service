/**
 * SIWE (Sign-In With Ethereum) verification.
 *
 * Pure function — no I/O, no Supabase, no JWT minting. Easy to unit-test.
 * Returns the lowercased wallet address on success or throws a typed error.
 *
 * SOLID:
 *   - Single Responsibility: parses + cryptographically verifies a SIWE message.
 *     Nonce storage + JWT minting are caller responsibilities (route handler).
 */
import { SiweMessage } from 'siwe';
import { verifyMessage as viemVerify, type Address } from 'viem';

export interface SiweVerified {
  address: Address;
  chainId: number;
  domain: string;
  nonce: string;
  issuedAt: string;
}

export class SiweError extends Error {
  constructor(public readonly reason: 'parse' | 'signature' | 'expired' | 'wrong-domain', msg?: string) {
    super(msg ?? `siwe.${reason}`);
    this.name = 'SiweError';
  }
}

export async function verifySiwe(
  rawMessage: string,
  signature: `0x${string}`,
  expectedDomain: string | readonly string[],
): Promise<SiweVerified> {
  let parsed: SiweMessage;
  try {
    parsed = new SiweMessage(rawMessage);
  } catch (e) {
    throw new SiweError('parse', `siwe.parse: ${(e as Error).message ?? 'unknown'}`);
  }

  const allowed = Array.isArray(expectedDomain) ? expectedDomain : [expectedDomain as string];
  if (!allowed.includes(parsed.domain)) {
    throw new SiweError('wrong-domain', `expected one of [${allowed.join(', ')}], got ${parsed.domain}`);
  }

  const expirationTime = parsed.expirationTime ? Date.parse(parsed.expirationTime) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(expirationTime) && expirationTime < Date.now()) throw new SiweError('expired');

  let valid = false;
  try {
    valid = await viemVerify({
      address: parsed.address as Address,
      message: rawMessage,
      signature,
    });
  } catch {
    valid = false;
  }
  if (!valid) throw new SiweError('signature');

  return {
    address: parsed.address.toLowerCase() as Address,
    chainId: parsed.chainId,
    domain: parsed.domain,
    nonce: parsed.nonce,
    issuedAt: parsed.issuedAt ?? new Date().toISOString(),
  };
}
