import { and, eq, or, schema, withTenant, withElevated } from '@crms/database';
import { newId, NotFound, Forbidden, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { tenantKey, putObject, presignDownload } from '@crms/storage';

const logger = createLogger('compliance');

/**
 * Data governance flows (PRD §33): data-subject access (export) and erasure
 * (delete/anonymize). Both respect legal hold. Exports are written to
 * tenant-segmented storage and returned as a signed URL. These are real
 * gathering/anonymization operations over the tenant's data.
 */

/** Export everything the platform holds about a subject (a user) in this tenant. */
export async function exportSubjectData(userId: string): Promise<{ storageKey: string; url: string; records: number }> {
  const ctx = getContext();
  const bundle = await withTenant(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
    const memberships = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
    const records = await tx
      .select()
      .from(schema.records)
      .where(
        or(
          eq(schema.records.ownerUserId, userId),
          eq(schema.records.assigneeUserId, userId),
          eq(schema.records.createdBy, userId),
        ),
      );
    const comments = await tx.select().from(schema.comments).where(eq(schema.comments.createdBy, userId));
    const audit = await tx.select().from(schema.auditEvents).where(eq(schema.auditEvents.actorUserId, userId));
    return {
      subject: user ? { id: user.id, email: user.email, name: user.name } : { id: userId },
      memberships,
      records,
      comments,
      auditEvents: audit,
      exportedAt: new Date().toISOString(),
    };
  });

  const storageKey = tenantKey('dsar', `subject-${userId}-${newId('audit').slice(-8)}.json`);
  await putObject(storageKey, Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'), 'application/json');
  logger.info({ userId, records: bundle.records.length, tenant: ctx.tenantId }, 'DSAR export produced');
  return { storageKey, url: presignDownload(storageKey, 3600), records: bundle.records.length };
}

/**
 * Erase a subject's personal data (PRD §33). Anonymizes the user record and
 * detaches ownership/assignment from their records. Refuses if any legal hold is
 * active for the tenant (a legal_hold archive job present).
 */
export async function eraseSubjectData(userId: string, opts: { confirm?: boolean } = {}): Promise<{ anonymizedRecords: number }> {
  const ctx = getContext();
  if (!opts.confirm) throw Forbidden('Erasure requires explicit confirmation (confirm=true)');

  return withElevated(async (tx) => {
    const holds = await tx
      .select()
      .from(schema.auditArchiveJobs)
      .where(and(eq(schema.auditArchiveJobs.tenantId, ctx.tenantId), eq(schema.auditArchiveJobs.legalHold, true)));
    if (holds.length) throw Forbidden('A legal hold is active for this tenant; erasure is blocked');

    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw NotFound('User', userId);

    // Detach the subject from records (owner/assignee) within this tenant.
    const owned = await tx
      .update(schema.records)
      .set({ ownerUserId: null })
      .where(and(eq(schema.records.tenantId, ctx.tenantId), eq(schema.records.ownerUserId, userId)))
      .returning({ id: schema.records.id });
    await tx
      .update(schema.records)
      .set({ assigneeUserId: null })
      .where(and(eq(schema.records.tenantId, ctx.tenantId), eq(schema.records.assigneeUserId, userId)));

    // Anonymize the global user identity + remove tenant membership.
    await tx
      .update(schema.users)
      .set({ email: `erased+${userId}@example.invalid`, name: 'Erased User', passwordHash: null, oauthProvider: null, oauthSubject: null, avatarUrl: null })
      .where(eq(schema.users.id, userId));
    await tx
      .update(schema.memberships)
      .set({ status: 'removed' })
      .where(and(eq(schema.memberships.tenantId, ctx.tenantId), eq(schema.memberships.userId, userId)));

    logger.warn({ userId, tenant: ctx.tenantId, anonymized: owned.length }, 'DSAR erasure executed');
    return { anonymizedRecords: owned.length };
  });
}
