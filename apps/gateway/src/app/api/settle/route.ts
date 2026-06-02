/**
 * POST /api/settle
 *
 * Body: { envelope: <rewritten envelope>, payload: <EIP-3009 auth + sig> }
 *
 * Idempotency: by `extra.paymentId`. Re-submission returns cached receipt.
 *
 * SOLID:
 *   - this route owns ONLY: idempotency check → call buildSettleArgs →
 *     call settleOnChain → write audit_entries → return.
 *   - shape validation in lib/onchain.ts; chain wiring in lib/onchain.ts;
 *     persistence in lib/supabase.ts; never inline.
 */
import { NextRequest, NextResponse } from 'next/server';
import { buildSettleArgs, SettleArgsError, settleOnChain, sponsorKeyFor } from '@/lib/onchain';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Body {
  envelope?: unknown;
  payload?: unknown;
  serverId?: string;
  toolId?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  let args;
  try {
    args = buildSettleArgs(body.envelope, body.payload);
  } catch (err) {
    const reason = err instanceof SettleArgsError ? err.reason : 'unknown';
    return NextResponse.json({ error: `settle.${reason}` }, { status: 400 });
  }

  const sql = db();

  // Idempotency: existing audit row for this paymentId.
  const existingRows = await sql<
    Array<{ payment_id: string; tx_hash: string | null; fee: string; publisher_amount: string; status: string }>
  >`
    select payment_id, tx_hash, fee, publisher_amount, status
    from audit_entries
    where payment_id = ${args.paymentId}
    limit 1
  `;
  const existing = existingRows[0];
  if (existing && existing.status === 'settled' && existing.tx_hash) {
    return NextResponse.json({
      ok: true,
      cached: true,
      txHash: existing.tx_hash,
      fee: existing.fee,
      publisherAmount: existing.publisher_amount,
    });
  }

  let receipt;
  try {
    receipt = await settleOnChain(args, sponsorKeyFor(args.chain));
  } catch (err) {
    await sql`
      insert into audit_entries (mcp_server_id, paid_tool_id, payment_id, buyer_address,
                                 publisher_address, chain, amount, fee, publisher_amount,
                                 status, error_code)
      values (${body.serverId ?? null}, ${body.toolId ?? null}, ${args.paymentId},
              ${args.from}, ${args.publisherPayTo}, ${args.chain}::chain_t,
              ${args.amount.toString()}, 0, 0, 'settle-failed', ${(err as Error).message})
    `.catch(() => undefined);
    return NextResponse.json({ error: 'settle-failed', reason: (err as Error).message }, { status: 502 });
  }

  await sql`
    insert into audit_entries (mcp_server_id, paid_tool_id, payment_id, buyer_address,
                               publisher_address, chain, amount, fee, publisher_amount,
                               tx_hash, status)
    values (${body.serverId ?? null}, ${body.toolId ?? null}, ${receipt.paymentId},
            ${args.from}, ${args.publisherPayTo}, ${args.chain}::chain_t,
            ${receipt.amount.toString()}, ${receipt.fee.toString()},
            ${receipt.publisherAmount.toString()}, ${receipt.txHash}, 'settled')
  `;

  return NextResponse.json({
    ok: true,
    txHash: receipt.txHash,
    blockNumber: receipt.blockNumber.toString(),
    fee: receipt.fee.toString(),
    publisherAmount: receipt.publisherAmount.toString(),
    amount: receipt.amount.toString(),
    paymentId: receipt.paymentId,
  });
}
