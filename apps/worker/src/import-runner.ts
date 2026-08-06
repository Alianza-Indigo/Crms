import { eq, inArray, schema, withElevated } from '@crms/database';
import { createLogger } from '@crms/kernel';
import { processImportJob } from '@crms/import-engine';

const logger = createLogger('worker:imports');

/** Claim and process pending import jobs (PRD §24), off the request path. */
export async function drainImportJobs(): Promise<number> {
  const jobs = await withElevated(async (tx) => {
    const due = await tx
      .select()
      .from(schema.importJobs)
      .where(eq(schema.importJobs.status, 'pending'))
      .limit(3)
      .for('update', { skipLocked: true });
    if (due.length) {
      await tx
        .update(schema.importJobs)
        .set({ status: 'running' })
        .where(inArray(schema.importJobs.id, due.map((j) => j.id)));
    }
    return due;
  });

  for (const job of jobs) {
    try {
      await processImportJob(job.id);
    } catch (err) {
      logger.warn({ err, jobId: job.id }, 'Import job failed');
      await withElevated(async (tx) => {
        await tx.update(schema.importJobs).set({ status: 'failed', errors: [{ error: (err as Error).message }] }).where(eq(schema.importJobs.id, job.id));
      });
    }
  }
  return jobs.length;
}
