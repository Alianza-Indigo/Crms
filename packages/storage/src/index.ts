import { createHmac, createHash } from 'node:crypto';
import { loadEnv } from '@crms/config';
import { getContext } from '@crms/tenant-context';
import { createLogger } from '@crms/kernel';
import { assertClean } from './antivirus.js';

export * from './antivirus.js';

const logger = createLogger('storage');

/**
 * S3-compatible storage (PRD §34.6). Keys are ALWAYS segmented by tenant, so a
 * signed URL for one tenant can never address another tenant's object. Binaries
 * never touch PostgreSQL (PRD §49.6). Presigning uses AWS SigV4 (works with S3,
 * MinIO, Cloudflare R2). Tenants may attach BYO storage credentials; those are
 * resolved by the caller and passed in.
 */

export interface StorageCreds {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

function platformCreds(): StorageCreds {
  const env = loadEnv();
  return {
    endpoint: env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  };
}

/** Build a tenant-segmented storage key (PRD §34.6). */
export function tenantKey(...parts: string[]): string {
  const ctx = getContext();
  const app = ctx.applicationId ?? 'tenant';
  return ['t', ctx.tenantId, app, ctx.environment, ...parts].join('/');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a presigned URL (GET or PUT) valid for `expiresSeconds`. This is the
 * only way clients touch storage; the platform never proxies the bytes.
 */
export function presign(
  method: 'GET' | 'PUT',
  key: string,
  expiresSeconds = 900,
  creds: StorageCreds = platformCreds(),
): string {
  const url = new URL(creds.endpoint);
  const host = url.host;
  const path = creds.forcePathStyle ? `/${creds.bucket}/${key}` : `/${key}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const scope = `${dateStamp}/${creds.region}/${service}/aws4_request`;

  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
    .join('&');

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, creds.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  return `${url.protocol}//${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function presignUpload(key: string, expiresSeconds = 900, creds?: StorageCreds): string {
  return presign('PUT', key, expiresSeconds, creds);
}
export function presignDownload(key: string, expiresSeconds = 900, creds?: StorageCreds): string {
  return presign('GET', key, expiresSeconds, creds);
}

/** Server-side upload for platform-generated artifacts (documents, exports). */
export async function putObject(key: string, body: Buffer, contentType: string, creds?: StorageCreds): Promise<void> {
  await assertClean(body); // reject malware before it ever reaches storage (PRD §32.2)
  const url = presignUpload(key, 300, creds);
  const res = await fetch(url, { method: 'PUT', body, headers: { 'content-type': contentType } });
  if (!res.ok) {
    logger.error({ status: res.status, key }, 'putObject failed');
    throw new Error(`Storage upload failed (${res.status})`);
  }
}
