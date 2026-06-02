/**
 * GET /api/cron/sweep
 *
 * Vercel Cron hits this hourly. Iterates publishers with sponsor_wallets, runs
 * sweepIdleBalance per chain. Bearer-protected via CRON_BEARER env.
 *
 * SOLID: orchestration only — sweep semantics live in lib/yield.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { ChainKey } from '@n-payment/shared';
import { db } from '@/lib/db';
import { sweepIdleBalance } from '@/lib/yield';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_BEARER;
  if (expected) {
    const got = req.headers.get('authorization');
    if (got !== `Bearer ${expected}`) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sql = db();
  const rows = await sql<Array<{ publisher_id: string; chain: ChainKey }>>`
    select publisher_id, chain from sponsor_wallets where status = 'ready'
  `;

  const results: unknown[] = [];
  for (const row of rows) {
    try {
      const r = await sweepIdleBalance(row.publisher_id, row.chain);
      results.push({
        publisherId: r.publisherId,
        chain: r.chain,
        swept: r.swept.toString(),
        newSupplied: r.newSupplied.toString(),
        accruedSinceLast: r.accruedSinceLast.toString(),
      });
    } catch (err) {
      results.push({ publisherId: row.publisher_id, chain: row.chain, error: (err as Error).message });
    }
  }

  return NextResponse.json({ ok: true, count: results.length, results });
}
