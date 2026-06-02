/**
 * yield.ts — auto-yield wrapper.
 *
 * Two side-effect functions + one read aggregator:
 *   - readPosition(publisherId, chain) — read accumulated yield position.
 *   - sweepIdleBalance(publisherId, chain) — accrue + persist supplied += idle.
 *   - readRevenue(publisherId)         — sum settled audit_entries.
 *
 * Postgres-only. For testnets the position is a Postgres-side simulated
 * accumulator with a fixed APY; on Base mainnet (later) the same surface
 * dispatches to Aave V3 Pool. Adding a mainnet chain = wire a Pool address.
 *
 * SOLID:
 *   - SRP per function. Read vs write are separate.
 */
import type { ChainKey } from '@n-payment/shared';
import { CHAINS } from '@n-payment/shared';
import { db } from '@/lib/db';

const SIMULATED_APY_BPS: Record<ChainKey, number> = {
  'base-mainnet': 421,
  'base-sepolia': 421,
  'morph-hoodi-testnet': 350,
  'flare-coston2-testnet': 380,
  'goat-testnet3': 510,
  'goat-mainnet': 510,
};

const SECONDS_PER_YEAR = 31_536_000n;

export interface YieldPosition {
  chain: ChainKey;
  supplied: bigint;
  accrued: bigint;
  apyBps: number;
  lastSyncedAt: string;
}

export async function readPosition(publisherId: string, chain: ChainKey): Promise<YieldPosition> {
  const sql = db();
  const rows = await sql<
    Array<{ supplied_usdc: string; accrued_usdc: string; apy_bps: number; last_synced_at: string }>
  >`
    select supplied_usdc::text, accrued_usdc::text, apy_bps, last_synced_at
    from yield_positions
    where publisher_id = ${publisherId} and chain = ${chain}::chain_t
    limit 1
  `;
  const row = rows[0];
  return {
    chain,
    supplied: BigInt(row?.supplied_usdc ?? '0'),
    accrued: BigInt(row?.accrued_usdc ?? '0'),
    apyBps: row?.apy_bps ?? SIMULATED_APY_BPS[chain],
    lastSyncedAt: row?.last_synced_at ?? new Date().toISOString(),
  };
}

export interface SweepResult {
  publisherId: string;
  chain: ChainKey;
  swept: bigint;
  newSupplied: bigint;
  accruedSinceLast: bigint;
}

/**
 * Sweep idle balance into the yield position. v0.2 simulates idle as
 * (totalSettled - currentSupplied) for the same publisher/chain. Mainnet
 * Base would also call Aave V3 Pool.supply() here.
 */
export async function sweepIdleBalance(publisherId: string, chain: ChainKey): Promise<SweepResult> {
  if (!CHAINS[chain]) throw new Error(`yield.unknown-chain:${chain}`);
  const sql = db();

  const settledRows = await sql<Array<{ total: string }>>`
    select coalesce(sum(a.publisher_amount)::text, '0') as total
    from audit_entries a
    join mcp_servers s on s.id = a.mcp_server_id
    where s.publisher_id = ${publisherId}
      and a.chain = ${chain}::chain_t
      and a.status = 'settled'
  `;
  const totalSettled = BigInt(settledRows[0]?.total ?? '0');

  const current = await readPosition(publisherId, chain);
  const idle = totalSettled > current.supplied ? totalSettled - current.supplied : 0n;

  const now = new Date();
  const lastTs = new Date(current.lastSyncedAt).getTime();
  const elapsedSeconds = BigInt(Math.max(0, Math.floor((now.getTime() - lastTs) / 1000)));
  const accrual = (current.supplied * BigInt(current.apyBps) * elapsedSeconds) / (10_000n * SECONDS_PER_YEAR);
  const newSupplied = current.supplied + idle;
  const newAccrued = current.accrued + accrual;

  await sql`
    insert into yield_positions (publisher_id, chain, supplied_usdc, accrued_usdc, apy_bps, last_swept_at)
    values (${publisherId}, ${chain}::chain_t,
            ${newSupplied.toString()}::bigint, ${newAccrued.toString()}::bigint,
            ${current.apyBps}, ${now.toISOString()}::timestamptz)
    on conflict (publisher_id, chain) do update
      set supplied_usdc = excluded.supplied_usdc,
          accrued_usdc  = excluded.accrued_usdc,
          apy_bps       = excluded.apy_bps,
          last_swept_at = excluded.last_swept_at
  `;

  return { publisherId, chain, swept: idle, newSupplied, accruedSinceLast: accrual };
}

export async function readRevenue(
  publisherId: string,
): Promise<{ settled: bigint; fee: bigint; calls: number }> {
  const sql = db();
  const rows = await sql<Array<{ settled: string; fee: string; calls: string }>>`
    select coalesce(sum(a.amount)::text, '0') as settled,
           coalesce(sum(a.fee)::text, '0')    as fee,
           count(*)::text                     as calls
    from audit_entries a
    join mcp_servers s on s.id = a.mcp_server_id
    where s.publisher_id = ${publisherId}
      and a.status = 'settled'
  `;
  const r = rows[0];
  return {
    settled: BigInt(r?.settled ?? '0'),
    fee: BigInt(r?.fee ?? '0'),
    calls: Number(r?.calls ?? 0),
  };
}
