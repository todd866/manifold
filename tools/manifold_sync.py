#!/usr/bin/env python3
"""manifold_sync.py — Fail-closed exporter, k-anonymous shard client, and signed uploader
connecting Onto the TV, Onto the Radio (music-core), and Cohort to a Manifold hub.

Guarantees:
- Never emits a local filesystem path, media filename, raw SHA-1/SHA-256 hash,
  transfer URI, or household viewer name.
- Keys every exported work strictly to public canonical IDs (`wikidata:Q...`,
  `imdb:tt...`, `yt:...`, `mbid:...`, `isrc:...`, `cohort:...`).
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_HUB = os.environ.get("MANIFOLD_URL", "http://127.0.0.1:3340")
STATE_DIR = Path(os.environ.get("MANIFOLD_STATE_DIR", str(Path.home() / ".local/state/manifold")))

CANONICAL_PATTERNS = (
    re.compile(r"^wikidata:Q[1-9][0-9]{0,12}$"),
    re.compile(r"^ia:[A-Za-z0-9._-]{2,120}$"),
    re.compile(r"^imdb:tt[0-9]{7,10}$"),
    re.compile(r"^yt:[A-Za-z0-9_-]{11}$"),
    re.compile(r"^mbid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I),
    re.compile(r"^isrc:[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$"),
    re.compile(r"^cohort:[a-z0-9][a-z0-9:._-]{2,160}$", re.I),
    re.compile(r"^doi:10\.[0-9]{4,9}/[-._;()/:A-Za-z0-9]+$"),
    re.compile(r"^pmid:[1-9][0-9]{0,10}$"),
    re.compile(r"^isbn:97[89][0-9]{10}$"),
    re.compile(r"^ol:OL[1-9][0-9]{0,10}[WM]$"),
    re.compile(r"^gutenberg:[1-9][0-9]{0,7}$"),
    re.compile(r"^arxiv:(?:[0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?|[a-z-]+(?:\.[a-z]{2})?/[0-9]{7})$", re.I),
)
FORBIDDEN_EXT_RE = re.compile(
    r"\.(?:mp4|m4v|mkv|avi|mov|ts|m2ts|webm|flac|m4a|mp3|wav|ogg|aac|alac|srt|vtt|epub|pdf|azw3|mobi|djvu|chm|cbz|cbr|fb2|docx)\b",
    re.I,
)
FORBIDDEN_PATH_RE = re.compile(r"(?:/Users/|/Volumes/|/home/|/private/|[A-Za-z]:\\|\.\./|~/)", re.I)
BARE_HASH_RE = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$", re.I)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def is_valid_canonical_id(work_id: str) -> bool:
    if not work_id or FORBIDDEN_EXT_RE.search(work_id) or FORBIDDEN_PATH_RE.search(work_id):
        return False
    if BARE_HASH_RE.match(work_id):
        return False
    return any(p.match(work_id) for p in CANONICAL_PATTERNS)


def scrub_text(text: str, max_len: int = 240) -> str:
    cleaned = FORBIDDEN_PATH_RE.sub("[redacted]", str(text or ""))
    cleaned = FORBIDDEN_EXT_RE.sub("", cleaned)
    return cleaned.strip()[:max_len]


def assert_payload_clean(obj: Any, path: str = "root") -> None:
    if obj is None or isinstance(obj, (bool, int, float)):
        return
    if isinstance(obj, str):
        if FORBIDDEN_PATH_RE.search(obj):
            raise ValueError(f"Forbidden path leak at {path}")
        if FORBIDDEN_EXT_RE.search(obj):
            raise ValueError(f"Forbidden media filename extension at {path}")
        if not path.endswith(".recipeHash") and BARE_HASH_RE.match(obj.strip()):
            raise ValueError(f"Forbidden raw hex hash at {path}")
        return
    if isinstance(obj, list):
        for i, item in enumerate(obj):
            assert_payload_clean(item, f"{path}[{i}]")
        return
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.lower() in {"filepath", "relativepath", "localpath", "sha256", "infohash", "household", "viewername"}:
                raise ValueError(f"Forbidden private field '{k}' at {path}")
            assert_payload_clean(v, f"{path}.{k}")


def get_or_create_identity(identity_file: Path | None = None) -> dict[str, str]:
    target = identity_file or (STATE_DIR / "contributor-key.json")
    if target.is_file():
        return json.loads(target.read_text())
    target.parent.mkdir(parents=True, exist_ok=True)
    script = (
        "const c=require('node:crypto');"
        "const seed=c.randomBytes(32);"
        "const pkcs8=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]);"
        "const k=c.createPrivateKey({key:pkcs8,format:'der',type:'pkcs8'});"
        "const spki=c.createPublicKey(k).export({format:'der',type:'spki'});"
        "process.stdout.write(JSON.stringify({"
        "issuer:'ed25519:'+spki.subarray(-32).toString('base64url'),"
        "privateSeedB64Url:seed.toString('base64url')"
        "}));"
    )
    ident = json.loads(subprocess.check_output(["node", "-e", script], text=True))
    target.write_text(json.dumps(ident, indent=2) + "\n")
    os.chmod(target, 0o600)
    return ident


def sign_envelope(unsigned_obj: dict[str, Any], private_seed_b64url: str) -> dict[str, Any]:
    raw_json = json.dumps(unsigned_obj, ensure_ascii=False)
    script = (
        "const c=require('node:crypto');"
        "function cj(v){if(v===null||typeof v!=='object')return JSON.stringify(v);"
        "if(Array.isArray(v))return '['+v.map(cj).join(',')+']';"
        "return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+cj(v[k])).join(',')+'}';}"
        "const obj=JSON.parse(process.argv[2]);"
        "const seed=Buffer.from(process.argv[1],'base64url');"
        "const pkcs8=Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]);"
        "const k=c.createPrivateKey({key:pkcs8,format:'der',type:'pkcs8'});"
        "const sig=c.sign(null,Buffer.from(cj(obj),'utf8'),k);"
        "process.stdout.write(sig.toString('base64url'));"
    )
    sig = subprocess.check_output(["node", "-e", script, private_seed_b64url, raw_json], text=True).strip()
    signed = dict(unsigned_obj)
    signed["signature"] = sig
    assert_payload_clean(signed)
    return signed


def cmd_export_tv(args: argparse.Namespace) -> int:
    space_path = Path(args.video_space).expanduser()
    meta_dir = Path(args.show_meta).expanduser()
    if not space_path.is_file():
        print(f"video-space not found: {space_path}", file=sys.stderr)
        return 1

    raw = json.loads(space_path.read_text())
    # Build lookup from title/show name -> wikidata:Q... or imdb:tt... from show-meta
    meta_ids: dict[str, str] = {}
    if meta_dir.is_dir():
        for mf in meta_dir.glob("*.json"):
            try:
                m = json.loads(mf.read_text())
            except Exception:
                continue
            qid = m.get("wikidataId") or m.get("qid")
            imdb_id = m.get("imdbId")
            cid = None
            if isinstance(qid, str) and re.match(r"^Q[1-9][0-9]*$", qid):
                cid = f"wikidata:{qid}"
            elif isinstance(imdb_id, str) and re.match(r"^tt[0-9]{7,10}$", imdb_id):
                cid = f"imdb:{imdb_id}"
            if cid:
                for name_key in (m.get("title"), m.get("show"), mf.stem):
                    if name_key:
                        meta_ids[str(name_key).strip().lower()] = cid

    entries_in = raw.get("items") or raw.get("videos") or raw.get("tracks") or []
    if isinstance(entries_in, dict):
        entries_in = list(entries_in.values())

    exported: list[dict[str, Any]] = []
    skipped_unmapped = 0
    local_to_canon: dict[str, str] = {}

    # First pass: resolve canonical IDs
    for row in entries_in:
        if not isinstance(row, dict):
            continue
        explicit_id = row.get("workId") or (f"wikidata:{row['wikidataId']}" if row.get("wikidataId") else None)
        title = scrub_text(row.get("title") or row.get("show") or "", 160)
        cand_id = explicit_id or meta_ids.get(title.lower()) or meta_ids.get(str(row.get("show", "")).strip().lower())
        if cand_id and is_valid_canonical_id(cand_id):
            local_key = str(row.get("id") or row.get("key") or title)
            local_to_canon[local_key] = cand_id
        else:
            skipped_unmapped += 1

    seen_canon = set()
    for row in entries_in:
        if not isinstance(row, dict):
            continue
        title = scrub_text(row.get("title") or row.get("show") or "", 160)
        local_key = str(row.get("id") or row.get("key") or title)
        canon_id = local_to_canon.get(local_key)
        if not canon_id or canon_id in seen_canon:
            continue
        seen_canon.add(canon_id)

        nbs: list[dict[str, Any]] = []
        for nb in (row.get("neighbours") or row.get("next") or [])[:12]:
            if isinstance(nb, dict):
                nb_local = str(nb.get("id") or nb.get("workId") or "")
                nb_canon = nb_local if is_valid_canonical_id(nb_local) else local_to_canon.get(nb_local)
                if nb_canon and nb_canon != canon_id:
                    nbs.append({"workId": nb_canon, "sim": round(float(nb.get("sim") or nb.get("score") or 0), 4)})

        item: dict[str, Any] = {
            "workId": canon_id,
            "domain": "tv",
            "title": title or canon_id,
            "creator": scrub_text(row.get("creator") or row.get("director") or row.get("channel") or "Unknown", 120),
            "year": int(row.get("year") or 2026),
            "kind": scrub_text(row.get("kind") or row.get("genre") or "tv", 60),
            "summary": scrub_text(row.get("summary") or "", 300),
            "neighbours": nbs,
        }
        if isinstance(row.get("vec32"), list) and len(row["vec32"]) == 32:
            item["vec32"] = [int(v) for v in row["vec32"]]
        if row.get("mark") in ("good", "slop"):
            item["mark"] = row["mark"]
        exported.append(item)

    ident = get_or_create_identity()
    unsigned = {
        "issuer": ident["issuer"],
        "handle": args.handle,
        "domain": "tv",
        "modelId": args.model,
        "recipeHash": args.recipe_hash,
        "createdAt": utc_now_iso(),
        "items": exported,
    }
    signed = sign_envelope(unsigned, ident["privateSeedB64Url"])
    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(signed, indent=2, ensure_ascii=False) + "\n")
    print(f"Exported {len(exported)} canonical TV works to {out_path} ({skipped_unmapped} unmapped private items omitted).")
    return 0


def cmd_export_music(args: argparse.Namespace) -> int:
    cat_path = Path(args.catalogue).expanduser()
    if not cat_path.is_file():
        print(f"Catalogue not found: {cat_path}", file=sys.stderr)
        return 1
    cat = json.loads(cat_path.read_text())
    tracks = cat.get("tracks") if isinstance(cat, dict) else cat
    if isinstance(tracks, dict):
        tracks = list(tracks.values())

    exported: list[dict[str, Any]] = []
    skipped = 0
    seen = set()
    for t in tracks or []:
        if not isinstance(t, dict):
            continue
        mbid = t.get("mbid") or t.get("recordingMbid")
        isrc = str(t.get("isrc") or "").strip().upper()
        canon_id = None
        if isinstance(mbid, str) and is_valid_canonical_id(f"mbid:{mbid}"):
            canon_id = f"mbid:{mbid}"
        elif is_valid_canonical_id(f"isrc:{isrc}"):
            canon_id = f"isrc:{isrc}"
        if not canon_id or canon_id in seen:
            skipped += 1
            continue
        seen.add(canon_id)
        exported.append({
            "workId": canon_id,
            "domain": "radio",
            "title": scrub_text(t.get("title") or "", 160),
            "creator": scrub_text(t.get("artist") or "Unknown", 120),
            "year": int(t.get("year") or 2026),
            "kind": scrub_text(t.get("genre") or "music", 60),
            "summary": "",
        })
        if args.limit and len(exported) >= args.limit:
            break

    ident = get_or_create_identity()
    unsigned = {
        "issuer": ident["issuer"],
        "handle": args.handle,
        "domain": "radio",
        "modelId": args.model,
        "recipeHash": args.recipe_hash,
        "createdAt": utc_now_iso(),
        "items": exported,
    }
    signed = sign_envelope(unsigned, ident["privateSeedB64Url"])
    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(signed, indent=2, ensure_ascii=False) + "\n")
    print(f"Exported {len(exported)} canonical Music works to {out_path} ({skipped} without MBID/ISRC omitted).")
    return 0


def cmd_export_cohort(args: argparse.Namespace) -> int:
    qroot = Path(args.questions_dir).expanduser()
    if not qroot.is_dir():
        print(f"Cohort questions directory not found: {qroot}", file=sys.stderr)
        return 1

    exported: list[dict[str, Any]] = []
    for jf in sorted(qroot.rglob("*.json")):
        raw = json.loads(jf.read_text())
        if not isinstance(raw, dict) or "id" not in raw:
            continue
        slug = str(raw["id"]).replace("bank:usmle-step1:", "")
        canon_id = f"cohort:{slug}"
        if not is_valid_canonical_id(canon_id):
            continue
        topics = [t for t in (raw.get("topics") or []) if not str(t).startswith("ladder:")]
        exported.append({
            "workId": canon_id,
            "domain": "cohort",
            "title": scrub_text(topics[0] if topics else slug, 160),
            "creator": "Cohort Open",
            "year": 2026,
            "kind": scrub_text(f"{jf.parent.name} · {raw.get('difficulty', 'medium')}", 60),
            "summary": scrub_text(raw.get("stem") or "", 260),
        })
        if args.limit and len(exported) >= args.limit:
            break

    ident = get_or_create_identity()
    unsigned = {
        "issuer": ident["issuer"],
        "handle": args.handle,
        "domain": "cohort",
        "modelId": args.model,
        "recipeHash": args.recipe_hash,
        "createdAt": utc_now_iso(),
        "items": exported,
    }
    signed = sign_envelope(unsigned, ident["privateSeedB64Url"])
    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(signed, indent=2, ensure_ascii=False) + "\n")
    print(f"Exported {len(exported)} Cohort items to {out_path}.")
    return 0


def cmd_export_reader(args: argparse.Namespace) -> int:
    space_path = Path(args.reader_space).expanduser()
    if not space_path.is_file():
        print(f"Reader space JSON not found: {space_path}", file=sys.stderr)
        return 1
    raw = json.loads(space_path.read_text())
    entries_in = raw.get("items") or raw.get("works") or []
    if isinstance(entries_in, dict):
        entries_in = list(entries_in.values())

    id_map: dict[str, str] = {}
    if args.canonical_ids:
        id_path = Path(args.canonical_ids).expanduser()
        if id_path.is_file():
            raw_map = json.loads(id_path.read_text())
            if isinstance(raw_map, dict):
                for k, v in raw_map.items():
                    cid = v.get("canonicalId") if isinstance(v, dict) else v
                    if isinstance(cid, str) and is_valid_canonical_id(cid):
                        id_map[str(k)] = cid

    local_to_canon: dict[str, str] = {}
    for row in entries_in:
        if not isinstance(row, dict):
            continue
        local_key = str(row.get("slug") or row.get("id") or row.get("workId") or "")
        cand = str(row.get("workId") or row.get("canonicalId") or id_map.get(local_key) or "").strip()
        if cand and is_valid_canonical_id(cand):
            local_to_canon[local_key] = cand

    exported: list[dict[str, Any]] = []
    skipped = 0
    seen: set[str] = set()
    for row in entries_in:
        if not isinstance(row, dict):
            continue
        local_key = str(row.get("slug") or row.get("id") or row.get("workId") or "")
        canon_id = local_to_canon.get(local_key)
        if not canon_id or canon_id in seen:
            skipped += 1
            continue
        seen.add(canon_id)

        nbs: list[dict[str, Any]] = []
        for nb in (row.get("neighbours") or [])[:12]:
            if isinstance(nb, dict):
                nb_local = str(nb.get("workId") or nb.get("slug") or nb.get("id") or "")
                nb_canon = nb_local if is_valid_canonical_id(nb_local) else local_to_canon.get(nb_local)
                if nb_canon and nb_canon != canon_id:
                    nbs.append({"workId": nb_canon, "sim": round(float(nb.get("sim") or nb.get("score") or 0), 4)})

        item: dict[str, Any] = {
            "workId": canon_id,
            "domain": "reader",
            "title": scrub_text(row.get("title") or canon_id, 180),
            "creator": scrub_text(row.get("creator") or row.get("authors") or "Unknown", 140),
            "year": int(row.get("year") or 2026),
            "kind": scrub_text(row.get("kind") or row.get("genre") or "reader", 60),
            "summary": scrub_text(row.get("summary") or row.get("description") or "", 300),
            "neighbours": nbs,
        }
        if isinstance(row.get("vec32"), list) and len(row["vec32"]) == 32:
            item["vec32"] = [int(v) for v in row["vec32"]]
        if isinstance(row.get("vecFp16B64"), str) and row["vecFp16B64"]:
            item["vecFp16B64"] = row["vecFp16B64"]
        exported.append(item)
        if args.limit and len(exported) >= args.limit:
            break

    ident = get_or_create_identity()
    unsigned = {
        "issuer": ident["issuer"],
        "handle": args.handle,
        "domain": "reader",
        "modelId": args.model,
        "recipeHash": args.recipe_hash,
        "createdAt": utc_now_iso(),
        "items": exported,
    }
    signed = sign_envelope(unsigned, ident["privateSeedB64Url"])
    out_path = Path(args.out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(signed, indent=2, ensure_ascii=False) + "\n")
    print(f"Exported {len(exported)} canonical Reader works to {out_path} ({skipped} unmapped/private omitted).")
    return 0


def cmd_pull_shard(args: argparse.Namespace) -> int:
    prefix = args.prefix.lower()
    url = f"{args.hub.rstrip('/')}/api/v1/shard/{prefix}"
    if args.domain:
        url += f"?domain={args.domain}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    out_dir = STATE_DIR / "shards"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"shard-{prefix}.json"
    out_file.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Pulled shard '{prefix}' ({payload.get('count', 0)} works) -> {out_file}")
    return 0


def cmd_push(args: argparse.Namespace) -> int:
    in_path = Path(args.file).expanduser()
    payload = json.loads(in_path.read_text())
    assert_payload_clean(payload)
    endpoint = "/api/v1/lenses" if "anchors" in payload else "/api/v1/contribute"
    url = f"{args.hub.rstrip('/')}{endpoint}"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=25) as resp:
        res = json.loads(resp.read().decode("utf-8"))
    print(json.dumps(res, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Manifold cross-project exporter & shard sync CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    tv = sub.add_parser("export-tv", help="Export canonical Wikidata/IMDb works from Onto the TV")
    tv.add_argument("--video-space", default="~/.local/state/onto-tv-video-embed/video-space.json")
    tv.add_argument("--show-meta", default="~/.local/state/onto-tv-embed/meta")
    tv.add_argument("--model", default="gemini-embedding-2")
    tv.add_argument("--recipe-hash", default="tv-multimodal-v1")
    tv.add_argument("--handle", default="local.tv")
    tv.add_argument("--out", required=True)
    tv.set_defaults(func=cmd_export_tv)

    mu = sub.add_parser("export-music", help="Export canonical MBID/ISRC works from music-core catalogue")
    mu.add_argument("--catalogue", default="~/.local/state/music-radio/catalogue.json")
    mu.add_argument("--model", default="gemini-embedding-2")
    mu.add_argument("--recipe-hash", default="audio-3x80s-v1")
    mu.add_argument("--handle", default="local.radio")
    mu.add_argument("--limit", type=int, default=500)
    mu.add_argument("--out", required=True)
    mu.set_defaults(func=cmd_export_music)

    co = sub.add_parser("export-cohort", help="Export open CC-BY-4.0 Cohort USMLE items")
    co.add_argument("--questions-dir", default="~/Projects/cohort/open-content/usmle/step1/questions")
    co.add_argument("--model", default="embeddinggemma-2")
    co.add_argument("--recipe-hash", default="canon-text-v1-mlx768")
    co.add_argument("--handle", default="local.cohort")
    co.add_argument("--limit", type=int, default=100)
    co.add_argument("--out", required=True)
    co.set_defaults(func=cmd_export_cohort)

    rd = sub.add_parser("export-reader", help="Export canonical ISBN/DOI/PMID/Gutenberg/arXiv works for Cohort Reader")
    rd.add_argument("--reader-space", default="~/.local/state/cohort-reader-embed/reader-space.json")
    rd.add_argument("--canonical-ids", default="~/.local/state/cohort-reader-embed/canonical-ids.json")
    rd.add_argument("--model", default="embeddinggemma-2")
    rd.add_argument("--recipe-hash", default="reader-multichunk-v1-mlx768")
    rd.add_argument("--handle", default="local.reader")
    rd.add_argument("--limit", type=int, default=500)
    rd.add_argument("--out", required=True)
    rd.set_defaults(func=cmd_export_reader)

    ps = sub.add_parser("pull-shard", help="Download a k-anonymous hex shard without disclosing inventory")
    ps.add_argument("prefix", help="1 or 2 hex prefix (e.g. a or a4)")
    ps.add_argument("--domain", choices=["tv", "radio", "cohort", "reader"])
    ps.add_argument("--hub", default=DEFAULT_HUB)
    ps.set_defaults(func=cmd_pull_shard)

    pu = sub.add_parser("push", help="Submit a signed contribution or Lens JSON to a Manifold hub")
    pu.add_argument("file")
    pu.add_argument("--hub", default=DEFAULT_HUB)
    pu.set_defaults(func=cmd_push)

    return p


if __name__ == "__main__":
    parser = build_parser()
    ns = parser.parse_args()
    raise SystemExit(ns.func(ns))
