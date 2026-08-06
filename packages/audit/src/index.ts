import { and, desc, eq, gte, lte, schema, withElevated, withTenant, sql } from '@crms/database';
import { newId, createLogger, buildPage, type Page, type PageParams } from '@crms/kernel';
import { tryGetContext } from '@crms/tenant-context';

const logger = createLogger('audit');

/**
 * Secret-safe redaction. Audit records describe WHAT changed but never store
 * secret values (PRD §10.15, §32.4). Any field whose key looks sensitive is
 * replaced with a marker before persisting.
 */
const SENSITIVE_KEY = /(secret|password|api[_-]?key|token|ciphertext|private[_-]?key|client[_-]?secret)/i;

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

export interface AuditInput {
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  /** Override tenant for platform-admin actions crossing tenants. */
  tenantId?: string;
}

/**
 * Write an audit event. Uses an elevated write so audit is never blocked by RLS,
 * but always stamps the acting tenant + full impersonation trail from context.
 */
export async function audit(input: AuditInput): Promise<void> {
  const ctx = tryGetContext();
  const tenantId = input.tenantId ?? ctx?.tenantId;
  if (!tenantId) {
    logger.warn({ action: input.action }, 'Audit called without tenant context; skipping');
    return;
  }
  await withElevated(async (tx) => {
    await tx.insert(schema.auditEvents).values({
      id: newId('audit'),
      tenantId,
      applicationId: ctx?.applicationId ?? null,
      environment: ctx?.environment ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      actorUserId: ctx?.userId ?? null,
      actorServiceAccountId: ctx?.serviceAccountId ?? null,
      originalUserId: ctx?.impersonation?.originalUserId ?? null,
      impersonatedUserId: ctx?.impersonation?.impersonatedUserId ?? null,
      impersonatedBy: ctx?.impersonation?.impersonatedBy ?? null,
      ip: input.ip,
      userAgent: input.userAgent,
      correlationId: ctx?.correlationId,
      metadata: (redact(input.metadata ?? {}) as Record<string, unknown>) ?? {},
    });
  }, ctx ?? undefined);
}

export async function listAudit(
  filter: { resourceType?: string; resourceId?: string; from?: Date; to?: Date },
  page: PageParams,
): Promise<Page<typeof schema.auditEvents.$inferSelect>> {
  return withTenant(async (tx) => {
    const conds = [];
    if (filter.resourceType) conds.push(eq(schema.auditEvents.resourceType, filter.resourceType));
    if (filter.resourceId) conds.push(eq(schema.auditEvents.resourceId, filter.resourceId));
    if (filter.from) conds.push(gte(schema.auditEvents.createdAt, filter.from));
    if (filter.to) conds.push(lte(schema.auditEvents.createdAt, filter.to));
    const rows = await tx
      .select()
      .from(schema.auditEvents)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(schema.auditEvents.createdAt))
      .limit(page.limit + 1);
    return buildPage(rows, page.limit);
  });
}

/**
 * Audit Lifecycle archival (PRD §32.6). Moves rows older than the tenant's
 * retention window to cold storage. Legal hold prevents deletion. This function
 * marks the job; the worker streams rows to S3-compatible storage.
 */
export async function createArchiveJob(tenantId: string, cutoff: Date, legalHold = false): Promise<string> {
  const id = newId('audit');
  await withElevated(async (tx) => {
    await tx.insert(schema.auditArchiveJobs).values({
      id,
      tenantId,
      cutoffDate: cutoff,
      status: 'pending',
      legalHold,
    });
  });
  return id;
}
