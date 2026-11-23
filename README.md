# Manifold

Unified coordinate pool, Ed25519-signed curation lenses, canary-verified contributor reputation, and Model Context Protocol (MCP) hub across three Bring-Your-Own-Content surfaces:

- **Onto the TV (`tv`)** — films, series, shorts, and channel lenses (`wikidata:Q...`, `ia:...`, `imdb:tt...`).
- **Onto the Radio (`radio`)** — songs, station lenses, and transition geometry (`mbid:...`, `isrc:...`).
- **Cohort (`cohort`)** — spaced-repetition medical questions, concept neighbourhoods, and exam blueprints (`cohort:...`, `doi:...`, `pmid:...`).

Zero copyrighted media, local filesystem paths, raw file hashes, or household histories enter Manifold. Every submission passes fail-closed boundary validation (`src/lib/boundary.ts`), Ed25519 signature verification (`src/lib/crypto.ts`), and canary cosine auditing (`src/lib/reputation.ts`).

## Endpoints

| Route | Purpose |
|---|---|
| `GET /` | Single-viewport instrument console (`Map`, `Lenses`, `Trust`, `MCP`) |
| `GET /api/v1/status` | Pool telemetry across `tv`, `radio`, and `cohort` |
| `GET /api/v1/works` | Search canonical works or inspect nearest neighbours (`?workId=...`) |
| `GET /api/v1/shard/:prefix` | k-anonymous hex shard (`00`..`ff`) for private local library join |
| `GET /api/v1/bridge?a=...&b=...` | Geodesic midpoint search between two works/concepts |
| `GET,POST /api/v1/lenses` | List, apply, or publish Ed25519-signed Lenses |
| `POST /api/v1/contribute` | Submit signed vector batches with automatic canary verification |
| `GET /api/v1/reputation` | Inspect Beta-Binomial contributor trust & compute credits |
| `GET,POST /api/mcp` | Streamable HTTP JSON-RPC 2.0 MCP server (8 tools) |

## CLI & Local MCP

```bash
npm test                     # Boundary, Ed25519, canary spoofing, lens & MCP tests
npm run build                # Next.js production build
npm run mcp                  # Stdio MCP server (local or MANIFOLD_REMOTE_URL)
python3 tools/manifold_sync.py --help  # Export/import across onto-the-tv, music-core, and cohort
```

## Licence

MIT © Ian Todd. Seed embeddings cover open public-domain cinema, CC0/MusicBrainz recordings, and CC BY 4.0 USMLE Step 1 items from [Cohort](https://cohort.md).
