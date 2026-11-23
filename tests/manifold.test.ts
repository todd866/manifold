import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { scanPayloadForLeaks, validateCanonicalWorkId } from '../src/lib/boundary.ts';
import {
  generateEd25519Identity,
  signCanonicalPayload,
  verifyCanonicalSignature,
} from '../src/lib/crypto.ts';
import { createIsolatedManifoldHub, type ManifoldLens, type SignedContributionEnvelope } from '../src/lib/engine.ts';
import { handleMcpRequest } from '../src/lib/mcp.ts';

// Isolate overlay state to a temp dir during unit tests
const tmpState = fs.mkdtempSync(path.join(os.tmpdir(), 'manifold-test-'));
process.env.MANIFOLD_STATE_DIR = tmpState;

test('boundary gate accepts valid canonical IDs and rejects local paths, extensions, magnets, and hashes', () => {
  assert.equal(validateCanonicalWorkId('wikidata:Q752509', 'tv').ok, true);
  assert.equal(validateCanonicalWorkId('mbid:1b642322-7c90-4a8e-9b52-33f672941a64', 'radio').ok, true);
  assert.equal(validateCanonicalWorkId('cohort:cardiovascular-abo-preformed-antibodies:v1', 'cohort').ok, true);

  // Domain mismatch
  assert.equal(validateCanonicalWorkId('mbid:1b642322-7c90-4a8e-9b52-33f672941a64', 'tv').ok, false);

  // Forbidden local paths, media extensions, transfer URIs, and raw SHA-256
  assert.equal(validateCanonicalWorkId('/Users/example/Movies/Sintel.mkv').ok, false);
  assert.equal(validateCanonicalWorkId('ia:Sintel.mp4').ok, false);
  assert.equal(
    validateCanonicalWorkId('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855').ok,
    false,
  );
  assert.equal(validateCanonicalWorkId('magnet:?xt=urn:sha1:0123456789abcdef0123456789abcdef01234567').ok, false);

  const leak1 = scanPayloadForLeaks({
    title: 'Clean',
    nested: { note: 'copied from /Volumes/MediaDisk/Music/song.flac' },
  });
  assert.equal(leak1.ok, false);

  const leak2 = scanPayloadForLeaks({
    workId: 'wikidata:Q752509',
    household: 'Robin',
  });
  assert.equal(leak2.ok, false);
});

test('Ed25519 seed lenses verify cleanly and detect tampering', () => {
  const hub = createIsolatedManifoldHub();
  const lenses = hub.listLenses();
  assert.ok(lenses.length >= 8);
  for (const lens of lenses) {
    assert.equal(lens.signatureValid, true, `Lens ${lens.id} should have valid Ed25519 signature`);
  }

  const tampered = { ...lenses[0], summary: 'Tampered summary' };
  assert.equal(verifyCanonicalSignature(tampered as unknown as Record<string, unknown>).ok, false);
});

