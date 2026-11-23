#!/usr/bin/env node
/**
 * Local MCP bridge for Onto the Radio (`onto-radio-mcp`).
 * Exposes station lens sequencing, mood/energy filtering, and transition bridges over Manifold.
 */
import * as readline from 'node:readline';
import { getManifoldHub } from '../src/lib/engine.ts';

const TOOLS = [
  {
    name: 'ontoradio_stations',
    description: 'List signed Onto the Radio station lenses and track counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'ontoradio_sequence',
    description: 'Sequence tracks through a signed station lens with optional maxEnergy / maxHeaviness bounds.',
    inputSchema: {
      type: 'object',
      required: ['lensId'],
      properties: {
        lensId: { type: 'string', description: 'e.g. lens:radio:late-wire or lens:radio:motorik-pulse' },
        maxEnergy: { type: 'number', minimum: 0, maximum: 1 },
        limit: { type: 'number', minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ontoradio_transition_bridge',
    description: 'Find smooth intermediate transition tracks between two MusicBrainz recording IDs.',
    inputSchema: {
      type: 'object',
      required: ['fromTrackId', 'toTrackId'],
      properties: {
        fromTrackId: { type: 'string' },
        toTrackId: { type: 'string' },
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
          serverInfo: { name: 'onto-the-radio-mcp', version: '0.1.0' },
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
    if (name === 'ontoradio_stations') {
      out = hub.listLenses('radio');
    } else if (name === 'ontoradio_sequence') {
      const applied = hub.applyLens({
        lensId: String(args.lensId || 'lens:radio:late-wire'),
        limit: typeof args.limit === 'number' ? args.limit : 12,
      });
      const maxE = typeof args.maxEnergy === 'number' ? args.maxEnergy : 1.0;
      out = applied
        ? {
            lens: applied.lens,
            ranked: applied.ranked.filter((r) => (r.work.energy ?? 0.5) <= maxE),
          }
        : null;
    } else if (name === 'ontoradio_transition_bridge') {
      out = hub.findBridge(String(args.fromTrackId || ''), String(args.toTrackId || ''), {
        domain: 'radio',
        limit: 5,
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
