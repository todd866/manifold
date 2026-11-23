import { NextRequest, NextResponse } from 'next/server';
import type { ManifoldDomain } from '@/lib/boundary';
import { getManifoldHub, type ManifoldLens } from '@/lib/engine';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const hub = getManifoldHub();
  const lensId = url.searchParams.get('lensId');
  if (lensId) {
    const currentWorkId = url.searchParams.get('current') || undefined;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || '16')));
    const applied = hub.applyLens({ lensId, currentWorkId, limit });
    if (!applied) {
      return NextResponse.json({ error: 'lens_not_found', lensId }, { status: 404, headers: CORS });
    }
    return NextResponse.json(applied, { headers: CORS });
  }

  const domainParam = url.searchParams.get('domain');
  const domain =
    domainParam === 'tv' || domainParam === 'radio' || domainParam === 'cohort'
      ? (domainParam as ManifoldDomain)
      : undefined;
  const lenses = hub.listLenses(domain);
  return NextResponse.json({ count: lenses.length, lenses }, { headers: CORS });
}

export async function POST(req: NextRequest) {
  const hub = getManifoldHub();
  const body = (await req.json().catch(() => null)) as
    | ({ action?: 'apply'; lensId: string; candidateWorkIds?: string[]; currentWorkId?: string; limit?: number })
    | (ManifoldLens & { action?: 'publish' })
    | null;

  if (!body) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: CORS });
  }

  if ('action' in body && body.action === 'apply') {
    const applied = hub.applyLens({
      lensId: body.lensId,
      candidateWorkIds: body.candidateWorkIds,
      currentWorkId: body.currentWorkId,
      limit: body.limit,
    });
    if (!applied) {
      return NextResponse.json({ error: 'lens_not_found', lensId: body.lensId }, { status: 404, headers: CORS });
    }
    return NextResponse.json(applied, { headers: CORS });
  }

  const verdict = hub.publishLens(body as ManifoldLens);
  if (!verdict.ok) {
    return NextResponse.json({ error: 'lens_rejected', reason: verdict.reason }, { status: 400, headers: CORS });
  }
  return NextResponse.json({ ok: true, lens: verdict.lens }, { status: 201, headers: CORS });
}
