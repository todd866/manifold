/**
 * Deterministic canonical JSON & Ed25519 signature primitives (stdlib node:crypto).
 * Compatible with Manifold issuer identities (`ed25519:<base64url-32byte-pubkey>`).
 */
import * as crypto from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') +
    '}'
  );
}

export function generateEd25519Identity(seedPhrase?: string): {
  issuer: string;
  privateSeedB64Url: string;
} {
  const seed = seedPhrase
    ? crypto.createHash('sha256').update(seedPhrase, 'utf8').digest()
    : crypto.randomBytes(32);
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = crypto.createPublicKey(privKey).export({ format: 'der', type: 'spki' }) as Buffer;
  const rawPub = spki.subarray(-32);
  return {
    issuer: `ed25519:${rawPub.toString('base64url')}`,
    privateSeedB64Url: seed.toString('base64url'),
  };
}

export function signCanonicalPayload(
  unsignedObj: Record<string, unknown>,
  privateSeedB64Url: string,
): string {
  const seed = Buffer.from(privateSeedB64Url, 'base64url');
  if (seed.length !== 32) {
    throw new Error('Ed25519 private seed must decode to 32 bytes');
  }
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const payload = Buffer.from(canonicalJson(unsignedObj), 'utf8');
  return crypto.sign(null, payload, privKey).toString('base64url');
}

export function verifyCanonicalSignature(
  signedObj: Record<string, unknown>,
  issuerField = 'issuer',
  signatureField = 'signature',
): { ok: boolean; reason?: string } {
  const issuer = signedObj[issuerField];
  const signature = signedObj[signatureField];
  if (typeof issuer !== 'string' || !issuer.startsWith('ed25519:')) {
    return { ok: false, reason: 'missing or malformed ed25519:<pubkey> issuer' };
  }
  if (typeof signature !== 'string' || signature.length < 40) {
    return { ok: false, reason: 'missing Ed25519 signature' };
  }
  try {
    const rawPub = Buffer.from(issuer.slice('ed25519:'.length), 'base64url');
    if (rawPub.length !== 32) {
      return { ok: false, reason: 'Ed25519 public key must be 32 bytes' };
    }
    const pubKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawPub]),
      format: 'der',
      type: 'spki',
    });
    const unsignedCopy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(signedObj)) {
      if (k !== signatureField) unsignedCopy[k] = v;
    }
    const payload = Buffer.from(canonicalJson(unsignedCopy), 'utf8');
    const sigBytes = Buffer.from(signature, 'base64url');
    if (sigBytes.length !== 64) {
      return { ok: false, reason: 'Ed25519 signature must be 64 bytes' };
    }
    const valid = crypto.verify(null, payload, pubKey, sigBytes);
    return valid ? { ok: true } : { ok: false, reason: 'Ed25519 signature verification failed' };
  } catch (err) {
    return { ok: false, reason: `signature error: ${(err as Error).message}` };
  }
}

export function workShardPrefix(workId: string): string {
  return crypto.createHash('sha256').update(workId, 'utf8').digest('hex').slice(0, 2);
}
