/**
 * POST /api/auth/siwe
 *
 * Body: { message: string, signature: 0x..., handle?: string }
 *
 * Flow:
 *   1. verify SIWE message (lib/siwe.ts) → wallet address
 *   2. upsert publishers row (server-role)
 *   3. mint Supabase JWT (HS256) carrying { sub, wallet_address }
 *   4. set httpOnly+secure+sameSite=lax cookie 'np_session'
 *
 * SOLID: this route owns ONLY the orchestration. Verification → siwe.ts.
 *        DB → supabase.ts. JWT → jose. Each step has one place to change.
 */
import { NextRequest, NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import { verifySiwe, SiweError } from '@/lib/siwe';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h
const COOKIE_NAME = 'np_session';

interface Body {
  message?: string;
  signature?: string;
  handle?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  if (!body.message || !body.signature?.startsWith('0x')) {
    return NextResponse.json({ error: 'missing-params' }, { status: 400 });
  }

  // Allowed domains for the SIWE message:
  //   - the actual request host (dev / no-proxy prod)
  //   - NEXT_PUBLIC_APP_DOMAIN if set (prod behind a proxy where req.url ≠ user-facing host)
  const allowedDomains = [
    new URL(req.url).host,
    process.env.NEXT_PUBLIC_APP_DOMAIN,
  ].filter((d): d is string => typeof d === 'string' && d.length > 0);

  let verified;
  try {
    verified = await verifySiwe(body.message, body.signature as `0x${string}`, allowedDomains);
  } catch (err) {
    const reason = err instanceof SiweError ? err.reason : 'parse';
    return NextResponse.json({ error: `siwe.${reason}` }, { status: 401 });
  }

  // Upsert publisher (handle defaults to short address until user picks one).
  // Schema regex (publishers_handle_check) allows [a-z0-9-] only — no underscore.
  const handle = (body.handle ?? `np-${verified.address.slice(2, 10)}`).toLowerCase();
  const sql = db();
  let row: { id: string; handle: string };
  try {
    const rows = await sql<{ id: string; handle: string }[]>`
      insert into publishers (wallet_address, handle)
      values (${verified.address}, ${handle})
      on conflict (wallet_address) do update set handle = excluded.handle
      returning id, handle
    `;
    if (!rows[0]) throw new Error('no-row');
    row = rows[0];
  } catch (err) {
    return NextResponse.json({ error: 'db', message: (err as Error).message }, { status: 500 });
  }

  const secret = process.env.SESSION_SECRET ?? process.env.SUPABASE_JWT_SECRET;
  if (!secret) return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  const jwt = await new SignJWT({
    role: 'authenticated',
    publisher_id: row.id,
    wallet_address: verified.address,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(row.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret));

  const res = NextResponse.json({ ok: true, publisherId: row.id, handle: row.handle });
  res.cookies.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  });
  return res;
}
