import { NextResponse } from 'next/server';
import { getManifoldHub } from '@/lib/engine';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  const hub = getManifoldHub();
  return NextResponse.json(hub.getStatus(), { headers: CORS });
}
