# Manifold Protocol & Hub Specification (v0.1)

Manifold is the shared mathematical coordinate pool, signed lens registry, canary-verified reputation ledger, and MCP hub across four Bring-Your-Own-Content surfaces:

1. **Onto the TV (`tv`)** — films, series, shorts, and curated broadcast channels (`wikidata:Q...`, `ia:<slug>`, `imdb:tt...`, `yt:<id>`).
2. **Onto the Radio (`radio`)** — songs, mixes, and mood/station steering (`mbid:<uuid>`, `isrc:<code>`).
3. **Cohort (`cohort`)** — spaced-repetition study cards, clinical questions, and exam blueprints (`cohort:<id>`, `doi:<doi>`, `pmid:<id>`, `wikidata:Q...`).
4. **Cohort Reader (`reader`)** — books, preprints, and research papers (`isbn:<isbn13>`, `ol:<OL...W|M>`, `gutenberg:<id>`, `arxiv:<id>`, `doi:<doi>`, `pmid:<id>`, `wikidata:Q...`, `ia:<slug>`).

Zero copyrighted media bytes, local file paths, raw file hashes, or private watch/study histories ever enter Manifold.

---

## 1. Canonical Work & Concept Identifiers

Every item in Manifold is addressed by `(workId, modelId, recipeHash)`:

- **Allowed `workId` namespaces** (enforced fail-closed by `src/lib/boundary.ts`):
  - `wikidata:Q<digits>` — films, series, concepts, works
  - `ia:<identifier>` — Internet Archive public-domain / CC items
  - `imdb:tt<digits>` — film / episode works
  - `yt:<11-char-id>` or `ytc:<channel-id>` — public video / channel works
  - `mbid:<uuid>` — MusicBrainz recording or release-group
  - `isrc:<12-alnum>` — International Standard Recording Code
  - `cohort:<slug>` — open curriculum / question / concept identifier
  - `doi:<prefix>/<suffix>` or `pmid:<digits>` — scholarly literature
  - `isbn:97[89]<10-digits>` or `ol:OL<digits>[WM]` — books and Open Library works
  - `gutenberg:<digits>` or `arxiv:<id>` — public-domain ebooks and open preprints
- **Forbidden inputs (hard reject)**:
  - Filesystem paths (`/Users/`, `/Volumes/`, `/home/`, `C:\`, `../`)
  - Media & document container extensions (`.mp4`, `.mkv`, `.avi`, `.mov`, `.flac`, `.m4a`, `.mp3`, `.wav`, `.srt`, `.epub`, `.pdf`, `.azw3`, `.mobi`, `.djvu`, `.chm`)
  - Bare 40-char SHA-1 / infohashes, 64-char file SHA-256s, or `magnet:` URIs
  - Household viewer names or per-user watch timestamps

---

## 2. Coordinate Envelope & k-Anonymous Shards

- **Models**:
  - `gemini-embedding-2` (3,072-D multimodal audio/video/text space)
  - `embeddinggemma-2` (768-D local Apple Silicon MLX / open coverage space)
- **Wire representation**:
  - `vec32`: 32-D whitened PCA `int8` coordinates (`[-127..127]`) + scale for sub-millisecond steering and lens projection.
  - `vecB64` (optional on full shard fetch): IEEE-754 `float16` base64 vector (6,144 bytes for 3072-D; 1,536 bytes for 768-D), L2-normalized.
  - `neighbours`: top-12 nearest `(workId, cosine)` edges within the same `(modelId, recipeHash)`.
  - `landmarks`: cosine similarities to fixed public anchor works for cross-model ridge/isotonic alignment (`relation.py` bridge).
- **k-Anonymous Prefix Shards (`GET /api/v1/shard/:prefix`)**:
  - Partitioned by the first 2 hex characters (`00`..`ff`) of `sha256(workId)` (or single hex `0`..`f` for compact corpora).
  - Clients download entire prefix buckets and join against their local library offline, never disclosing their inventory to the server.

---

## 3. Signed Lenses (`ManifoldLens`)

A Lens is an Ed25519-signed portable curation overlay (Channel for TV, Station for Radio, Blueprint for Cohort):

```json
{
  "id": "lens:tv:night-flight",
  "domain": "tv",
  "name": "Night Flight",
  "summary": "Slow cerebral sci-fi, silent expressionism, and nocturnal cinema",
  "issuer": "ed25519:<base64url-pubkey>",
  "issuerHandle": "ian.todd",
  "modelId": "embeddinggemma-2",
  "Version": 1,
  "createdAt": "2026-11-23T02:35:00Z",
  "anchors": [
    { "workId": "wikidata:Q151599", "weight": 1.0, "mark": "good" },
    { "workId": "wikidata:Q1202626", "weight": 0.85, "mark": "good" }
  ],
  "blockedMarks": ["slop"],
  "transitions": [
    { "from": "wikidata:Q151599", "to": "wikidata:Q1202626", "weight": 0.92 }
  ],
  "signature": "<base64url-ed25519-sig-over-canonical-json>"
}
```

---

## 4. Canary Overlap Verification & Reputation

Contributors sign vector batches with an Ed25519 key (`ed25519:<pubkey>`):

1. Every batch carrying overlap items already verified in the canonical pool under `(modelId, recipeHash)` is checked by cosine similarity:
   - Mean overlap cosine `>= 0.980` and min `>= 0.950`: **Verified**. Novel items in the batch are promoted (immediately if `trust >= 0.75`, or staged until corroborated by a second peer if `provisional`), and contributor Beta parameters update (`alpha += verifiedCount`, `+credits`).
   - Mean overlap cosine `< 0.920`: **Quarantined**. Entire batch is rejected and contributor penalty increments (`beta += 5 * failedCount`), neutralizing lazy/upscaled/poisoned submissions without human moderation.
2. Rooted trust composition follows `trustlist` semantics: trust scores (`alpha / (alpha + beta)`) are an explainable prior; canary cosine verification is ground truth.

---

## 5. MCP Tool Surface (`/api/mcp` & `bin/manifold-mcp.ts`)

| Tool | Purpose |
|---|---|
| `manifold_status` | Counts, models, shard health, active lenses, and top contributors |
| `manifold_search` | Query canonical works/concepts across `tv`, `radio`, and `cohort` |
| `manifold_neighbours` | Nearest semantic neighbours + transition edges for a `workId` |
| `manifold_bridge` | Find works sitting mathematically between `workA` and `workB` |
| `manifold_lenses` | List verified signed lenses by domain (`tv`, `radio`, `cohort`) |
| `manifold_apply_lens` | Rank a caller-supplied list of `workId`s through a signed Lens |
| `manifold_contribute` | Submit an Ed25519-signed batch of vectors/marks with canary check |
| `manifold_reputation` | Inspect a contributor key's trust tier, canary cosine, and credits |
