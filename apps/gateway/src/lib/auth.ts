/**
 * Session cookie verification.
 *
 * One function: read the np_session cookie, verify the HS256 JWT, return a
 * publisher context. Any route that needs "who is this?" calls this.
 *
 * SOLID: Single Responsibility. Cookie name + JWT secret live here so future
 * rotation (or a swap to JWKS) edits one file.
 */
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';

export const SESSION_COOKIE = 'np_session';

export interface Session {
  publisherId: string;
  address: `0x${string}`;
}

export async function readSession(req: NextRequest): Promise<Session | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const secret = process.env.SESSION_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const publisherId = payload['publisher_id'];
    const address = payload['wallet_address'];
    if (typeof publisherId !== 'string' || typeof address !== 'string') return null;
    return { publisherId, address: address as `0x${string}` };
  } catch {
    return null;
  }
}
