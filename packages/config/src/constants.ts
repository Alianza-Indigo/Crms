/**
 * Platform-wide constants shared across every package and app.
 * Keep these authoritative and in one place so no domain re-invents them.
 */

/** Application environments a tenant application flows through (PRD §8.3). */
export const ENVIRONMENTS = ['draft', 'development', 'testing', 'staging', 'production'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Tenant isolation tiers (PRD §6.1). */
export const ISOLATION_TIERS = ['shared', 'schema', 'dedicated'] as const;
export type IsolationTier = (typeof ISOLATION_TIERS)[number];

/** Postgres session GUCs used to carry tenant context into RLS policies. */
export const PG_CONTEXT = {
  tenantId: 'app.current_tenant_id',
  applicationId: 'app.current_application_id',
  environment: 'app.current_environment',
  userId: 'app.current_user_id',
  bypassRls: 'app.bypass_rls',
} as const;

/** Redis key prefixes — every key is segmented by tenant (PRD §6.1). */
export const redisTenantKey = (tenantId: string, ...parts: string[]): string =>
  ['crms', 't', tenantId, ...parts].join(':');

export const redisPlatformKey = (...parts: string[]): string => ['crms', 'platform', ...parts].join(':');

/** BullMQ queue names. Workers process these off the request path (PRD §35.3). */
export const QUEUES = {
  outbox: 'outbox-dispatch',
  automation: 'automation-run',
  webhookDelivery: 'webhook-delivery',
  credentialRefresh: 'credential-refresh',
  auditArchive: 'audit-archive',
  import: 'record-import',
  document: 'document-generation',
  aiExecution: 'ai-execution',
  schemaMigration: 'schema-migration',
  tenantMigration: 'tenant-migration',
} as const;

/** Default limits for the Federated Query Engine (PRD §17.1). */
export const FEDERATED_QUERY = {
  defaultRowLimit: 1000,
  maxRowLimit: 10000,
  defaultTimeoutMs: 5000,
  maxTimeoutMs: 30000,
} as const;

/** Sandbox execution limits for custom scripts (PRD §28.2). */
export const SANDBOX = {
  defaultTimeoutMs: 5000,
  maxTimeoutMs: 30000,
  defaultMemoryMb: 128,
  maxMemoryMb: 512,
} as const;

/** Idempotency key retention (PRD §12.1). */
export const IDEMPOTENCY_TTL_HOURS = 24;

/** Audit retention policy options (PRD §32.6). */
export const AUDIT_RETENTION = {
  '1y': 365,
  '3y': 365 * 3,
  '5y': 365 * 5,
  indefinite: null,
} as const;
export type AuditRetentionPolicy = keyof typeof AUDIT_RETENTION;

/** Correlation-id header used across web → api → workers for tracing. */
export const CORRELATION_HEADER = 'x-correlation-id';
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const TENANT_HEADER = 'x-tenant-id';
export const APPLICATION_HEADER = 'x-application-id';
export const ENVIRONMENT_HEADER = 'x-environment';
