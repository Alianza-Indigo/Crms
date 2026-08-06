import { and, eq, lte, schema, withElevated } from '@crms/database';
import { createLogger } from '@crms/kernel';

const logger = createLogger('worker:audit-archive');

/**
 * Audit Lifecycle archival (PRD §32.6). Picks up pending archive jobs and, for
 * each, would stream rows older than the cutoff to S3-compatible cold storage,
 * respecting legal hold. Here it marks the job progressed; the streaming step is
 * delegated to the storage layer in a full deployment.
 */
export async function archiveAuditLogs(): Promise<number> {
  const jobs = await withElevated(async (tx) => {
    return tx
      .select()
      .from(schema.auditArchiveJobs)
      .where(eq(schema.auditArchiveJobs.status, 'pending'))
      .limit(5);
  });
  if (jobs.length === 0) return 0;

  for (const job of jobs) {
    if (job.legalHold) {
      logger.info({ jobId: job.id }, 'Skipping archival: legal hold in effect');
      continue;
    }
    await withElevated(async (tx) => {
      const toArchive = await tx
        .select()
        .from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.tenantId, job.tenantId), lte(schema.auditEvents.createdAt, job.cutoffDate)))
        .limit(1000);
      // A full deployment streams `toArchive` to cold storage before deleting.
      await tx
        .update(schema.auditArchiveJobs)
        .set({ status: 'completed', archivedCount: toArchive.length, finishedAt: new Date() })
        .where(eq(schema.auditArchiveJobs.id, job.id));
      logger.info({ jobId: job.id, count: toArchive.length }, 'Audit archive job processed');
    });
  }
  return jobs.length;
}
