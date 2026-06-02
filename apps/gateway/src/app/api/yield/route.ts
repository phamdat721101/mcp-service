/**
 * GET /api/yield
 *
 * Returns: { revenue: { settled, fee, calls }, yield: { supplied, accrued, apyBps } }
 *
 * Authed via np_session cookie. v0.2 reports the Base Sepolia position only;
 * future versions will accept ?chain=...
 */
import { NextRequest, NextResponse } from 'next/server';
import { readSession } from '@/lib/auth';
import { readPosition, readRevenue } from '@/lib/yield';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await readSession(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const [revenue, position] = await Promise.all([
    readRevenue(session.publisherId),
    readPosition(session.publisherId, 'base-sepolia'),
  ]);

  return NextResponse.json({
    revenue: {
      settled: revenue.settled.toString(),
      fee: revenue.fee.toString(),
      calls: revenue.calls,
    },
    yield: {
      chain: position.chain,
      supplied: position.supplied.toString(),
      accrued: position.accrued.toString(),
      apyBps: position.apyBps,
      lastSyncedAt: position.lastSyncedAt,
    },
  });
}
