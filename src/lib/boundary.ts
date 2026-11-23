/**
 * Fail-closed privacy & copyright boundary gate for Manifold.
 *
 * Enforces the rule from onto-the-tv/docs/TODO.md & SPEC.md:
 * - Keyed strictly to canonical public work/concept IDs.
 * - Rejects filesystem paths, media filenames, raw SHA-1/SHA-256 file hashes,
 *   peer-transfer URIs, and household viewer identifiers.
 */

export type ManifoldDomain = 'tv' | 'radio' | 'cohort';

const CANONICAL_ID_PATTERNS: ReadonlyArray<{ domain: ManifoldDomain | 'any'; re: RegExp }> = [
  { domain: 'any', re: /^wikidata:Q[1-9][0-9]{0,12}$/ },
  { domain: 'tv', re: /^ia:[A-Za-z0-9._-]{2,120}$/ },
  { domain: 'tv', re: /^imdb:tt[0-9]{7,10}$/ },
  { domain: 'tv', re: /^yt:[A-Za-z0-9_-]{11}$/ },
  { domain: 'tv', re: /^ytc:UC[A-Za-z0-9_-]{20,28}$/ },
  { domain: 'radio', re: /^mbid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { domain: 'radio', re: /^isrc:[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/ },
  { domain: 'cohort', re: /^cohort:[a-z0-9][a-z0-9:._-]{2,160}$/i },
  { domain: 'cohort', re: /^doi:10\.[0-9]{4,9}\/[-._;()/:A-Za-z0-9]+$/ },
  { domain: 'cohort', re: /^pmid:[1-9][0-9]{0,10}$/ },
];

const FORBIDDEN_PATH_RE =
  /(?:^|[\s"'`])(?:\/Users\/|\/Volumes\/|\/home\/|\/private\/|[A-Za-z]:\\|\.\.\/|~\/)/i;
const FORBIDDEN_EXT_RE =
  /\.(?:mp4|m4v|mkv|avi|mov|ts|m2ts|webm|flac|m4a|mp3|wav|ogg|aac|alac|srt|vtt|nsp|xci)\b/i;
const FORBIDDEN_URI_RE = /\bmagnet:\?xt=urn:/i;
const BARE_HEX_HASH_RE = /^(?:sha256:|sha1:)?[0-9a-f]{40}(?:[0-9a-f]{24})?$/i;

export interface BoundaryVerdict {
  ok: boolean;
  reason?: string;
}

export function validateCanonicalWorkId(workId: string, expectedDomain?: ManifoldDomain): BoundaryVerdict {
  if (typeof workId !== 'string' || workId.length < 5 || workId.length > 200) {
    return { ok: false, reason: 'workId must be a non-empty canonical identifier' };
  }
  if (BARE_HEX_HASH_RE.test(workId) || FORBIDDEN_URI_RE.test(workId)) {
    return { ok: false, reason: 'raw file hashes and transfer URIs are forbidden in Manifold' };
  }
  if (FORBIDDEN_PATH_RE.test(workId) || FORBIDDEN_EXT_RE.test(workId)) {
    return { ok: false, reason: 'local paths and media filenames are forbidden in Manifold' };
  }
  const matched = CANONICAL_ID_PATTERNS.find((p) => p.re.test(workId));
  if (!matched) {
    return {
      ok: false,
      reason: `unrecognised canonical ID namespace in '${workId}' (expected wikidata:, mbid:, isrc:, ia:, imdb:, yt:, cohort:, doi:, or pmid:)`,
    };
  }
  if (expectedDomain && matched.domain !== 'any' && matched.domain !== expectedDomain) {
    return {
      ok: false,
      reason: `identifier '${workId}' belongs to '${matched.domain}', expected '${expectedDomain}'`,
    };
  }
  return { ok: true };
}

export function scanPayloadForLeaks(value: unknown, keyPath = 'root'): BoundaryVerdict {
  if (value === null || value === undefined) return { ok: true };
  if (typeof value === 'string') {
    // Allow explicit HTTPS media/artwork catalog URLs, while still blocking local paths & magnets
    const isHttpsUrl =
      (keyPath.endsWith('.streamUrl') ||
        keyPath.endsWith('.previewUrl') ||
        keyPath.endsWith('.artUrl') ||
        keyPath.endsWith('.appleMusicUrl')) &&
      /^https:\/\/[a-z0-9.-]+\//i.test(value);
    if (FORBIDDEN_PATH_RE.test(value)) {
      return { ok: false, reason: `local filesystem path detected at ${keyPath}` };
    }
    if (FORBIDDEN_URI_RE.test(value)) {
      return { ok: false, reason: `transfer URI detected at ${keyPath}` };
    }
    if (!isHttpsUrl && FORBIDDEN_EXT_RE.test(value)) {
      return { ok: false, reason: `media filename extension detected at ${keyPath}` };
    }
    if (!keyPath.endsWith('.recipeHash') && BARE_HEX_HASH_RE.test(value.trim())) {
      return { ok: false, reason: `raw file hash detected at ${keyPath}` };
    }
    return { ok: true };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const sub = scanPayloadForLeaks(value[i], `${keyPath}[${i}]`);
      if (!sub.ok) return sub;
    }
    return { ok: true };
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (/^(filePath|relativePath|localPath|sha256|infohash|household|viewerName)$/i.test(k)) {
        return { ok: false, reason: `forbidden private field '${k}' at ${keyPath}` };
      }
      const sub = scanPayloadForLeaks(v, `${keyPath}.${k}`);
      if (!sub.ok) return sub;
    }
  }
  return { ok: true };
}
