import { createHash } from 'node:crypto';

/** One-way hash for session/API tokens (never stored reversibly). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
