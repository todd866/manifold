#!/usr/bin/env node
/**
 * Local MCP bridge for Cohort Reader (`cohort-reader-mcp`).
 * Connects books, papers, open showcases, and signed Reading Lenses with Manifold.
 */
import * as readline from 'node:readline';
import { getManifoldHub } from '../src/lib/engine.ts';

const TOOLS = [
  {
    name: 'reader_lenses',
    description: 'List signed Reading Lenses (curated book/paper shelves and syllabi) in Manifold.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'reader_recommend',
    description:
      'Rank books and papers (optional local candidateWorkIds) through a signed Reading Lens or nearest neighbours.',
    inputSchema: {
      type: 'object',
      properties: {
        lensId: { type: 'string', description: 'e.g. lens:reader:open-classics' },
        currentWorkId: { type: 'string', description: 'Optional currently read canonical workId (e.g. gutenberg:84 or doi:...)' },
        candidateWorkIds: { type: 'array', items: { type: 'string' } },
        limit: { type: 'number', minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'reader_bridge_reading',
    description: 'Discover books, papers, or study items lying mathematically between two canonical works.',
    inputSchema: {
      type: 'object',
      required: ['workIdA', 'workIdB'],
      properties: {
        workIdA: { type: 'string' },
        workIdB: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
];

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let req: { id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  if (!req.method || req.method.startsWith('notifications/')) return;
  const id = req.id ?? null;
  const hub = getManifoldHub();

  if (req.method === 'initialize') {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'cohort-reader-manifold-mcp', version: '0.1.0' },
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
    let out: unknown;
    if (name === 'reader_lenses') {
      out = hub.listLenses('reader');
    } else if (name === 'reader_recommend') {
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      if (typeof args.currentWorkId === 'string' && args.currentWorkId && !args.lensId) {
        out = hub.getNeighbours(args.currentWorkId, limit);
      } else {
        out = hub.applyLens({
          lensId: String(args.lensId || 'lens:reader:open-classics'),
          candidateWorkIds: Array.isArray(args.candidateWorkIds) ? (args.candidateWorkIds as string[]) : undefined,
          currentWorkId: typeof args.currentWorkId === 'string' ? args.currentWorkId : undefined,
          limit,
        });
      }
    } else if (name === 'reader_bridge_reading') {
      out = hub.findBridge(String(args.workIdA || ''), String(args.workIdB || ''), {
        domain: 'reader',
        limit: typeof args.limit === 'number' ? args.limit : 6,
      });
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
