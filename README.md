# Manifold

**Open coordinate pool, Ed25519-signed curation lenses, canary-verified contributor reputation, and Model Context Protocol (MCP) hub.**

The ecosystem focuses on thin native frontends (**Onto the TV**, **Onto the Radio + Glancebar's OtR connector**, and **Cohort** / **Cohort Reader**) paired with open showcase media and Manifold embeddings, while **you and your AI agent run your own backend** against content you supply yourself. Zero copyrighted media, local filesystem paths, raw file hashes, or personal histories ever enter Manifold.

See [`docs/BYO-AI-ARCHITECTURE.md`](docs/BYO-AI-ARCHITECTURE.md) for the full 3-layer blueprint and [`docs/PUBLIC-PRIVATE-SPLIT.md`](docs/PUBLIC-PRIVATE-SPLIT.md) for how private/public repos (and private-only companions like **Onto the Games**) are kept cleanly separated.

## Surfaces & Open Showcases

| Domain | Client Surface | Canonical Work IDs | Open Showcase Built In |
|---|---|---|---|
| `tv` | [**Onto the TV**](https://github.com/todd866/onto-the-tv) | `wikidata:Q...`, `ia:...`, `imdb:tt...`, `yt:...` | 4 Blender Open Movies (*Sintel*, *Tears of Steel*, *Big Buck Bunny*, *Elephants Dream*) + 24 coordinates, 3 signed channels |
| `radio` | [**Onto the Radio**](https://github.com/todd866/onto-the-radio) (+ [**Glancebar**](https://github.com/todd866/glancebar) OtR connector) | `mbid:...`, `isrc:...` | 10 CC0/PD Wikimedia MP3 streams + 38 coordinates (incl. Jazz *Miles orbit* & Classical *Heavy & hypnotic*), 5 signed stations; desktop library bridge via `tools/otr-connector/otr_connector.py` |
| `cohort` | [**Cohort**](https://github.com/todd866/cohort) | `cohort:...`, `doi:...`, `pmid:...` | 36 CC BY 4.0 medical items in `canon-seed.json`, 2 signed exam blueprints |
| `reader` | [**Cohort Reader**](https://github.com/todd866/cohort-reader) | `isbn:...`, `ol:...`, `gutenberg:...`, `arxiv:...`, `doi:...`, `pmid:...` | 12 Project Gutenberg classics + 10 open-access papers/reference coordinates, 3 signed reading lenses |

> Active ecosystem focus: **Onto the TV**, **Onto the Radio** (paired with Glancebar's `tools/otr-connector/otr_connector.py` desktop library bridge & Mac remote control, superseding the retired `6IAN` stack), and **Cohort**. Private-only companion shells such as **Onto the Games** (`todd866/onto-the-games-private`) stay outside Manifold.

## HTTP API (`https://manifold-chi.vercel.app`)

| Route | Purpose |
|---|---|
| `GET /` | Single-viewport instrument console (`Map`, `Lenses`, `Trust`, `MCP`) |
| `GET /api/v1/status` | Pool telemetry across `tv`, `radio`, `cohort`, and `reader` |
| `GET /api/v1/works` | Search canonical works or inspect nearest neighbours (`?workId=...`) |
| `GET /api/v1/shard/:prefix` | k-anonymous 2-hex prefix (`sha256(workId)[:2]`, `00`..`ff`) for private local library join |
| `GET /api/v1/bridge?a=...&b=...` | Latent midpoint discovery between two works or concepts |
| `GET,POST /api/v1/lenses` | List, apply, or publish Ed25519-signed curation Lenses |
| `POST /api/v1/contribute` | Submit signed vector batches checked by boundary (`src/lib/boundary.ts`) & canary cosine (`src/lib/reputation.ts`) gates |
| `GET /api/v1/reputation` | Inspect `Beta(alpha, beta)` contributor trust tiers & compute credits |
| `GET,POST /api/mcp` | Streamable HTTP JSON-RPC 2.0 MCP server (8 tools) |

## Bring Your Own AI Backend (MCP + Reference Starter)

Give your AI coding assistant access to Manifold's HTTP MCP endpoint:

```json
{
  "mcpServers": {
    "manifold": {
      "url": "https://manifold-chi.vercel.app/api/mcp"
    }
  }
}
```

Or run the local stdio MCP servers directly:

- `npm run mcp` (`bin/manifold-mcp.ts`) — `manifold_status`, `manifold_search`, `manifold_neighbours`, `manifold_bridge`, `manifold_lenses`, `manifold_apply_lens`, `manifold_contribute`, `manifold_reputation`
- `node --experimental-strip-types bin/onto-radio-mcp.ts` — `ontoradio_stations`, `ontoradio_sequence`, `ontoradio_transition_bridge`
- `node --experimental-strip-types bin/onto-tv-mcp.ts` — `ontotv_channels`, `ontotv_rank_with_lens`, `ontotv_bridge_double_feature`
- `node --experimental-strip-types bin/cohort-mcp.ts` — `cohort_blueprints`, `cohort_next_concepts`
- `node --experimental-strip-types bin/cohort-reader-mcp.ts` — `reader_lenses`, `reader_recommend`, `reader_bridge_reading`

For an end-to-end working personal music server using k-anonymous `/api/v1/shard/:prefix` joins, see Onto the Radio's [`examples/byo-backend/`](https://github.com/todd866/onto-the-radio/tree/main/examples/byo-backend) and [`docs/BYO-BACKEND.md`](https://github.com/todd866/onto-the-radio/blob/main/docs/BYO-BACKEND.md), or Glancebar's `tools/otr-connector/otr_connector.py` desktop library bridge & Mac remote control.

## Development

```bash
npm test                               # Boundary, Ed25519, canary spoofing, lens & MCP tests
npx tsc --noEmit                       # TypeScript check
npm run build                          # Next.js production build
python3 tools/manifold_sync.py --help  # Fail-closed exporter & shard CLI
```

## Licence

MIT. Seed embeddings reference public-domain cinema, CC0/Public-Domain MusicBrainz recordings, and CC BY 4.0 USMLE Step 1 items from [Cohort](https://cohort.md).
