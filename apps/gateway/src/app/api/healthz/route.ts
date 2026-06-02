import { NextResponse } from 'next/server';

export const runtime = 'edge';

export function GET(): NextResponse {
  return NextResponse.json({ ok: true, service: 'gateway', ts: Date.now() });
}