test('canary overlap verification promotes honest batches and quarantines spoofed vectors', () => {
  const hub = createIsolatedManifoldHub();
  const sintel = hub.getWork('wikidata:Q752509', true);
  const metropolis = hub.getWork('wikidata:Q151599', true);
  assert.ok(sintel && sintel.vecFp16B64);
  assert.ok(metropolis && metropolis.vecFp16B64);

  // 1. Honest contributor submits exact canary matches + 1 new public-domain work
  const honestActor = generateEd25519Identity('test-honest-peer');
  const unsignedHonest: Omit<SignedContributionEnvelope, 'signature'> = {
    issuer: honestActor.issuer,
    handle: 'honest.peer',
    domain: 'tv',
    modelId: sintel.modelId,
    recipeHash: sintel.recipeHash,
    createdAt: '2026-11-23T03:00:00Z',
    items: [
      {
        workId: sintel.workId,
        domain: 'tv',
        title: sintel.title,
        creator: sintel.creator,
        vecFp16B64: sintel.vecFp16B64,
        vec32: sintel.vec32,
      },
      {
        workId: metropolis.workId,
        domain: 'tv',
        title: metropolis.title,
        creator: metropolis.creator,
        vecFp16B64: metropolis.vecFp16B64,
        vec32: metropolis.vec32,
      },
      {
        workId: 'wikidata:Q237819',
        domain: 'tv',
        title: 'Sunrise: A Song of Two Humans',
        creator: 'F. W. Murnau',
        year: 1927,
        kind: 'silent · drama',
        summary: 'Poetic silent romance across lake and tramway.',
        vec32: metropolis.vec32,
      },
    ],
  };
  const honestSig = signCanonicalPayload(
    unsignedHonest as unknown as Record<string, unknown>,
    honestActor.privateSeedB64Url,
  );
  const honestRes = hub.submitContribution({ ...unsignedHonest, signature: honestSig });
  assert.equal(honestRes.ok, true);
  assert.equal(honestRes.audit?.status, 'accepted_canonical');
  assert.ok((honestRes.audit?.meanOverlapCosine ?? 0) > 0.999);
  assert.ok(hub.getWork('wikidata:Q237819'));

  // 2. Spoofing contributor submits inverted/corrupted canary vector -> rejected & penalized
  const spoofActor = generateEd25519Identity('test-spoof-peer');
  const invertedVec32 = sintel.vec32.map((v) => -v);
  const unsignedSpoof: Omit<SignedContributionEnvelope, 'signature'> = {
    issuer: spoofActor.issuer,
    handle: 'spoof.peer',
    domain: 'tv',
    modelId: sintel.modelId,
    recipeHash: sintel.recipeHash,
    createdAt: '2026-11-23T03:05:00Z',
    items: [
      {
        workId: sintel.workId,
        domain: 'tv',
        title: sintel.title,
        creator: sintel.creator,
        vec32: invertedVec32,
      },
      {
        workId: 'wikidata:Q19355',
        domain: 'tv',
        title: 'Battleship Potemkin',
        creator: 'Sergei Eisenstein',
        vec32: invertedVec32,
      },
    ],
  };
  const spoofSig = signCanonicalPayload(
    unsignedSpoof as unknown as Record<string, unknown>,
    spoofActor.privateSeedB64Url,
  );
  const spoofRes = hub.submitContribution({ ...unsignedSpoof, signature: spoofSig });
  assert.equal(spoofRes.ok, false);
  assert.equal(spoofRes.audit?.status, 'quarantined_spoof');
  assert.equal(hub.getWork('wikidata:Q19355'), null);
});

test('Lens ranking filters slop marks and MCP JSON-RPC 2.0 tools execute end-to-end', () => {
  const hub = createIsolatedManifoldHub();
  const ranked = hub.applyLens({ lensId: 'lens:tv:night-flight', limit: 25 });
  assert.ok(ranked);
  assert.ok(ranked.ranked.length > 0);
  // Plan 9 from Outer Space (wikidata:Q776670) is marked 'slop' and must be excluded by blockedMarks
  assert.equal(
    ranked.ranked.some((r) => r.work.workId === 'wikidata:Q776670'),
    false,
  );

  // MCP initialize + tools/list + tools/call
  const initRes = handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.ok(initRes && !initRes.error);

  const listRes = handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = (listRes?.result as { tools: Array<{ name: string }> }).tools;
  assert.equal(tools.length, 8);

  const bridgeCall = handleMcpRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'manifold_bridge',
      arguments: {
        workIdA: 'wikidata:Q207626',
        workIdB: 'wikidata:Q151599',
        domain: 'tv',
        limit: 3,
      },
    },
  });
  assert.ok(bridgeCall && !bridgeCall.error);
  const parsed = JSON.parse(
    (bridgeCall.result as { content: Array<{ text: string }> }).content[0].text,
  );
  assert.equal(parsed.length, 3);

  // Publish a fresh signed Cohort lens via MCP
  const eduActor = generateEd25519Identity('test-cohort-author');
  const cohortWork = hub.listWorks({ domain: 'cohort', limit: 2 })[0];
  const unsignedLens: Omit<ManifoldLens, 'signature'> = {
    id: 'lens:cohort:test-cardio-focus',
    domain: 'cohort',
    name: 'Cardio rapid ladder',
    summary: 'Focused cardiology Step 1 concept check',
    issuer: eduActor.issuer,
    issuerHandle: 'edu.author',
    modelId: 'embeddinggemma-2',
    version: 1,
    createdAt: '2026-11-23T03:10:00Z',
    anchors: [{ workId: cohortWork.workId, weight: 1.0, mark: 'good' }],
    blockedMarks: [],
    transitions: [],
  };
  const sig = signCanonicalPayload(
    unsignedLens as unknown as Record<string, unknown>,
    eduActor.privateSeedB64Url,
  );
  const pubRes = handleMcpRequest({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'manifold_contribute',
      arguments: { kind: 'lens', payload: { ...unsignedLens, signature: sig } },
    },
  });
  const pubData = JSON.parse(
    (pubRes?.result as { content: Array<{ text: string }> }).content[0].text,
  );
  assert.equal(pubData.ok, true);
});
