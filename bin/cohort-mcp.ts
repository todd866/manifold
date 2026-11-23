#!/usr/bin/env node
/**
 * Local MCP bridge for Cohort (`cohort-mcp`).
 * Connects Cohort's open medical question manifold & exam blueprints with Manifold.
 */
import * as readline from 'node:readline';
import { getManifoldHub } from '../src/lib/engine.ts';

const TOOLS = [
  {
    name: 'cohort_blueprints',
    description: 'List signed Cohort exam & discipline blueprints available in Manifold.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cohort_next_concepts',
    description: 'Rank open Cohort medical items against a signed exam blueprint or missed-question neighbourhood.',
    inputSchema: {
      type: 'object',
      properties: {
        lensId: { type: 'string', description: 'e.g. lens:cohort:step1-hemodynamics' },
        missedWorkId: { type: 'string', description: 'Optional cohort:<id> the learner just missed' },
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
          serverInfo: { name: 'cohort-manifold-mcp', version: '0.1.0' },
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
    if (name === 'cohort_blueprints') {
      out = hub.listLenses('cohort');
    } else if (name === 'cohort_next_concepts') {
      if (typeof args.missedWorkId === 'string' && args.missedWorkId) {
        out = hub.getNeighbours(args.missedWorkId, typeof args.limit === 'number' ? args.limit : 6);
      } else {
        out = hub.applyLens({
          lensId: String(args.lensId || 'lens:cohort:step1-hemodynamics'),
          limit: typeof args.limit === 'number' ? args.limit : 10,
        });
      }
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
