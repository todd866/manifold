import { NextRequest, NextResponse } from 'next/server';
import { getManifoldHub, type SignedContributionEnvelope } from '@/lib/engine';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SignedContributionEnvelope | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400, headers: CORS });
  }
  const hub = getManifoldHub();
  const res = hub.submitContribution(body);
  return NextResponse.json(res, { status: res.ok ? 200 : 422, headers: CORS });
}
