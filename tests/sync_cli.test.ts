import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { verifyCanonicalSignature } from '../src/lib/crypto.ts';
import { createIsolatedManifoldHub } from '../src/lib/engine.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

test('manifold_sync.py exports TV, Music, and Cohort maps while stripping local paths/hashes', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifold-sync-'));
  const stateDir = path.join(workDir, 'state');

  // Dirty TV input containing private paths, .mkv filenames, and unmapped private shows
  const dirtyTvSpace = path.join(workDir, 'video-space.json');
  const metaDir = path.join(workDir, 'meta');
  fs.mkdirSync(metaDir, { recursive: true });
  fs.writeFileSync(
    path.join(metaDir, 'Sintel.json'),
    JSON.stringify({ title: 'Sintel', wikidataId: 'Q752509' }),
  );
  fs.writeFileSync(
    dirtyTvSpace,
    JSON.stringify({
      items: [
        {
          id: '/Volumes/MediaDisk/Movies/Sintel.mkv',
          title: 'Sintel.mkv',
          creator: 'Colin Levy',
          year: 2010,
          mark: 'good',
          summary: 'Stored at /Users/example/Movies/Sintel.mkv',
          vec32: new Array(32).fill(5),
        },
        {
          id: '/Volumes/MediaDisk/Private/HomeVideo.mp4',
          title: 'Family Beach Day.mp4',
          year: 2025,
        },
      ],
    }),
  );

  const outTv = path.join(workDir, 'tv-export.json');
  execFileSync(
    'python3',
    [
      path.join(ROOT, 'tools/manifold_sync.py'),
      'export-tv',
      '--video-space',
      dirtyTvSpace,
      '--show-meta',
      metaDir,
      '--out',
      outTv,
    ],
    { env: { ...process.env, MANIFOLD_STATE_DIR: stateDir } },
  );

  const tvRaw = fs.readFileSync(outTv, 'utf8');
  assert.equal(tvRaw.includes('/Volumes/'), false);
  assert.equal(tvRaw.includes('/Users/'), false);
  assert.equal(tvRaw.includes('.mkv'), false);
  assert.equal(tvRaw.includes('Family Beach Day'), false);

  const tvSigned = JSON.parse(tvRaw);
  assert.equal(tvSigned.items.length, 1);
  assert.equal(tvSigned.items[0].workId, 'wikidata:Q752509');
  assert.equal(verifyCanonicalSignature(tvSigned).ok, true);

  // Feed exported TV envelope into ManifoldHub
  const hub = createIsolatedManifoldHub();
  const submitRes = hub.submitContribution(tvSigned);
  assert.equal(submitRes.ok, true);

  // Cohort open export check
  const outCohort = path.join(workDir, 'cohort-export.json');
  execFileSync(
    'python3',
    [
      path.join(ROOT, 'tools/manifold_sync.py'),
      'export-cohort',
      '--limit',
      '5',
      '--out',
      outCohort,
    ],
    { env: { ...process.env, MANIFOLD_STATE_DIR: stateDir } },
  );
  const cohortSigned = JSON.parse(fs.readFileSync(outCohort, 'utf8'));
  assert.equal(cohortSigned.items.length, 5);
  assert.equal(verifyCanonicalSignature(cohortSigned).ok, true);

  // Reader export check: strips local paths, .epub/.pdf filenames, and md5-* private slugs
  const dirtyReaderSpace = path.join(workDir, 'reader-space.json');
  fs.writeFileSync(
    dirtyReaderSpace,
    JSON.stringify({
      items: [
        {
          slug: 'md5-e1d635903602a30a478696e341002808',
          workId: 'isbn:9780754615903',
          title: 'Managing Maintenance Error.pdf',
          creator: 'James T. Reason',
          year: 2003,
          kind: 'book · safety',
          summary: 'From /Users/example/PaperLibrary/books/error.pdf',
          vec32: new Array(32).fill(7),
          neighbours: [
            { slug: 'md5-private-only', sim: 0.9 },
            { workId: 'doi:10.1038/nrn2787', sim: 0.81 },
          ],
        },
        {
          slug: 'md5-private-only',
          title: 'Private Draft.epub',
          summary: '/Volumes/Private/Draft.epub',
        },
      ],
    }),
  );
  const outReader = path.join(workDir, 'reader-export.json');
  execFileSync(
    'python3',
    [
      path.join(ROOT, 'tools/manifold_sync.py'),
      'export-reader',
      '--reader-space',
      dirtyReaderSpace,
      '--out',
      outReader,
    ],
    { env: { ...process.env, MANIFOLD_STATE_DIR: stateDir } },
  );
  const readerRaw = fs.readFileSync(outReader, 'utf8');
  assert.equal(readerRaw.includes('/Users/'), false);
  assert.equal(readerRaw.includes('/Volumes/'), false);
  assert.equal(readerRaw.includes('.pdf'), false);
  assert.equal(readerRaw.includes('.epub'), false);
  assert.equal(readerRaw.includes('md5-private-only'), false);
  const readerSigned = JSON.parse(readerRaw);
  assert.equal(readerSigned.items.length, 1);
  assert.equal(readerSigned.items[0].workId, 'isbn:9780754615903');
  assert.equal(readerSigned.items[0].neighbours.length, 1);
  assert.equal(verifyCanonicalSignature(readerSigned).ok, true);
});

test('stdio MCP servers for Manifold, Onto the TV, Onto the Radio, Cohort, and Cohort Reader respond cleanly', () => {
  for (const script of [
    'bin/manifold-mcp.ts',
    'bin/onto-tv-mcp.ts',
    'bin/onto-radio-mcp.ts',
    'bin/cohort-mcp.ts',
    'bin/cohort-reader-mcp.ts',
  ]) {
    const input =
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) +
      '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) +
      '\n';
    const stdout = execFileSync(
      'node',
      ['--experimental-strip-types', path.join(ROOT, script)],
      { input, encoding: 'utf8', timeout: 8000 },
    );
    const lines = stdout.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2, `${script} should emit 2 JSON-RPC responses`);
    assert.ok(lines[0].result.serverInfo.name);
    assert.ok(lines[1].result.tools.length >= 2);
  }
});
