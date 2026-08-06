import { pino, type Logger } from 'pino';

/**
 * Structured logger. A global redaction list guarantees that secret-bearing
 * fields never reach the log stream (PRD §10.4, §32.4 — secrets must never be
 * logged). Domains should still avoid passing secrets, but this is the backstop.
 */
const REDACT_PATHS = [
  'password',
  '*.password',
  'secret',
  '*.secret',
  'secretValue',
  '*.secretValue',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'authorization',
  '*.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'credential.value',
  'ciphertext',
  '*.ciphertext',
];

export function createLogger(name: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const rootLogger = createLogger('crms');
export type { Logger };
