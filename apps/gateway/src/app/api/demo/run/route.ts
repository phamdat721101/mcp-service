/**
 * POST /api/demo/run
 *
 * Body: { serverId: string, chain: ChainKey }
 *
 * Drives the end-to-end demo flow used by the UI's "Run paid call" button.
 * Returns a timeline of TimelineEvents the UI renders.
 *
 *   1. Build a synthetic publisher -32402 envelope (we fake the publisher
 *      origin response — the rewrite logic is identical).
 *   2. Apply lib/proxy.rewriteEnvelope (the wedge).
 *   3. Sign EIP-3009 with DEMO_BUYER_PK.
 *   4. Submit settleOnChain — for chains where FeeSplit is deployed.
 *   5. Write audit_entries.
 *
 * SOLID: orchestration only — no rewrite, no signing, no on-chain logic
 *        defined here. Each pipeline step delegates to lib/{proxy,onchain}.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { hashTypedData, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAINS, CONTRACTS, TIER_FEE_BPS, type ChainKey } from '@n-payment/shared';
import { readSession } from '@/lib/auth';
import { rewriteEnvelope } from '@/lib/proxy';
import { buildSettleArgs, settleOnChain, sponsorKeyFor, SettleArgsError } from '@/lib/onchain';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Body {
  serverId?: string;
  chain?: ChainKey;
}
interface TimelineEvent {
  label: string;
  detail?: string;
  link?: { href: string; text: string };
  ok?: boolean;
}

const DEMO_AMOUNT = 10_000n; // $0.01 USDC

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await readSession(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.serverId || !body.chain || !(body.chain in CHAINS)) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 });
  }

  const chain = body.chain;
  const chainCfg = CHAINS[chain];
  const feeSplit = CONTRACTS[chain].feeSplit;
  const steps: TimelineEvent[] = [];

  steps.push({ label: 'tools/call forecast { city: "Tokyo" }', detail: 'agent → gateway' });
  steps.push({
    label: '-32402 paymentRequired',
    detail: `publisher origin (${chainCfg.name})`,
  });

  // Synthesize the publisher envelope (would normally come from origin).
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const envelopeIn = {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: chainCfg.caip2,
        asset: chainCfg.usdc,
        payTo: session.address,
        maxAmountRequired: DEMO_AMOUNT.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
      },
    ],
  };

  // ── REWRITE (the wedge) ───────────────────────────────────────────────────
  const paymentId = ('0x' + randomBytes(32).toString('hex')) as `0x${string}`;
  const feeBps = TIER_FEE_BPS.free;
  let rewritten;
  try {
    rewritten = rewriteEnvelope(envelopeIn, {
      feeSplitAddress: feeSplit,
      publisherPayTo: session.address,
      gatewayFeeBps: feeBps,
      gatewayFeeReceiver: (CONTRACTS[chain].feeReceiver !==
      '0x0000000000000000000000000000000000000000'
        ? CONTRACTS[chain].feeReceiver
        : session.address) as `0x${string}`,
      paymentId,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  steps.push({
    label: 'envelope rewritten',
    detail: `payTo = ${shorten(feeSplit)} · feeBps ${feeBps}`,
    ok: true,
  });

  // ── DEMO BUYER SIGNS EIP-3009 ─────────────────────────────────────────────
  if (feeSplit === '0x0000000000000000000000000000000000000000') {
    steps.push({
      label: `${chainCfg.name} contract not deployed`,
      detail: 'deploy X402FeeSplitFacilitator and set address in shared/contracts.ts',
      ok: false,
    });
    return NextResponse.json({ ok: false, steps, pendingDeploy: true });
  }

  const buyerPk = process.env.DEMO_BUYER_PK as `0x${string}` | undefined;
  if (!buyerPk) {
    steps.push({ label: 'DEMO_BUYER_PK not set', detail: 'cannot sign EIP-3009 in demo mode', ok: false });
    return NextResponse.json({ ok: false, steps });
  }
  const buyer = privateKeyToAccount(buyerPk);
  const nonce = ('0x' + randomBytes(32).toString('hex')) as `0x${string}`;

  const domain = {
    name: chainCfg.usdcDomain.name,
    version: chainCfg.usdcDomain.version,
    chainId: chainCfg.chainId,
    verifyingContract: chainCfg.usdc,
  } as const;
  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  } as const;
  const message = {
    from: buyer.address,
    to: feeSplit,
    value: DEMO_AMOUNT,
    validAfter,
    validBefore,
    nonce,
  };

  let signature: `0x${string}`;
  try {
    signature = await buyer.signTypedData({
      domain,
      types,
      primaryType: 'TransferWithAuthorization',
      message,
    });
  } catch (err) {
    steps.push({ label: 'signTypedData failed', detail: (err as Error).message, ok: false });
    return NextResponse.json({ ok: false, steps });
  }
  // unused but documented; viem produces 0x-65-byte sig (r || s || v)
  void hashTypedData;
  void keccak256;
  void toBytes;
  const v = Number('0x' + signature.slice(130, 132));
  const r = ('0x' + signature.slice(2, 66)) as `0x${string}`;
  const s = ('0x' + signature.slice(66, 130)) as `0x${string}`;

  steps.push({
    label: 'EIP-3009 signed',
    detail: `nonce ${shorten(nonce)} · buyer ${shorten(buyer.address)}`,
    ok: true,
  });

  // ── SETTLE ON-CHAIN ───────────────────────────────────────────────────────
  const payload = {
    authorization: {
      from: buyer.address,
      to: feeSplit,
      value: DEMO_AMOUNT.toString(),
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce,
      v,
      r,
      s,
    },
  };

  try {
    const args = buildSettleArgs(rewritten, payload);
    const sponsorPk = sponsorKeyFor(args.chain);
    const receipt = await settleOnChain(args, sponsorPk);
    const explorerLink = `${chainCfg.explorer}/tx/${receipt.txHash}`;
    steps.push({
      label: 'settle() submitted',
      detail: `block ${receipt.blockNumber}`,
      link: { href: explorerLink, text: 'view tx' },
      ok: true,
    });
    steps.push({
      label: `+$${formatUsdc(receipt.publisherAmount)} to publisher`,
      detail: `fee $${formatUsdc(receipt.fee)} (${feeBps} bps)`,
      ok: true,
    });

    // Audit row.
    const sql = db();
    await sql`
      insert into audit_entries (mcp_server_id, payment_id, buyer_address,
                                 publisher_address, chain, amount, fee, publisher_amount,
                                 tx_hash, status)
      values (${body.serverId ?? null}, ${receipt.paymentId},
              ${buyer.address.toLowerCase()}, ${session.address}, ${chain}::chain_t,
              ${receipt.amount.toString()}, ${receipt.fee.toString()},
              ${receipt.publisherAmount.toString()}, ${receipt.txHash}, 'settled')
    `;
    return NextResponse.json({ ok: true, steps, txHash: receipt.txHash });
  } catch (err) {
    const reason = err instanceof SettleArgsError ? err.reason : (err as Error).message;
    steps.push({ label: 'settle failed', detail: reason, ok: false });
    return NextResponse.json({ ok: false, steps });
  }
}

function shorten(s: string): string {
  return s.slice(0, 6) + '…' + s.slice(-4);
}
function formatUsdc(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, '0').slice(0, 4);
  return `${whole}.${frac}`;
}
