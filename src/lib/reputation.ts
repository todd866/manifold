/**
 * Canary-Overlap Verification & Beta-Binomial Reputation Engine.
 *
 * Follows trustlist's core principle:
 *   "Trust is a cheap prior that narrows what you look at; a separate
 *    verification step (canary overlap cosine) decides what enters the pool."
 */
import type { ManifoldDomain } from './boundary.ts';

export type ReputationTier = 'quarantined' | 'provisional' | 'trusted' | 'steward';

export interface ContributorRecord {
  issuer: string;
  handle: string;
  tier: ReputationTier;
  alpha: number;
  beta: number;
  trust: number;
  verifiedVectors: number;
  quarantinedBatches: number;
  meanCanaryCosine: number;
  credits: number;
  domains: ManifoldDomain[];
  updatedAt: string;
}

export interface CanaryAuditResult {
  accepted: boolean;
  status: 'accepted_canonical' | 'accepted_staged' | 'quarantined_spoof';
  overlapCount: number;
  novelCount: number;
  meanOverlapCosine: number | null;
  minOverlapCosine: number | null;
  creditsAwarded: number;
  updatedContributor: ContributorRecord;
  reason: string;
}

export const CANARY_MIN_MEAN_COSINE = 0.98;
export const CANARY_HARD_FAIL_COSINE = 0.92;

