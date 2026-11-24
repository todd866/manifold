# Public vs. Private Repository Split Pattern

Every app in this ecosystem separates **shareable architecture and code** from **personal libraries, household config, and local infrastructure**. Whenever an app touches private collections or environment state, keep full working history in a private source repository and publish sanitized snapshots to the public mirror — or keep the repository private-only when its core runtime relies on device-specific identifiers or host tooling (such as `todd866/onto-the-games-private`).

## What Goes Where

| Public Repo (`todd866/<project>`) | Private Repo (`todd866/<project>-private` or `-full`) & External Config |
|---|---|
| UI source code, ranking math, wire protocols, tests | Personal media paths, acquisition scripts, household member lists |
| Open-source showcase assets (CC0/PD audio, Blender Open Movies, CC BY 4.0 decks) | Private server URLs, local `.xcconfig` overrides (`~/.config/<app>/`), Tailscale hostnames |
| Canonical embedding coordinates (`mbid:`, `wikidata:`, `imdb:`, `cohort:`) | Local file hashes, watch/listen logs, unreviewed screenshots or audit dumps |
| Architecture docs, MCP tools, BYO backend reference starters | Agent scratchbooks, private deployment/ops runbooks, `TODO.md` |

## Fail-Closed Publish Pipeline (Reference Pattern)

Modeled on the verified workflow used between `onto-the-tv-full` (private) and [`todd866/onto-the-tv`](https://github.com/todd866/onto-the-tv) (public):

1. **Snapshot export (`git archive`) — never push private git history:**
   - Export only the target `HEAD` tree into a temporary staging directory.
   - Apply one commit on top of the public repo's `main` branch (`no --force`), so removed secrets or old internal commits can never surface via `git log`.
2. **Gate 1 — Explicit `.public-exclude` removal check:**
   - Remove internal paths listed in `.public-exclude` and fail closed if any matching path still exists after deletion.
3. **Gate 2 — External denylist text scan (`rg`):**
   - Keep private terms (family names, private hostnames, personal emails, volume names) in a denylist file **outside** the repository (for example `~/.config/<project>/public-denylist.txt`) and abort if any exported text file matches.
4. **Gate 3 — Image hash allowlist + Secret scan (`gitleaks`):**
   - Reject unapproved binary images unless their SHA-256 hash appears in `~/.config/<project>/public-images-approved.txt`.
   - Run `gitleaks` against the staged tree / new commit before pushing.
5. **Gate 4 — Noreply commit identity:**
   - Stamp author and committer explicitly with the GitHub noreply identity (`GIT_AUTHOR_EMAIL=<handle>@users.noreply.github.com`) and assert no personal email appears in `git log -1`.

## Cross-Tool Sync Boundary (`tools/manifold_sync.py`)

When exporting embeddings from private libraries into Manifold, [`tools/manifold_sync.py`](../tools/manifold_sync.py) enforces a matching fail-closed boundary (`assert_payload_clean`) before Ed25519 signing:

- Strips `/Users/`, `/Volumes/`, Windows paths, and media extensions (`.mkv`, `.mp4`, `.m4a`, `.flac`, etc.).
- Rejects raw file SHA-1/SHA-256 hex strings and private field names (`filepath`, `infohash`, `household`, `viewerName`).
- Only exports works resolvable to public canonical prefixes (`wikidata:Q...`, `ia:...`, `imdb:tt...`, `yt:...`, `mbid:...`, `isrc:...`, `cohort:...`, `doi:...`, `pmid:...`, `isbn:...`, `ol:...`, `gutenberg:...`, `arxiv:...`).

## Repository Split Matrix

| Project | Private Source Repo | Public Mirror Repo | Publish / Export Mechanism | Notes |
|---|---|---|---|---|
| Onto the TV | `todd866/onto-the-tv-full` | `todd866/onto-the-tv` | `scripts/publish-public.sh` | Active video surface |
| Onto the Radio | `todd866/onto-the-radio-private` | `todd866/onto-the-radio` | `scripts/publish-public.sh` | Active audio surface; pairs with Glancebar's OtR connector |
| Onto the Games | `todd866/onto-the-games-private` | *None (private-only)* | *No public mirror* | Contains device-specific Switch Title IDs and `nxnative` host runtime (LAN/tailnet HTTPS `Range` pulls + isolated saves) |
| Manifold | `todd866/manifold-private` | `todd866/manifold` | `scripts/publish-public.sh` | Public coordinate pool, signed lenses, and MCP hub |
| Glancebar | `todd866/glancebar-private` | `todd866/glancebar` | `scripts/publish-public.sh` | Includes `tools/otr-connector/otr_connector.py` desktop library bridge & Mac remote control |
| Music Core | `todd866/music-core-private` | `todd866/music-core` | `tools/public-export/publish.sh` | Shared audio analysis and curation core |
| Cohort | `todd866/md3` | `todd866/cohort` | Open export pipeline | Active study & spaced-repetition surface (+ `cohort-reader`) |
| Fleet | `todd866/fleet-private` | `todd866/fleet` | `tools/public-export/publish.sh` | Multi-machine orchestration and tooling |
| Isobar | `todd866/isobar-private` / `isobar-data-private` | `todd866/isobar` / `isobar-data` | Split snapshot publish | Native Mac and web surface |
| 6ian Radio *(legacy)* | `todd866/music-radio` | `todd866/6ian-radio` | `tools/public-export/publish.sh` | **Legacy / archived** — `6IAN` is retired and superseded by Onto the Radio + Glancebar's OtR connector |
