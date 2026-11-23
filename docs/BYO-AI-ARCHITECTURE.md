# Bring-Your-Own AI Architecture Across Manifold, Onto, and Cohort

This ecosystem separates **shared public geometry**, **thin open frontends**, and **private user-owned backends** so open-source apps can ship cleanly with zero copyrighted payloads while scaling to rich personal libraries driven by your own AI agent.

## Three-Layer Model

```
+------------------------------------------------------------------------+
| LAYER 1: Manifold (Open Coordinates, Signed Lenses, Canary Trust)      |
| - 32-D / fp16 vectors keyed ONLY by public canonical IDs               |
| - Ed25519-signed curation lenses (channels, radio stations, blueprints)|
| - Fail-closed boundary gate: zero paths, extensions, or raw hashes     |
| - k-anonymous shard pulls (`sha256(workId)[:2]`) + MCP JSON-RPC 2.0    |
+------------------------------------+-----------------------------------+
                                     | pull 1/256th shards + lenses
                                     v (no filenames or history leave)
+------------------------------------------------------------------------+
| LAYER 2: Thin Native & Web Frontends + Open Showcase Content           |
| - Onto the TV     -> 4 Blender Open Movies + 24 TV coordinates         |
| - Onto the Radio  -> 10 CC0/PD audio streams + 38 radio coordinates    |
| - Cohort          -> 36 CC BY 4.0 USMLE/clinical items in seed pool    |
|   Cold launches work immediately offline or in review with open media. |
+------------------------------------+-----------------------------------+
                                     | authenticated session + streaming
                                     v
+------------------------------------------------------------------------+
| LAYER 3: You + Your AI Agent as the Backend                            |
| - You source and store your own media or study materials locally       |
| - Your coding agent connects to Manifold MCP (`/api/mcp` or stdio)     |
| - Your personal server implements the lightweight client wire API      |
+------------------------------------------------------------------------+
```

## Layer 1: Manifold Public Protocol

| Surface | Canonical Work IDs | Open Showcase Content | Signed Lenses in Seed |
|---|---|---|---|
| **Onto the TV** (`tv`) | `wikidata:Q...`, `ia:...`, `imdb:tt...`, `yt:...` | *Sintel*, *Tears of Steel*, *Big Buck Bunny*, *Elephants Dream* (`streamUrl` MP4s) | `3` channels (`lens:tv:open-cinema`, `lens:tv:night-flight`, `lens:tv:midnight-noir`) |
| **Onto the Radio** (`radio`) | `mbid:...`, `isrc:...` | `10` CC0/PD Wikimedia MP3 streams + Jazz (*Miles orbit*) & Classical (*Heavy & hypnotic*) gateways (`38` coordinates) | `5` stations (`late-wire`, `motorik-pulse`, `chamber-focus`, `jazz-miles-orbit`, `classical-heavy`) |
| **Cohort** (`cohort`) | `cohort:...`, `doi:...`, `pmid:...` | `36` CC BY 4.0 clinical/USMLE items in `canon-seed.json` (`556` in upstream open content) | `2` exam blueprints (`step1-hemodynamics`, etc.) |

### Privacy-Preserving Shard Join

Manifold never asks for your directory listing or listening/watch history:

1. Locally compute `prefix = sha256(workId)[:2]` (lowercase hex `00`..`ff`, implemented in [`workShardPrefix`](../src/lib/crypto.ts)).
2. Request `GET /api/v1/shard/<prefix>?domain=tv|radio|cohort` — the hub only sees 1 of 256 coarse buckets.
3. Join vectors (`vec32`, `vecFp16B64`, `x`, `y`) and evaluate signed Lenses locally on your own server or device.

If you contribute new canonical vectors via `POST /api/v1/contribute` or `manifold_contribute`, `src/lib/boundary.ts` rejects any path separator (`/Users/`, `/Volumes/`, etc.), media filename extension (`.mp4`, `.mkv`, `.m4a`, `.mp3`, etc.), or bare hex hash, and `src/lib/reputation.ts` audits overlap against canary vectors with a `0.98` mean cosine gate under a `Beta(alpha, beta)` trust score.

## Layer 2: Thin Frontends

- **Onto the Radio** ([`todd866/onto-the-radio`](https://github.com/todd866/onto-the-radio)): Native SwiftUI player for iOS, macOS, and tvOS. Plays bundled CC0/PD streams offline, hands off to Apple Music or YouTube Music, imports local files via `Files.app`, or connects to a personal Home Server.
- **Onto the TV** ([`todd866/onto-the-tv`](https://github.com/todd866/onto-the-tv)): Channel sequencer and player for Mac, Samsung TV, iPhone remote, and Apple TV (`ios/Shared/ManifoldClient.swift`).
- **Cohort** ([`todd866/cohort`](https://github.com/todd866/cohort)): Concept-embedding spaced repetition scheduler.

## Layer 3: Connecting Your AI Agent

### MCP Client Configuration

Point any MCP-compatible AI client directly at the hosted Streamable HTTP endpoint:

```json
{
  "mcpServers": {
    "manifold": {
      "url": "https://manifold-chi.vercel.app/api/mcp"
    }
  }
}
```

Or run stdio bridges locally via `node --experimental-strip-types`:

- `bin/manifold-mcp.ts` (`npm run mcp`) — all 8 core `manifold_*` tools (set `MANIFOLD_REMOTE_URL=https://manifold-chi.vercel.app/api/mcp` to proxy).
- `bin/onto-radio-mcp.ts` — `ontoradio_stations`, `ontoradio_sequence`, `ontoradio_transition_bridge`.
- `bin/onto-tv-mcp.ts` — `ontotv_channels`, `ontotv_rank_with_lens`, `ontotv_bridge_double_feature`.
- `bin/cohort-mcp.ts` — `cohort_blueprints`, `cohort_next_concepts`.

### Core Manifold MCP Tools (`src/lib/mcp.ts`)

1. `manifold_status` — Pool counts across `tv`/`radio`/`cohort`, shard coverage, lenses, contributors.
2. `manifold_search` — Search canonical works and concepts by domain and free text.
3. `manifold_neighbours` — Nearest same-domain neighbours plus cross-domain resonances.
4. `manifold_bridge` — Latent midpoint discovery between two `workId`s.
5. `manifold_lenses` — List Ed25519-signed curation lenses with signature validity.
6. `manifold_apply_lens` — Rank your own local `candidateWorkIds` (or the seed pool) through a signed lens.
7. `manifold_contribute` — Submit signed canonical vectors or a signed lens through the boundary & canary gates.
8. `manifold_reputation` — Inspect contributor trust tiers (`steward`, `trusted`, `provisional`, `quarantined`) and compute credits.

### App Backend Contracts

- **Onto the Radio HTTP spec + zero-dependency starter**: [`todd866/onto-the-radio` — `docs/BYO-BACKEND.md`](https://github.com/todd866/onto-the-radio/blob/main/docs/BYO-BACKEND.md) and [`examples/byo-backend/server.py`](https://github.com/todd866/onto-the-radio/blob/main/examples/byo-backend/server.py) (`/api/login`, `/api/home`, `/api/queue`, `/api/audio/:sha`, `/api/art/:sha`, `/api/event`).
- **Onto the TV native/server routes**: `/api/home`, `/api/next`, `/api/progress`, `/media?src=...` (see [`todd866/onto-the-tv` — `ios/README.md`](https://github.com/todd866/onto-the-tv/blob/main/ios/README.md)).