export function decodeFp16Vector(b64: string): Float32Array {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length % 2 !== 0) {
    throw new Error('Invalid float16 buffer byte length');
  }
  const n = buf.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = buf.readUInt16LE(i * 2);
    const s = (h & 0x8000) >> 15;
    const e = (h & 0x7c00) >> 10;
    const f = h & 0x03ff;
    let val: number;
    if (e === 0) {
      val = (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
    } else if (e === 0x1f) {
      val = f ? NaN : (s ? -Infinity : Infinity);
    } else {
      val = (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
    }
    out[i] = val;
  }
  return out;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

export function tierForStats(alpha: number, beta: number, quarantinedBatches: number): ReputationTier {
  const trust = alpha / (alpha + beta);
  if (quarantinedBatches >= 2 || trust < 0.45) return 'quarantined';
  if (alpha >= 80 && trust >= 0.95) return 'steward';
  if (alpha >= 15 && trust >= 0.82) return 'trusted';
  return 'provisional';
}

export function defaultContributor(issuer: string, handle?: string, nowIso?: string): ContributorRecord {
  const alpha = 3;
  const beta = 2;
  return {
    issuer,
    handle: handle || issuer.slice(0, 18),
    tier: 'provisional',
    alpha,
    beta,
    trust: Number((alpha / (alpha + beta)).toFixed(4)),
    verifiedVectors: 0,
    quarantinedBatches: 0,
    meanCanaryCosine: 0,
    credits: 10,
    domains: [],
    updatedAt: nowIso || new Date().toISOString(),
  };
}

export function evaluateCanaryBatch(params: {
  contributor: ContributorRecord;
  domain: ManifoldDomain;
  overlapCosines: number[];
  novelCount: number;
  nowIso?: string;
}): CanaryAuditResult {
  const { contributor, domain, overlapCosines, novelCount } = params;
  const nowIso = params.nowIso || new Date().toISOString();
  const next: ContributorRecord = {
    ...contributor,
    domains: contributor.domains.includes(domain)
      ? [...contributor.domains]
      : [...contributor.domains, domain],
    updatedAt: nowIso,
  };

  if (contributor.tier === 'quarantined') {
    return {
      accepted: false,
      status: 'quarantined_spoof',
      overlapCount: overlapCosines.length,
      novelCount,
      meanOverlapCosine: null,
      minOverlapCosine: null,
      creditsAwarded: 0,
      updatedContributor: next,
      reason: 'contributor key is quarantined due to prior failed canary checks',
    };
  }

  if (overlapCosines.length > 0) {
    const sum = overlapCosines.reduce((acc, v) => acc + v, 0);
    const mean = sum / overlapCosines.length;
    const min = Math.min(...overlapCosines);

    if (mean < CANARY_HARD_FAIL_COSINE || min < 0.85) {
      next.beta = Number((next.beta + Math.max(6, overlapCosines.length * 4)).toFixed(2));
      next.quarantinedBatches += 1;
      next.trust = Number((next.alpha / (next.alpha + next.beta)).toFixed(4));
      next.tier = tierForStats(next.alpha, next.beta, next.quarantinedBatches);
      return {
        accepted: false,
        status: 'quarantined_spoof',
        overlapCount: overlapCosines.length,
        novelCount,
        meanOverlapCosine: Number(mean.toFixed(4)),
        minOverlapCosine: Number(min.toFixed(4)),
        creditsAwarded: 0,
        updatedContributor: next,
        reason: `canary overlap cosine ${mean.toFixed(3)} (min ${min.toFixed(3)}) below threshold ${CANARY_MIN_MEAN_COSINE}; batch quarantined`,
      };
    }

    if (mean < CANARY_MIN_MEAN_COSINE) {
      next.beta = Number((next.beta + 1.5).toFixed(2));
      next.trust = Number((next.alpha / (next.alpha + next.beta)).toFixed(4));
      next.tier = tierForStats(next.alpha, next.beta, next.quarantinedBatches);
      return {
        accepted: false,
        status: 'quarantined_spoof',
        overlapCount: overlapCosines.length,
        novelCount,
        meanOverlapCosine: Number(mean.toFixed(4)),
        minOverlapCosine: Number(min.toFixed(4)),
        creditsAwarded: 0,
        updatedContributor: next,
        reason: `canary overlap cosine ${mean.toFixed(3)} below strict canonical gate ${CANARY_MIN_MEAN_COSINE}; verify clip recipe`,
      };
    }

    // Clean canary match!
    const prevWeight = Math.max(1, next.verifiedVectors);
    next.meanCanaryCosine =
      next.meanCanaryCosine > 0
        ? Number(((next.meanCanaryCosine * prevWeight + mean * overlapCosines.length) / (prevWeight + overlapCosines.length)).toFixed(4))
        : Number(mean.toFixed(4));
    const gain = overlapCosines.length * 1.5 + novelCount * 1.0;
    next.alpha = Number((next.alpha + gain).toFixed(2));
    next.verifiedVectors += novelCount;
    const credits = novelCount * 5 + overlapCosines.length * 2;
    next.credits += credits;
    next.trust = Number((next.alpha / (next.alpha + next.beta)).toFixed(4));
    next.tier = tierForStats(next.alpha, next.beta, next.quarantinedBatches);

    const promoteDirect = next.tier === 'trusted' || next.tier === 'steward' || overlapCosines.length >= 2;
    return {
      accepted: true,
      status: promoteDirect ? 'accepted_canonical' : 'accepted_staged',
      overlapCount: overlapCosines.length,
      novelCount,
      meanOverlapCosine: Number(mean.toFixed(4)),
      minOverlapCosine: Number(min.toFixed(4)),
      creditsAwarded: credits,
      updatedContributor: next,
      reason: promoteDirect
        ? `verified ${overlapCosines.length} canary overlaps (cosine ${mean.toFixed(4)}); promoted ${novelCount} works`
        : `verified canary overlap; staged ${novelCount} works pending second-peer corroboration`,
    };
  }

  // Zero overlap items in batch: only stewards/trusted can promote directly; provisional stages
  if (next.tier === 'steward' || next.tier === 'trusted') {
    next.alpha = Number((next.alpha + novelCount * 0.5).toFixed(2));
    next.verifiedVectors += novelCount;
    const credits = novelCount * 3;
    next.credits += credits;
    next.trust = Number((next.alpha / (next.alpha + next.beta)).toFixed(4));
    return {
      accepted: true,
      status: 'accepted_canonical',
      overlapCount: 0,
      novelCount,
      meanOverlapCosine: null,
      minOverlapCosine: null,
      creditsAwarded: credits,
      updatedContributor: next,
      reason: `trusted contributor; promoted ${novelCount} tail works`,
    };
  }

  return {
    accepted: true,
    status: 'accepted_staged',
    overlapCount: 0,
    novelCount,
    meanOverlapCosine: null,
    minOverlapCosine: null,
    creditsAwarded: novelCount,
    updatedContributor: { ...next, credits: next.credits + novelCount },
    reason: `no overlap canaries in batch; staged ${novelCount} works until corroborated`,
  };
}
