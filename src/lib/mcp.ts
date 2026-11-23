/**
 * Model Context Protocol (MCP) JSON-RPC 2.0 handler for Manifold.
 * Serves both HTTP Streamable POST (`/api/mcp`) and stdio (`bin/manifold-mcp.ts`).
 */
import type { ManifoldDomain } from './boundary.ts';
import {
  getManifoldHub,
  type ManifoldLens,
  type SignedContributionEnvelope,
} from './engine.ts';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const MANIFOLD_MCP_TOOLS = [
  {
    name: 'manifold_status',
    description:
      'Return Manifold pool status: work counts across tv/radio/cohort, supported embedding models, shard coverage, signed lenses, and verified contributors.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'manifold_search',
    description:
      'Search canonical works and concepts in Manifold by domain (tv, radio, cohort) and free-text query.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['tv', 'radio', 'cohort'] },
        query: { type: 'string', description: 'Title, creator, discipline, genre, or canonical ID' },
        limit: { type: 'number', minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'manifold_neighbours',
    description:
      'Return nearest semantic neighbours within the same domain plus cross-domain resonances (e.g. films <-> music <-> medical concepts) for a canonical workId.',
    inputSchema: {
      type: 'object',
      required: ['workId'],
      properties: {
        workId: { type: 'string', description: 'Canonical ID such as wikidata:Q207626 or mbid:...' },
        k: { type: 'number', minimum: 1, maximum: 24 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'manifold_bridge',
    description:
      'Find canonical works lying mathematically along the latent midpoint between workIdA and workIdB.',
    inputSchema: {
      type: 'object',
      required: ['workIdA', 'workIdB'],
      properties: {
        workIdA: { type: 'string' },
        workIdB: { type: 'string' },
        domain: { type: 'string', enum: ['tv', 'radio', 'cohort'] },
        limit: { type: 'number', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'manifold_lenses',
    description:
      'List Ed25519-signed curation lenses (TV channels, Radio stations, Cohort exam blueprints) with signature verification status.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['tv', 'radio', 'cohort'] },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'manifold_apply_lens',
    description:
      'Rank a local library subset (candidateWorkIds) or domain pool through a signed Lens, applying anchor cosine pull, transition boosts, and slop filtering.',
    inputSchema: {
      type: 'object',
      required: ['lensId'],
      properties: {
        lensId: { type: 'string', description: 'e.g. lens:tv:night-flight or lens:radio:late-wire' },
        candidateWorkIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of canonical workIds owned locally',
        },
        currentWorkId: { type: 'string', description: 'Optional currently playing/studying workId' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'manifold_contribute',
    description:
      'Submit an Ed25519-signed batch of canonical vectors or a signed Lens; enforces fail-closed path/hash privacy gates and canary overlap verification.',
    inputSchema: {
      type: 'object',
      required: ['kind', 'payload'],
      properties: {
        kind: { type: 'string', enum: ['vectors', 'lens'] },
        payload: { type: 'object' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'manifold_reputation',
    description:
      'Inspect contributor trust scores, canary cosine accuracy, and earned compute credits.',
    inputSchema: {
      type: 'object',
      properties: {
        issuer: { type: 'string', description: 'Optional ed25519:<pubkey> to inspect a single actor' },
      },
      additionalProperties: false,
    },
  },
] as const;

export function handleMcpRequest(req: JsonRpcRequest): JsonRpcResponse | null {
  const id = req.id ?? null;
  if (!req || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32600, message: 'Invalid JSON-RPC 2.0 request' },
    };
  }

  if (req.method === 'notifications/initialized' || req.method.startsWith('notifications/')) {
    return null;
  }

  if (req.method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'manifold',
          version: '0.1.0',
        },
      },
    };
  }

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: MANIFOLD_MCP_TOOLS },
    };
  }

  if (req.method === 'tools/call') {
    const toolName = String(req.params?.name || '');
    const args = (req.params?.arguments || {}) as Record<string, unknown>;
    const hub = getManifoldHub();

    try {
      let data: unknown;
      switch (toolName) {
        case 'manifold_status':
          data = hub.getStatus();
          break;
        case 'manifold_search':
          data = hub.listWorks({
            domain: args.domain as ManifoldDomain | undefined,
            query: typeof args.query === 'string' ? args.query : undefined,
            limit: typeof args.limit === 'number' ? args.limit : 20,
          });
          break;
        case 'manifold_neighbours': {
          const out = hub.getNeighbours(
            String(args.workId || ''),
            typeof args.k === 'number' ? args.k : 8,
          );
          if (!out) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: `Unknown workId: ${String(args.workId)}` }],
              },
            };
          }
          data = out;
          break;
        }
        case 'manifold_bridge':
          data = hub.findBridge(String(args.workIdA || ''), String(args.workIdB || ''), {
            domain: args.domain as ManifoldDomain | undefined,
            limit: typeof args.limit === 'number' ? args.limit : 6,
          });
          break;
        case 'manifold_lenses':
          data = hub.listLenses(args.domain as ManifoldDomain | undefined);
          break;
        case 'manifold_apply_lens': {
          const ranked = hub.applyLens({
            lensId: String(args.lensId || ''),
            candidateWorkIds: Array.isArray(args.candidateWorkIds)
              ? (args.candidateWorkIds as string[])
              : undefined,
            currentWorkId: typeof args.currentWorkId === 'string' ? args.currentWorkId : undefined,
            limit: typeof args.limit === 'number' ? args.limit : 12,
          });
          if (!ranked) {
            return {
              jsonrpc: '2.0',
              id,
              result: {
                isError: true,
                content: [{ type: 'text', text: `Unknown lensId: ${String(args.lensId)}` }],
              },
            };
          }
          data = ranked;
          break;
        }
        case 'manifold_contribute': {
          if (args.kind === 'lens') {
            data = hub.publishLens(args.payload as unknown as ManifoldLens);
          } else {
            data = hub.submitContribution(args.payload as unknown as SignedContributionEnvelope);
          }
          break;
        }
        case 'manifold_reputation':
          data =
            typeof args.issuer === 'string' && args.issuer
              ? hub.getContributor(args.issuer)
              : hub.listContributors();
          break;
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Unknown tool: ${toolName}` },
          };
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        },
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [{ type: 'text', text: (err as Error).message }],
        },
      };
    }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  };
}
