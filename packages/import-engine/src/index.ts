import { and, eq, schema, withTenant, withElevated } from '@crms/database';
import { newId, NotFound, createLogger } from '@crms/kernel';
import { getContext, buildContext, runWithBuiltContext } from '@crms/tenant-context';
import { recordsEngine, query } from '@crms/records-engine';
import { parseCsv } from './csv.js';

export * from './csv.js';

const logger = createLogger('import-engine');

export interface CreateImportInput {
  moduleId: string;
  format: 'csv' | 'json';
  /** Raw CSV text or a JSON array of row objects. */
  content: string;
  /** Map of source column/key -> target field key. Identity if omitted. */
  mapping?: Record<string, string>;
  dedupeField?: string;
  updateExisting?: boolean;
}

/** Create an import job (PRD §24). Processed asynchronously by the worker. */
export async function createImportJob(input: CreateImportInput): Promise<string> {
  const ctx = getContext();
  if (!ctx.applicationId) throw NotFound('application context');
  const id = newId('outbox');
  await withTenant(async (tx) => {
    await tx.insert(schema.importJobs).values({
      id,
      tenantId: ctx.tenantId,
      applicationId: ctx.applicationId!,
      environment: ctx.environment,
      moduleId: input.moduleId,
      format: input.format,
      status: 'pending',
      mapping: input.mapping ?? {},
      dedupeField: input.dedupeField,
      updateExisting: input.updateExisting ?? false,
      payload: { content: input.content },
      createdBy: ctx.userId,
    });
  });
  logger.info({ jobId: id, moduleId: input.moduleId, format: input.format }, 'Import job created');
  return id;
}

function rowsOf(format: string, content: string): Record<string, unknown>[] {
  if (format === 'json') {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return parseCsv(content);
}

function applyMapping(row: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
  if (!Object.keys(mapping).length) return row;
  const out: Record<string, unknown> = {};
  for (const [src, target] of Object.entries(mapping)) {
    if (row[src] !== undefined) out[target] = row[src];
  }
  return out;
}

/**
 * Process a pending import job (worker). Parses rows, maps + validates each via
 * the records engine (which enforces field validation), applies dedupe/update,
 * and records per-row errors. Runs in the job's tenant context.
 */
export async function processImportJob(jobId: string): Promise<void> {
  const job = await withElevated(async (tx) => {
    const [row] = await tx.select().from(schema.importJobs).where(eq(schema.importJobs.id, jobId));
    return row ?? null;
  });
  if (!job) throw NotFound('ImportJob', jobId);

  const ctx = buildContext({
    tenantId: job.tenantId,
    applicationId: job.applicationId,
    environment: job.environment as never,
    origin: 'import',
    roleIds: ['__owner__'],
  });

  await withElevated(async (tx) => {
    await tx.update(schema.importJobs).set({ status: 'running', startedAt: new Date() }).where(eq(schema.importJobs.id, jobId));
  });

  const errors: Array<{ row: number; error: string }> = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  await runWithBuiltContext(ctx, async () => {
    const rows = rowsOf(job.format, (job.payload as { content: string }).content ?? '');
    for (let i = 0; i < rows.length; i++) {
      const data = applyMapping(rows[i]!, job.mapping as Record<string, string>);
      try {
        if (job.dedupeField && data[job.dedupeField] !== undefined) {
          const page = await query({ moduleId: job.moduleId, filters: [{ field: job.dedupeField, operator: 'eq', value: data[job.dedupeField] }], limit: 1 });
          const existing = page.items[0];
          if (existing) {
            if (job.updateExisting) {
              await recordsEngine.update(job.moduleId, existing.id, data);
              updated++;
            }
            continue;
          }
        }
        await recordsEngine.create({ moduleId: job.moduleId, data });
        created++;
      } catch (err) {
        failed++;
        errors.push({ row: i + 1, error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  await withElevated(async (tx) => {
    await tx
      .update(schema.importJobs)
      .set({
        status: 'completed',
        total: created + updated + failed,
        created,
        updated,
        failed,
        errors: errors.slice(0, 200),
        finishedAt: new Date(),
      })
      .where(eq(schema.importJobs.id, jobId));
  });
  logger.info({ jobId, created, updated, failed }, 'Import job processed');
}

export async function getImportJob(jobId: string): Promise<typeof schema.importJobs.$inferSelect> {
  return withTenant(async (tx) => {
    const [row] = await tx.select().from(schema.importJobs).where(and(eq(schema.importJobs.id, jobId)));
    if (!row) throw NotFound('ImportJob', jobId);
    return row;
  });
}
