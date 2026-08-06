import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from 'node:crypto';
import { loadEnv } from '@crms/config';

/**
 * Envelope encryption (PRD §10.5).
 *
 * Each secret is encrypted with a fresh 256-bit *data key* using AES-256-GCM.
 * The data key is then wrapped (encrypted) with the platform *master key*
 * (from a KMS/secret manager in production; from PLATFORM_MASTER_KEY here).
 *
 * The stored blob layout (all base64url, dot-separated) is:
 *   v<keyVersion>.<wrappedDataKey>.<iv>.<authTag>.<ciphertext>
 *
 * Properties this guarantees, matching the PRD:
 *  - Secrets are encrypted before persisting; master key lives outside the row.
 *  - Rotating the master key only requires re-wrapping data keys, not re-reading
 *    every plaintext.
 *  - Ciphertext is authenticated (GCM tag): tampering is detected on decrypt.
 */

const MASTER_KEY_VERSION = '1';

function masterKey(): Buffer {
  const key = Buffer.from(loadEnv().PLATFORM_MASTER_KEY, 'base64');
  if (key.length !== 32) throw new Error('PLATFORM_MASTER_KEY must decode to 32 bytes');
  return key;
}

function b64(buf: Buffer): string {
  return buf.toString('base64url');
}
function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ct };
}

function aesGcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Encrypt a secret value into an opaque, versioned envelope blob. */
export function encryptSecret(plaintext: string): { ciphertext: string; keyVersion: string } {
  const dataKey = randomBytes(32);
  const enc = aesGcmEncrypt(dataKey, Buffer.from(plaintext, 'utf8'));
  // Wrap the data key with the master key.
  const wrap = aesGcmEncrypt(masterKey(), dataKey);
  const wrappedDataKey = Buffer.concat([wrap.iv, wrap.tag, wrap.ct]);
  const blob = [
    `v${MASTER_KEY_VERSION}`,
    b64(wrappedDataKey),
    b64(enc.iv),
    b64(enc.tag),
    b64(enc.ct),
  ].join('.');
  // Zero the data key from memory as best-effort.
  dataKey.fill(0);
  return { ciphertext: blob, keyVersion: MASTER_KEY_VERSION };
}

/** Decrypt an envelope blob back to plaintext. Authorized execution paths only. */
export function decryptSecret(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 5) throw new Error('Malformed credential ciphertext');
  const [, wrappedB64, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  const wrapped = unb64(wrappedB64);
  const wrapIv = wrapped.subarray(0, 12);
  const wrapTag = wrapped.subarray(12, 28);
  const wrapCt = wrapped.subarray(28);
  const dataKey = aesGcmDecrypt(masterKey(), wrapIv, wrapTag, wrapCt);
  const plaintext = aesGcmDecrypt(dataKey, unb64(ivB64), unb64(tagB64), unb64(ctB64));
  dataKey.fill(0);
  return plaintext.toString('utf8');
}

/** One-way hash for API keys / tokens (never store these reversibly). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Constant-time comparison for hashes. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
