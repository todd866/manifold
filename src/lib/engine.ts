/**
 * Manifold Hub Engine — Unified Latent Pool, Lens Ranking, Bridge Search, & Durable Store.
 *
 * Loads `canon-seed.json` at startup and layers optional durable mutations from:
 * - Local state dir (`MANIFOLD_STATE_DIR` or `~/.local/state/manifold/overlay.json` when writable)
 * - Cloudflare R2 S3-compatible bucket (`MANIFOLD_R2_ENDPOINT` + keys, optional)
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import seedData from '../data/canon-seed.json' with { type: 'json' };
import {
  scanPayloadForLeaks,
  validateCanonicalWorkId,
  type ManifoldDomain,
} from './boundary.ts';
import { verifyCanonicalSignature, workShardPrefix } from './crypto.ts';
import {
  cosineSimilarity,
  decodeFp16Vector,
  defaultContributor,
  evaluateCanaryBatch,
  type CanaryAuditResult,
  type ContributorRecord,
} from './reputation.ts';

export interface NeighbourEdge {
  workId: string;
  sim: number;
}

export interface ResonanceEdge {
  workId: string;
  domain: ManifoldDomain;
  sim: number;
}

export interface ManifoldWork {
  workId: string;
  domain: ManifoldDomain;
  title: string;
  creator: string;
  year: number;
  kind: string;
  summary: string;
  modelId: string;
  recipeHash: string;
  shard: string;
  x: number;
  y: number;
  vec32: number[];
  vec32Scale: number;
  vecFp16B64?: string;
  neighbours: NeighbourEdge[];
  resonances?: ResonanceEdge[];
  landmarks?: Record<string, number>;
  contributor: string;
  verifiedCanary?: number;
  mark?: 'good' | 'slop';
  streamUrl?: string;
  previewUrl?: string;
  artUrl?: string;
  appleMusicUrl?: string;
  shortTitle?: string;
  hook?: string;
  category?: string;
  durationSec?: number;
  energy?: number;
  heaviness?: number;
  difficulty?: string;
  ladder?: string;
  openAccessUrl?: string;
  epubUrl?: string;
  format?: 'epub' | 'pdf' | 'article';
  wordCount?: number;
  subject?: string;
  staged?: boolean;
}

export interface LensAnchor {
  workId: string;
  weight: number;
  mark?: 'good' | 'slop';
}

export interface LensTransition {
  from: string;
  to: string;
  weight: number;
}

export interface ManifoldLens {
  id: string;
  domain: ManifoldDomain;
  name: string;
  summary: string;
  issuer: string;
  issuerHandle: string;
  modelId: string;
  version: number;
  createdAt: string;
  subscribers?: number;
  completionRate?: number;
  anchors: LensAnchor[];
  blockedMarks: string[];
  transitions: LensTransition[];
  signature: string;
}

export interface ContributionItemInput {
  workId: string;
  domain: ManifoldDomain;
  title: string;
  creator: string;
  year?: number;
  kind?: string;
  summary?: string;
  vecFp16B64?: string;
  vec32?: number[];
  mark?: 'good' | 'slop';
  neighbours?: NeighbourEdge[];
}

export interface SignedContributionEnvelope {
  issuer: string;
  handle?: string;
  domain: ManifoldDomain;
  modelId: string;
  recipeHash: string;
  createdAt: string;
  items: ContributionItemInput[];
  signature: string;
}

interface OverlayState {
  works: ManifoldWork[];
  stagedWorks: ManifoldWork[];
  lenses: ManifoldLens[];
  contributors: ContributorRecord[];
}

class ManifoldHub {
  private works = new Map<string, ManifoldWork>();
  private stagedWorks = new Map<string, ManifoldWork>();
  private lenses = new Map<string, ManifoldLens>();
  private contributors = new Map<string, ContributorRecord>();
  private loadedOverlayPath: string | null = null;

  constructor() {
    this.resetToSeed();
    this.loadLocalOverlay();
  }

  public resetToSeed(): void {
    this.works.clear();
    this.stagedWorks.clear();
    this.lenses.clear();
    this.contributors.clear();

    for (const w of seedData.works as unknown as ManifoldWork[]) {
      this.works.set(w.workId, w);
    }
    for (const l of seedData.lenses as unknown as ManifoldLens[]) {
      this.lenses.set(l.id, l);
    }
    for (const c of seedData.contributors as unknown as ContributorRecord[]) {
      this.contributors.set(c.issuer, c);
    }
  }

  private resolveOverlayPath(): string | null {
    if (process.env.VERCEL) return null; // Serverless filesystem is read-only outside /tmp
    const dir =
      process.env.MANIFOLD_STATE_DIR || path.join(os.homedir(), '.local', 'state', 'manifold');
    return path.join(dir, 'hub-overlay.json');
  }

  private loadLocalOverlay(): void {
    const p = this.resolveOverlayPath();
    if (!p) return;
    this.loadedOverlayPath = p;
    try {
      if (!fs.existsSync(p)) return;
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as OverlayState;
      for (const w of raw.works || []) this.works.set(w.workId, w);
      for (const w of raw.stagedWorks || []) this.stagedWorks.set(w.workId, w);
      for (const l of raw.lenses || []) this.lenses.set(l.id, l);
      for (const c of raw.contributors || []) this.contributors.set(c.issuer, c);
    } catch {
      // Ignore corrupt/empty overlay
    }
  }

  private persistLocalOverlay(): void {
    if (!this.loadedOverlayPath) return;
    try {
      fs.mkdirSync(path.dirname(this.loadedOverlayPath), { recursive: true });
      const seedWorkIds = new Set((seedData.works as Array<{ workId: string }>).map((w) => w.workId));
      const seedLensIds = new Set((seedData.lenses as Array<{ id: string }>).map((l) => l.id));
      const overlay: OverlayState = {
        works: [...this.works.values()].filter((w) => !seedWorkIds.has(w.workId)),
        stagedWorks: [...this.stagedWorks.values()],
        lenses: [...this.lenses.values()].filter((l) => !seedLensIds.has(l.id)),
        contributors: [...this.contributors.values()],
      };
      const tmp = `${this.loadedOverlayPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(overlay, null, 2));
      fs.renameSync(tmp, this.loadedOverlayPath);
    } catch {
      // Read-only sandbox fallback
    }
  }

  public getStatus() {
    const allWorks = [...this.works.values()];
    const byDomain = {
      tv: allWorks.filter((w) => w.domain === 'tv').length,
      radio: allWorks.filter((w) => w.domain === 'radio').length,
      cohort: allWorks.filter((w) => w.domain === 'cohort').length,
      reader: allWorks.filter((w) => w.domain === 'reader').length,
    };
    const shards = new Set(allWorks.map((w) => w.shard));
    return {
      service: 'manifold',
      version: '0.1.0',
      defaultModel: seedData.defaultModel,
      supportedModels: seedData.supportedModels,
      totalWorks: allWorks.length,
      stagedWorks: this.stagedWorks.size,
      byDomain,
      activeShards: shards.size,
      totalLenses: this.lenses.size,
      lensesByDomain: {
        tv: [...this.lenses.values()].filter((l) => l.domain === 'tv').length,
        radio: [...this.lenses.values()].filter((l) => l.domain === 'radio').length,
        cohort: [...this.lenses.values()].filter((l) => l.domain === 'cohort').length,
        reader: [...this.lenses.values()].filter((l) => l.domain === 'reader').length,
      },
      verifiedContributors: [...this.contributors.values()].filter((c) => c.tier !== 'quarantined').length,
      landmarks: seedData.landmarks,
    };
  }

  public listWorks(opts?: {
    domain?: ManifoldDomain;
    query?: string;
    limit?: number;
    includeVectors?: boolean;
  }): ManifoldWork[] {
    let items = [...this.works.values()];
    if (opts?.domain) {
      items = items.filter((w) => w.domain === opts.domain);
    }
    if (opts?.query && opts.query.trim()) {
      const q = opts.query.trim().toLowerCase();
      items = items.filter(
        (w) =>
          w.workId.toLowerCase().includes(q) ||
          w.title.toLowerCase().includes(q) ||
          w.creator.toLowerCase().includes(q) ||
          w.kind.toLowerCase().includes(q) ||
          w.summary.toLowerCase().includes(q),
      );
    }
    const sliced = items.slice(0, opts?.limit ?? 200);
    if (opts?.includeVectors) return sliced;
    return sliced.map(({ vecFp16B64: _drop, ...rest }) => rest);
  }

  public getWork(workId: string, includeVectors = false): ManifoldWork | null {
    const found = this.works.get(workId) || null;
    if (!found) return null;
    if (includeVectors) return found;
    const { vecFp16B64: _drop, ...rest } = found;
    return rest;
  }

  public getShard(prefix: string, domain?: ManifoldDomain): {
    prefix: string;
    count: number;
    works: ManifoldWork[];
  } {
    const norm = prefix.toLowerCase();
    const matches = [...this.works.values()].filter(
      (w) => w.shard.startsWith(norm) && (!domain || w.domain === domain),
    );
    return { prefix: norm, count: matches.length, works: matches };
  }

  public getNeighbours(workId: string, k = 8): {
    work: ManifoldWork;
    neighbours: Array<ManifoldWork & { sim: number }>;
    resonances: Array<ManifoldWork & { sim: number }>;
  } | null {
    const base = this.works.get(workId);
    if (!base) return null;
    const neighbours = base.neighbours
      .slice(0, k)
      .map((edge) => {
        const target = this.works.get(edge.workId);
        if (!target) return null;
        const { vecFp16B64: _d, ...clean } = target;
        return { ...clean, sim: edge.sim };
      })
      .filter((x): x is ManifoldWork & { sim: number } => x !== null);

    const resonances = (base.resonances || [])
      .map((edge) => {
        const target = this.works.get(edge.workId);
        if (!target) return null;
        const { vecFp16B64: _d, ...clean } = target;
        return { ...clean, sim: edge.sim };
      })
      .filter((x): x is ManifoldWork & { sim: number } => x !== null);

    const { vecFp16B64: _drop, ...cleanBase } = base;
    return { work: cleanBase, neighbours, resonances };
  }

  /**
   * Bridge search: finds canonical works lying along the geodesic midpoint
   * between `workA` and `workB` (maximising min-balance cosine to both endpoints).
   */
  public findBridge(
    workIdA: string,
    workIdB: string,
    opts?: { domain?: ManifoldDomain; limit?: number },
  ): Array<{ work: ManifoldWork; score: number; simA: number; simB: number }> {
    const a = this.works.get(workIdA);
    const b = this.works.get(workIdB);
    if (!a || !b) return [];

    const vecA = a.vecFp16B64 ? decodeFp16Vector(a.vecFp16B64) : Float32Array.from(a.vec32);
    const vecB = b.vecFp16B64 ? decodeFp16Vector(b.vecFp16B64) : Float32Array.from(b.vec32);

    const results: Array<{ work: ManifoldWork; score: number; simA: number; simB: number }> = [];
    for (const cand of this.works.values()) {
      if (cand.workId === workIdA || cand.workId === workIdB) continue;
      if (opts?.domain && cand.domain !== opts.domain) continue;
      const useFull = Boolean(a.vecFp16B64 && b.vecFp16B64 && cand.vecFp16B64);
      const vc = useFull ? decodeFp16Vector(cand.vecFp16B64!) : Float32Array.from(cand.vec32);
      if (vc.length !== vecA.length || vc.length !== vecB.length) continue;

      const simA = cosineSimilarity(vecA, vc);
      const simB = cosineSimilarity(vecB, vc);
      // Midpoint bridge score rewards high affinity to BOTH endpoints without collapsing onto one
      const balance = Math.abs(simA - simB);
      const score = (simA + simB) * 0.5 - balance * 0.35;
      const { vecFp16B64: _d, ...clean } = cand;
      results.push({
        work: clean,
        score: Number(score.toFixed(4)),
        simA: Number(simA.toFixed(4)),
        simB: Number(simB.toFixed(4)),
      });
    }
    results.sort((x, y) => y.score - x.score);
    return results.slice(0, opts?.limit ?? 6);
  }

  public listLenses(domain?: ManifoldDomain): Array<ManifoldLens & { signatureValid: boolean }> {
    return [...this.lenses.values()]
      .filter((l) => !domain || l.domain === domain)
      .map((l) => ({
        ...l,
        signatureValid: verifyCanonicalSignature(l as unknown as Record<string, unknown>).ok,
      }));
  }

  /**
   * Ranks a caller's owned `workIds` (or the whole domain if omitted) through a signed Lens,
   * combining anchor vector pull, explicit transition boosts from `currentWorkId`, and mark gates.
   */
  public applyLens(params: {
    lensId: string;
    candidateWorkIds?: string[];
    currentWorkId?: string;
    limit?: number;
  }): {
    lens: ManifoldLens;
    ranked: Array<{ work: ManifoldWork; score: number; anchorMatch: string; transitionBoost: number }>;
  } | null {
    const lens = this.lenses.get(params.lensId);
    if (!lens) return null;

    const blocked = new Set(lens.blockedMarks || []);
    const candidates: ManifoldWork[] = params.candidateWorkIds?.length
      ? params.candidateWorkIds
          .map((id) => this.works.get(id))
          .filter((w): w is ManifoldWork => Boolean(w))
      : [...this.works.values()].filter((w) => w.domain === lens.domain);

    const anchorVecs = lens.anchors
      .map((anc) => {
        const w = this.works.get(anc.workId);
        if (!w) return null;
        return {
          workId: anc.workId,
          title: w.title,
          weight: anc.weight,
          vec: w.vecFp16B64 ? decodeFp16Vector(w.vecFp16B64) : Float32Array.from(w.vec32),
          full: Boolean(w.vecFp16B64),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const transitionMap = new Map<string, number>();
    if (params.currentWorkId) {
      for (const tr of lens.transitions || []) {
        if (tr.from === params.currentWorkId) {
          transitionMap.set(tr.to, tr.weight);
        }
      }
    }

    const ranked: Array<{
      work: ManifoldWork;
      score: number;
      anchorMatch: string;
      transitionBoost: number;
    }> = [];

    for (const cand of candidates) {
      if (cand.workId === params.currentWorkId) continue;
      if (cand.mark && blocked.has(cand.mark)) continue;

      let bestSim = -1;
      let weightedSum = 0;
      let weightTotal = 0;
      let bestAnchorTitle = lens.name;

      for (const anc of anchorVecs) {
        const vc =
          anc.full && cand.vecFp16B64
            ? decodeFp16Vector(cand.vecFp16B64)
            : Float32Array.from(cand.vec32);
        if (vc.length !== anc.vec.length) continue;
        const sim = cand.workId === anc.workId ? 1.0 : cosineSimilarity(anc.vec, vc);
        weightedSum += sim * anc.weight;
        weightTotal += anc.weight;
        if (sim > bestSim) {
          bestSim = sim;
          bestAnchorTitle = anc.title;
        }
      }

      const baseScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
      const transitionBoost = transitionMap.get(cand.workId) ? transitionMap.get(cand.workId)! * 0.25 : 0;
      const total = baseScore * 0.7 + Math.max(0, bestSim) * 0.3 + transitionBoost;
      const { vecFp16B64: _d, ...clean } = cand;
      ranked.push({
        work: clean,
        score: Number(total.toFixed(4)),
        anchorMatch: bestAnchorTitle,
        transitionBoost: Number(transitionBoost.toFixed(4)),
      });
    }

    ranked.sort((a, b) => b.score - a.score);
    return { lens, ranked: ranked.slice(0, params.limit ?? 16) };
  }

  public publishLens(lens: ManifoldLens): { ok: boolean; reason?: string; lens?: ManifoldLens } {
    const leak = scanPayloadForLeaks(lens);
    if (!leak.ok) return { ok: false, reason: leak.reason };
    for (const a of lens.anchors || []) {
      const v = validateCanonicalWorkId(a.workId, lens.domain);
      if (!v.ok) return { ok: false, reason: v.reason };
    }
    const sigCheck = verifyCanonicalSignature(lens as unknown as Record<string, unknown>);
    if (!sigCheck.ok) return { ok: false, reason: sigCheck.reason };

    this.lenses.set(lens.id, lens);
    this.persistLocalOverlay();
    return { ok: true, lens };
  }

  public submitContribution(envelope: SignedContributionEnvelope): {
    ok: boolean;
    reason?: string;
    audit?: CanaryAuditResult;
  } {
    const leak = scanPayloadForLeaks(envelope);
    if (!leak.ok) return { ok: false, reason: leak.reason };

    if (!Array.isArray(envelope.items) || envelope.items.length === 0) {
      return { ok: false, reason: 'contribution batch must contain at least one item' };
    }
    for (const item of envelope.items) {
      const idCheck = validateCanonicalWorkId(item.workId, envelope.domain);
      if (!idCheck.ok) return { ok: false, reason: idCheck.reason };
    }

    const sigCheck = verifyCanonicalSignature(envelope as unknown as Record<string, unknown>);
    if (!sigCheck.ok) return { ok: false, reason: sigCheck.reason };

    const existingContributor =
      this.contributors.get(envelope.issuer) ||
      defaultContributor(envelope.issuer, envelope.handle);

    // Measure canary overlap against canonical items under the same (modelId, recipeHash)
    const overlapCosines: number[] = [];
    const novelItems: ContributionItemInput[] = [];

    for (const item of envelope.items) {
      const existing = this.works.get(item.workId);
      if (
        existing &&
        existing.modelId === envelope.modelId &&
        existing.recipeHash === envelope.recipeHash
      ) {
        if (item.vecFp16B64 && existing.vecFp16B64) {
          const vIn = decodeFp16Vector(item.vecFp16B64);
          const vCanon = decodeFp16Vector(existing.vecFp16B64);
          overlapCosines.push(cosineSimilarity(vIn, vCanon));
        } else if (item.vec32 && existing.vec32) {
          overlapCosines.push(cosineSimilarity(item.vec32, existing.vec32));
        }
      } else {
        novelItems.push(item);
      }
    }

    const audit = evaluateCanaryBatch({
      contributor: existingContributor,
      domain: envelope.domain,
      overlapCosines,
      novelCount: novelItems.length,
    });
    this.contributors.set(envelope.issuer, audit.updatedContributor);

    if (!audit.accepted) {
      this.persistLocalOverlay();
      return { ok: false, reason: audit.reason, audit };
    }

    for (const item of novelItems) {
      const vec32 =
        item.vec32 && item.vec32.length === 32 ? item.vec32 : new Array<number>(32).fill(0);
      const record: ManifoldWork = {
        workId: item.workId,
        domain: envelope.domain,
        title: item.title.slice(0, 180),
        creator: (item.creator || 'Unknown').slice(0, 140),
        year: item.year || new Date().getUTCFullYear(),
        kind: (item.kind || envelope.domain).slice(0, 80),
        summary: (item.summary || '').slice(0, 500),
        modelId: envelope.modelId,
        recipeHash: envelope.recipeHash,
        shard: workShardPrefix(item.workId),
        x: Number(((vec32[0] || 0) / 145).toFixed(4)),
        y: Number(((vec32[1] || 0) / 145).toFixed(4)),
        vec32,
        vec32Scale: 0.01,
        vecFp16B64: item.vecFp16B64,
        neighbours: item.neighbours || [],
        contributor: envelope.issuer,
        verifiedCanary: audit.meanOverlapCosine ?? undefined,
        mark: item.mark,
        staged: audit.status === 'accepted_staged',
      };
      if (audit.status === 'accepted_canonical') {
        this.works.set(record.workId, record);
      } else {
        this.stagedWorks.set(record.workId, record);
      }
    }

    this.persistLocalOverlay();
    return { ok: true, reason: audit.reason, audit };
  }

  public listContributors(): ContributorRecord[] {
    return [...this.contributors.values()].sort((a, b) => b.credits - a.credits);
  }

  public getContributor(issuer: string): ContributorRecord | null {
    return this.contributors.get(issuer) || null;
  }
}

const globalForManifold = globalThis as unknown as { __manifoldHub?: ManifoldHub };
export function getManifoldHub(): ManifoldHub {
  if (!globalForManifold.__manifoldHub) {
    globalForManifold.__manifoldHub = new ManifoldHub();
  }
  return globalForManifold.__manifoldHub;
}

export function createIsolatedManifoldHub(): ManifoldHub {
  return new ManifoldHub();
}
