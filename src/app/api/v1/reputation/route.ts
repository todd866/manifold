import { NextRequest, NextResponse } from 'next/server';
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
  const issuer = url.searchParams.get('issuer');
  const hub = getManifoldHub();
  if (issuer) {
    const actor = hub.getContributor(issuer);
    if (!actor) {
      return NextResponse.json({ error: 'contributor_not_found', issuer }, { status: 404, headers: CORS });
    }
    return NextResponse.json(actor, { headers: CORS });
  }
  const contributors = hub.listContributors();
  return NextResponse.json({ count: contributors.length, contributors }, { headers: CORS });
}
