/**
 * POST /api/publish
 *
 * Body: { slug: string, originUrl: string, displayName?: string,
 *         tool: { name: string, priceMicros: string, chain: ChainKey } }
 *
 * Auth: np_session cookie (publisher).
 *
 * Behaviour:
 *   1. Resolve session.
 *   2. Insert mcp_servers row (publisher_id, slug, origin_url, display_name).
 *   3. Insert one paid_tools row (chain default base-sepolia for v0.2 demo).
 *
 * SOLID: route owns orchestration only; DB shape is owned by Supabase types,
 *        validation lives inline (no separate validator file until a 2nd
 *        consumer needs it).
 */
import { NextRequest, NextResponse } from 'next/server';
import { CHAINS, type ChainKey } from '@n-payment/shared';
import { readSession } from '@/lib/auth';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

interface Body {
  slug?: string;
  originUrl?: string;
  displayName?: string;
  tool?: { name?: string; priceMicros?: string; chain?: ChainKey; description?: string };
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await readSession(req);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid-json' }, { status: 400 });
  }

  if (!body.slug || !SLUG.test(body.slug)) return bad('invalid-slug');
  if (!body.originUrl || !body.originUrl.startsWith('https://')) return bad('invalid-origin');
  if (!body.tool?.name || !TOOL_NAME.test(body.tool.name)) return bad('invalid-tool-name');
  if (!body.tool.priceMicros || !/^\d+$/.test(body.tool.priceMicros)) return bad('invalid-price');
  const chain: ChainKey = body.tool.chain ?? 'base-sepolia';
  if (!(chain in CHAINS)) return bad('invalid-chain');

  const sql = db();
  try {
    const rows = await sql<{ id: string; slug: string }[]>`
      with new_server as (
        insert into mcp_servers (publisher_id, slug, origin_url, display_name)
        values (${session.publisherId}, ${body.slug}, ${body.originUrl}, ${body.displayName ?? body.slug})
        returning id, slug
      ),
      new_tool as (
        insert into paid_tools (mcp_server_id, name, description, price_micros, chain)
        select id, ${body.tool.name}, ${body.tool.description ?? null},
               ${Number(body.tool.priceMicros)}, ${chain}::chain_t
        from new_server
        returning id
      )
      select id, slug from new_server
    `;
    if (!rows[0]) return NextResponse.json({ error: 'db' }, { status: 500 });
    return NextResponse.json({
      ok: true,
      serverId: rows[0].id,
      publicUrl: `/api/mcp/${session.address}/${rows[0].slug}`,
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') return NextResponse.json({ error: 'slug-taken' }, { status: 409 });
    return NextResponse.json({ error: 'db', message: e.message }, { status: 500 });
  }
}

function bad(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 400 });
}
