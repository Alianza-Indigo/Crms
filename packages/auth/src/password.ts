import { scrypt, randomBytes, timingSafeEqual, createHmac, type ScryptOptions } from 'node:crypto';

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Password hashing with scrypt (PRD §32.1 password policies). Format:
 * scrypt$N$r$p$<salt-b64>$<hash-b64>. No external dependency needed; scrypt is
 * memory-hard and built into Node.
 */
const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Minimal password policy check (PRD §32.1). */
export function validatePasswordPolicy(password: string): { ok: boolean; reason?: string } {
  if (password.length < 10) return { ok: false, reason: 'Password must be at least 10 characters' };
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { ok: false, reason: 'Password must include lower, upper and numeric characters' };
  }
  return { ok: true };
}

/** Sign a compact JWT-like token (HS256) for interactive sessions. */
export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc(header)}.${enc(body)}`;
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, sig] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const body = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')) as Record<string, unknown>;
  if (typeof body.exp === 'number' && body.exp < Math.floor(Date.now() / 1000)) return null;
  return body;
}
