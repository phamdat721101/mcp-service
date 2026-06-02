/**
 * POST /api/mcp/[handle]/[server]   — buyer-facing MCP JSON-RPC proxy.
 *
 * Buyer agents (Claude Desktop / Cursor) call this URL with an MCP request.
 * We forward to the publisher origin. If the origin returns a -32402
 * paymentRequired error, we decode the envelope, rewrite payTo →
 * X402FeeSplitFacilitator, inject extra metadata, re-encode, and return.
 *
 * SOLID:
 *   - this file does I/O + framing only; the rewrite is in lib/proxy.ts.
 *   - chain selection comes from the first paid_tool of the server (v0.2
 *     simplification — extend to per-tool routing in v0.3 by passing the
 *     tool name into resolveChain()).
 *
 * NOTE: this is a BUYER-facing path (anonymous), so we use the service-role
 * client to bypass RLS for read. This is the only buyer-facing place where
 * service-role is allowed; document at the call site.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { CHAINS, CONTRACTS, TIER_FEE_BPS, type ChainKey } from '@n-payment/shared';
import { rewriteEnvelope, EnvelopeError, type Envelope } from '@/lib/proxy';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface RouteCtx {
  params: { handle: string; server: string };
}

export async function POST(req: NextRequest, { params }: RouteCtx): Promise<NextResponse> {
  const target = await resolveServer(params.handle, params.server);
  if (!target) return NextResponse.json(jsonRpc(null, -32601, 'mcp-server-not-found'), { status: 404 });

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json(jsonRpc(null, -32700, 'parse'), { status: 400 });
  }

  // Forward to publisher origin.
  let originRes: Response;
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 10_000);
    originRes = await fetch(target.originUrl, {
      method: 'POST',
      headers: passthroughHeaders(req.headers),
      body: bodyText,
      signal: ac.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    return NextResponse.json(
      jsonRpc(null, -32603, 'origin-unreachable', { reason: (err as Error).message }),
      { status: 502 },
    );
  }

  const originBody = await originRes.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(originBody);
  } catch {
    // Stream non-JSON (e.g. SSE, long polling) untouched.
    return new NextResponse(originBody, {
      status: originRes.status,
      headers: { 'content-type': originRes.headers.get('content-type') ?? 'application/json' },
    });
  }

  if (isPaymentRequired(parsed)) {
    try {
      const rewritten = rewritePaymentRequired(parsed, target);
      return NextResponse.json(rewritten, { status: 200 });
    } catch (err) {
      const reason = err instanceof EnvelopeError ? err.reason : 'rewrite-failed';
      return NextResponse.json(jsonRpc(null, -32603, reason), { status: 502 });
    }
  }

  return NextResponse.json(parsed, { status: originRes.status });
}

// ─── helpers ───────────────────────────────────────────────────────────────

interface ResolvedServer {
  id: string;
  slug: string;
  originUrl: string;
  publisherPayTo: `0x${string}`;
  chain: ChainKey;
  feeBps: number;
}

async function resolveServer(handle: string, slug: string): Promise<ResolvedServer | null> {
  const sql = db(); // buyer-facing read; documented exception (still service-role on the wire)
  // handle is the publisher address (lowercased) for v0.2; later: reverse-lookup the human handle.
  const rows = await sql<
    Array<{ id: string; slug: string; origin_url: string; chain: ChainKey | null; tier: string | null }>
  >`
    select s.id, s.slug, s.origin_url,
           t.chain as chain,
           b.tier as tier
    from mcp_servers s
    join publishers p on p.id = s.publisher_id
    left join paid_tools t on t.mcp_server_id = s.id
    left join billing_accounts b on b.publisher_id = p.id
    where s.slug = ${slug}
      and s.status = 'active'
      and lower(p.wallet_address) = ${handle.toLowerCase()}
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const chain: ChainKey = row.chain ?? 'base-sepolia';
  const tier = (row.tier as keyof typeof TIER_FEE_BPS) ?? 'free';
  return {
    id: row.id,
    slug: row.slug,
    originUrl: row.origin_url,
    publisherPayTo: handle.toLowerCase() as `0x${string}`,
    chain,
    feeBps: TIER_FEE_BPS[tier] ?? 100,
  };
}

function passthroughHeaders(h: Headers): Headers {
  const out = new Headers();
  out.set('content-type', h.get('content-type') ?? 'application/json');
  const xPayment = h.get('x-payment');
  if (xPayment) out.set('x-payment', xPayment);
  return out;
}

function isPaymentRequired(v: unknown): v is JsonRpcError {
  return (
    typeof v === 'object' &&
    v !== null &&
    'error' in v &&
    typeof (v as { error?: { code?: number } }).error?.code === 'number' &&
    (v as { error: { code: number } }).error.code === -32402
  );
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message?: string; data?: { paymentRequired?: string } & Record<string, unknown> };
}

function rewritePaymentRequired(rpc: JsonRpcError, target: ResolvedServer): JsonRpcError {
  const paymentRequired = rpc.error.data?.paymentRequired;
  if (typeof paymentRequired !== 'string') throw new EnvelopeError('malformed');

  const decoded = Buffer.from(paymentRequired, 'base64').toString('utf8');
  const envelopeIn = JSON.parse(decoded);

  const ctx = {
    feeSplitAddress: CONTRACTS[target.chain].feeSplit as `0x${string}`,
    publisherPayTo: target.publisherPayTo,
    gatewayFeeBps: target.feeBps,
    gatewayFeeReceiver: (CONTRACTS[target.chain].feeReceiver ||
      target.publisherPayTo) as `0x${string}`,
    paymentId: ('0x' + randomBytes(32).toString('hex')) as `0x${string}`,
  };

  const rewritten: Envelope = rewriteEnvelope(envelopeIn, ctx);
  const reEncoded = Buffer.from(JSON.stringify(rewritten)).toString('base64');
  return {
    ...rpc,
    error: { ...rpc.error, data: { ...rpc.error.data, paymentRequired: reEncoded } },
  };
}

function jsonRpc(id: unknown, code: number, message: string, data?: Record<string, unknown>): JsonRpcError {
  const error: JsonRpcError['error'] = { code, message };
  if (data) error.data = data;
  return { jsonrpc: '2.0', id: id as number | string | null, error };
}
