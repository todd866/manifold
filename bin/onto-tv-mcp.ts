#!/usr/bin/env node
/**
 * Local MCP bridge for Onto the TV (`onto-tv-mcp`).
 * Connects a local Onto the TV server (`ONTO_TV_URL`, default http://127.0.0.1:8686)
 * with Manifold's signed TV Lenses and neighbour graph.
 */
import * as readline from 'node:readline';
import { getManifoldHub } from '../src/lib/engine.ts';

const TV_SERVER = (process.env.ONTO_TV_URL || 'http://127.0.0.1:8686').replace(/\/$/, '');
const TV_TOKEN = process.env.ONTO_TV_TOKEN || '';

const TOOLS = [
  {
    name: 'ontotv_channels',
    description: 'Fetch active channels and playback state from the local Onto the TV server, falling back to Manifold TV lenses when offline.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ontotv_rank_with_lens',
    description: 'Rank candidate canonical TV works (wikidata:/ia:/imdb:) through a signed Manifold TV Lens, filtering slop.',
    inputSchema: {
      type: 'object',
      required: ['lensId'],
      properties: {
        lensId: { type: 'string', description: 'e.g. lens:tv:night-flight or lens:tv:open-cinema' },
        candidateWorkIds: { type: 'array', items: { type: 'string' } },
        currentWorkId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ontotv_bridge_double_feature',
    description: 'Build a double-feature or triple-feature bridge between two films in Manifold space.',
    inputSchema: {
      type: 'object',
      required: ['filmA', 'filmB'],
      properties: {
        filmA: { type: 'string' },
        filmB: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
];

async function queryLocalTvHome(): Promise<unknown> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (TV_TOKEN) headers['X-Onto-Token'] = TV_TOKEN;
    const r = await fetch(`${TV_SERVER}/api/home`, { headers, signal: AbortSignal.timeout(2500) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { liveServer: true, url: TV_SERVER, home: await r.json() };
  } catch {
    const hub = getManifoldHub();
    return {
      liveServer: false,
      note: 'Local tv-server not reachable; returning signed Manifold TV channel lenses',
      lenses: hub.listLenses('tv'),
    };
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let req: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (!req.method || req.method.startsWith('notifications/')) return;
  const id = req.id ?? null;

  if (req.method === 'initialize') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'onto-the-tv-mcp', version: '0.1.0' },
        },
      }) + '\n',
    );
    return;
  }
  if (req.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: TOOLS } }) + '\n');
    return;
  }
  if (req.method === 'tools/call') {
    const name = String(req.params?.name || '');
    const args = (req.params?.arguments || {}) as Record<string, unknown>;
    const hub = getManifoldHub();
    let out: unknown;
    if (name === 'ontotv_channels') {
      out = await queryLocalTvHome();
    } else if (name === 'ontotv_rank_with_lens') {
      out = hub.applyLens({
        lensId: String(args.lensId || 'lens:tv:night-flight'),
        candidateWorkIds: Array.isArray(args.candidateWorkIds) ? (args.candidateWorkIds as string[]) : undefined,
        currentWorkId: typeof args.currentWorkId === 'string' ? args.currentWorkId : undefined,
      });
    } else if (name === 'ontotv_bridge_double_feature') {
      out = hub.findBridge(String(args.filmA || ''), String(args.filmB || ''), { domain: 'tv', limit: 4 });
    } else {
      process.stdout.write(
        JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool ${name}` } }) + '\n',
      );
      return;
    }
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] },
      }) + '\n',
    );
  }
});
