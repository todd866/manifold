#!/usr/bin/env node
/**
 * Standalone stdio MCP server for Manifold.
 *
 * - Default mode: serves directly from the local ManifoldHub (`canon-seed.json` + `~/.local/state/manifold/`).
 * - Remote proxy mode: set `MANIFOLD_REMOTE_URL=https://<deployment>/api/mcp` to forward JSON-RPC to the cloud hub.
 */
import * as readline from 'node:readline';
import { handleMcpRequest, type JsonRpcRequest } from '../src/lib/mcp.ts';

const remoteUrl = process.env.MANIFOLD_REMOTE_URL?.trim();

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }) + '\n',
    );
    return;
  }

  if (remoteUrl) {
    try {
      const resp = await fetch(remoteUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (resp.status === 204) return;
      const text = await resp.text();
      if (text.trim()) process.stdout.write(text.trim() + '\n');
    } catch (err) {
      if (req.id !== undefined) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            error: { code: -32000, message: `Remote MCP error: ${(err as Error).message}` },
          }) + '\n',
        );
      }
    }
    return;
  }

  const res = handleMcpRequest(req);
  if (res) {
    process.stdout.write(JSON.stringify(res) + '\n');
  }
});
