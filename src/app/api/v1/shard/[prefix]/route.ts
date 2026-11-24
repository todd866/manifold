import { NextRequest, NextResponse } from 'next/server';
import { parseManifoldDomain } from '@/lib/boundary';
import { getManifoldHub } from '@/lib/engine';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ prefix: string }> },
) {
  const { prefix } = await context.params;
  if (!/^[0-9a-f]{1,2}$/i.test(prefix)) {
    return NextResponse.json(
      { error: 'invalid_shard_prefix', expected: '1 or 2 hex chars (0..ff)' },
      { status: 400, headers: CORS },
    );
  }
  const url = new URL(req.url);
  const domain = parseManifoldDomain(url.searchParams.get('domain'));
  const hub = getManifoldHub();
  return NextResponse.json(hub.getShard(prefix, domain), { headers: CORS });
}
