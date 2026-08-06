import { z } from 'zod';

/**
 * Platform environment schema.
 *
 * This validates ONLY the platform's own bootstrap configuration. Tenant "BYO"
 * credentials (OpenAI, Stripe, WhatsApp, …) are never read from env — they live
 * encrypted in the database and are resolved per tenant/application/environment
 * by the credential-engine (PRD §10).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  // 32 raw bytes, base64-encoded, used as the envelope-encryption master key.
  PLATFORM_MASTER_KEY: z
    .string()
    .min(1, 'PLATFORM_MASTER_KEY is required')
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'PLATFORM_MASTER_KEY must be 32 bytes base64-encoded'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),

  // Google OAuth (platform-level login, PRD §32.1). Optional: when unset, the
  // Google login endpoints report that OAuth is not configured.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),

  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEBHOOK_BASE_URL: z.string().url().default('http://localhost:4000/webhooks'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  REALTIME_PORT: z.coerce.number().int().positive().default(4001),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('crms-platform'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal('')),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  IMPERSONATION_MAX_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

/**
 * Parse and cache the process environment. Throws a readable aggregated error
 * on misconfiguration so that a service refuses to boot in an unsafe state
 * (e.g. missing master key) rather than starting and leaking later.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid platform environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: clear the cached env so a new set of vars can be loaded. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => loadEnv().NODE_ENV === 'production';
export const isTest = (): boolean => loadEnv().NODE_ENV === 'test';
