import { NextRequest, NextResponse } from 'next/server';
import type { ManifoldDomain } from '@/lib/boundary';
import { getManifoldHub } from '@/lib/engine';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const hub = getManifoldHub();
  const url = new URL(req.url);
  const workId = url.searchParams.get('workId');
  if (workId) {
    const k = Number(url.searchParams.get('k') || '10');
    const detail = hub.getNeighbours(workId, Math.min(24, Math.max(1, k)));
    if (!detail) {
      return NextResponse.json({ error: 'work_not_found', workId }, { status: 404, headers: CORS });
    }
    return NextResponse.json(detail, { headers: CORS });
  }

  const domainParam = url.searchParams.get('domain');
  const domain =
    domainParam === 'tv' || domainParam === 'radio' || domainParam === 'cohort'
      ? (domainParam as ManifoldDomain)
      : undefined;
  const query = url.searchParams.get('q') || undefined;
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || '100')));
  const works = hub.listWorks({ domain, query, limit });
  return NextResponse.json({ count: works.length, works }, { headers: CORS });
}

export async function POST(req: NextRequest) {
  const hub = getManifoldHub();
  const body = (await req.json().catch(() => ({}))) as {
    workIds?: string[];
    includeVectors?: boolean;
  };
  const ids = Array.isArray(body.workIds) ? body.workIds.slice(0, 500) : [];
  const matches = ids
    .map((id) => hub.getWork(String(id), Boolean(body.includeVectors)))
    .filter((x) => x !== null);
  return NextResponse.json({ requested: ids.length, matched: matches.length, works: matches }, { headers: CORS });
}
