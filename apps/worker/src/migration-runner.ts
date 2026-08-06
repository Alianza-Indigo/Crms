import { and, eq, inArray, schema, withElevated } from '@crms/database';
import { createLogger } from '@crms/kernel';
import { runMigration } from '@crms/tenant-migration';

const logger = createLogger('worker:migration');

/**
 * Drain pending tenant-migration jobs (PRD §6.3). Claims a job, runs the phase
 * machine (which performs the real data copy via the registered provider), and
 * lets the engine mark terminal state.
 */
export async function drainMigrationJobs(): Promise<number> {
  const jobs = await withElevated(async (tx) => {
    const due = await tx
      .select()
      .from(schema.tenantMigrationJobs)
      .where(eq(schema.tenantMigrationJobs.status, 'pending'))
      .limit(2)
      .for('update', { skipLocked: true });
    if (due.length) {
      await tx
        .update(schema.tenantMigrationJobs)
        .set({ status: 'running' })
        .where(inArray(schema.tenantMigrationJobs.id, due.map((j) => j.id)));
    }
    return due;
  });

  for (const job of jobs) {
    try {
      await runMigration(job.id);
    } catch (err) {
      logger.warn({ err, jobId: job.id }, 'Migration job failed');
    }
  }
  void and;
  return jobs.length;
}
