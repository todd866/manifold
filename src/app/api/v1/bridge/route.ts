import { NextRequest, NextResponse } from 'next/server';
import type { ManifoldDomain } from '@/lib/boundary';
import { getManifoldHub } from '@/lib/engine';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const a = url.searchParams.get('a') || '';
  const b = url.searchParams.get('b') || '';
  if (!a || !b) {
    return NextResponse.json({ error: 'missing_endpoints', required: ['a', 'b'] }, { status: 400, headers: CORS });
  }
  const domainParam = url.searchParams.get('domain');
  const domain =
    domainParam === 'tv' || domainParam === 'radio' || domainParam === 'cohort'
      ? (domainParam as ManifoldDomain)
      : undefined;
  const limit = Math.min(24, Math.max(1, Number(url.searchParams.get('limit') || '8')));
  const hub = getManifoldHub();
  const bridges = hub.findBridge(a, b, { domain, limit });
  return NextResponse.json({ workIdA: a, workIdB: b, count: bridges.length, bridges }, { headers: CORS });
}
