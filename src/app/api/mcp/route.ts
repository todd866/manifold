import { NextRequest, NextResponse } from 'next/server';
import { handleMcpRequest, MANIFOLD_MCP_TOOLS, type JsonRpcRequest } from '@/lib/mcp';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, mcp-session-id',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET() {
  return NextResponse.json(
    {
      name: 'manifold',
      version: '0.1.0',
      protocol: 'Model Context Protocol (Streamable HTTP JSON-RPC 2.0)',
      endpoint: '/api/mcp',
      tools: MANIFOLD_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
    },
    { headers: CORS },
  );
}

export async function POST(req: NextRequest) {
  const payload = (await req.json().catch(() => null)) as JsonRpcRequest | JsonRpcRequest[] | null;
  if (!payload) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400, headers: CORS },
    );
  }

  if (Array.isArray(payload)) {
    const responses = payload
      .map((item) => handleMcpRequest(item))
      .filter((r) => r !== null);
    return NextResponse.json(responses, { headers: CORS });
  }

  const single = handleMcpRequest(payload);
  if (!single) {
    return new NextResponse(null, { status: 204, headers: CORS });
  }
  return NextResponse.json(single, { headers: CORS });
}
