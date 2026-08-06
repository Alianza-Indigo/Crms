import { and, eq, gt, asc, schema, withTenant, type DbExecutor } from '@crms/database';
import { newId, NotFound, ValidationError, DestructiveUnconfirmed, Forbidden, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { assert, check } from '@crms/permissions';
import { buildEvent, EVENT_TYPES } from '@crms/events';
import { writeEvent } from '@crms/outbox';
import { requireScope, query, type QuerySpec } from './query-engine.js';
import { validateValues } from './validation.js';
import { computeSelfDerived, recomputeAggregates } from './compute.js';

const logger = createLogger('records-engine');

export interface CreateRecordInput {
  moduleId: string;
  data: Record<string, unknown>;
  ownerUserId?: string;
  assigneeUserId?: string;
  teamId?: string;
  branchId?: string;
  stage?: string;
}

/**
 * Records Engine (PRD §12, §39). Every mutation goes through here so that
 * validation, permissions, field-value projection, history, events (via the
 * transactional outbox), and tenant scoping happen consistently. No feature code
 * writes records tables directly.
 */
export class RecordsEngine {
  async get(moduleId: string, recordId: string): Promise<typeof schema.records.$inferSelect> {
    const scope = requireScope();
    const row = await withTenant(async (tx) => {
      const [r] = await tx
        .select()
        .from(schema.records)
        .where(and(eq(schema.records.id, recordId), eq(schema.records.moduleId, moduleId)));
      return r ?? null;
    });
    if (!row || row.deletedAt) throw NotFound('Record', recordId);
    await assert('view', {
      type: 'record',
      selector: moduleId,
      ownerUserId: row.ownerUserId,
      teamId: row.teamId,
      branchId: row.branchId,
    });
    void scope;
    const fields = await this.loadFields(moduleId);
    return this.maskRecord(row, fields);
  }

  async list(spec: QuerySpec) {
    await assert('view', { type: 'record', selector: spec.moduleId });
    const page = await query(spec);
    const fields = await this.loadFields(spec.moduleId);
    page.items = page.items.map((r) => this.maskRecord(r, fields));
    return page;
  }

  /**
   * Field-level permissions (PRD §18). Compute the set of field keys the current
   * subject may NOT read / write. Owners and platform admins bypass. A field is
   * restricted when it declares readRoles/writeRoles and the subject holds none.
   */
  private fieldMasks(fields: Array<typeof schema.fieldDefinitions.$inferSelect>): { noRead: Set<string>; noWrite: Set<string> } {
    const ctx = getContext();
    const noRead = new Set<string>();
    const noWrite = new Set<string>();
    if (ctx.isPlatformAdmin || ctx.roleIds.includes('__owner__')) return { noRead, noWrite };
    for (const f of fields) {
      const p = (f.permissions as { readRoles?: string[]; writeRoles?: string[] }) ?? {};
      if (p.readRoles?.length && !p.readRoles.some((r) => ctx.roleIds.includes(r))) noRead.add(f.key);
      if (p.writeRoles?.length && !p.writeRoles.some((r) => ctx.roleIds.includes(r))) noWrite.add(f.key);
    }
    return { noRead, noWrite };
  }

  /** Strip fields the subject may not read from a record's data snapshot. */
  private maskRecord(
    row: typeof schema.records.$inferSelect,
    fields: Array<typeof schema.fieldDefinitions.$inferSelect>,
  ): typeof schema.records.$inferSelect {
    const { noRead } = this.fieldMasks(fields);
    if (noRead.size === 0) return row;
    const data = { ...(row.data as Record<string, unknown>) };
    for (const key of noRead) delete data[key];
    return { ...row, data };
  }

  /** Reject writes to fields the subject may not write (PRD §18). */
  private assertFieldWrites(
    fields: Array<typeof schema.fieldDefinitions.$inferSelect>,
    keys: string[],
  ): void {
    const { noWrite } = this.fieldMasks(fields);
    const denied = keys.filter((k) => noWrite.has(k));
    if (denied.length) {
      throw Forbidden(`You cannot modify field(s): ${denied.join(', ')}`, { fields: denied });
    }
  }

  async create(input: CreateRecordInput): Promise<typeof schema.records.$inferSelect> {
    const scope = requireScope();
    const ctx = getContext();
    await assert('create', { type: 'record', selector: input.moduleId });

    const fields = await this.loadFields(input.moduleId);
    this.assertFieldWrites(fields, Object.keys(input.data));
    const { normalized, projections } = await validateValues(fields, input.data, { mode: 'create' });

    const recordId = newId('record');

    return withTenant(async (tx) => {
      // Compute formula/computed/autonumber fields before persisting (PRD §11.3).
      const derived = await computeSelfDerived(tx, scope, input.moduleId, fields, normalized);
      Object.assign(normalized, derived.values);
      projections.push(...derived.projections);
      const displayTitle = this.deriveTitle(fields, normalized);

      await tx.insert(schema.records).values({
        id: recordId,
        tenantId: scope.tenantId,
        applicationId: scope.applicationId,
        environment: scope.environment,
        moduleId: input.moduleId,
        displayTitle,
        ownerUserId: input.ownerUserId ?? ctx.userId,
        assigneeUserId: input.assigneeUserId,
        teamId: input.teamId ?? ctx.teamIds[0],
        branchId: input.branchId ?? ctx.branchId,
        stage: input.stage,
        data: normalized,
        createdBy: ctx.userId ?? ctx.serviceAccountId,
      });
      await this.writeValues(tx, scope, input.moduleId, recordId, projections);
      await this.writeHistory(tx, scope, input.moduleId, recordId, 1, 'create', normalized);
      await writeEvent(
        tx,
        buildEvent({ type: EVENT_TYPES.recordCreated, moduleId: input.moduleId, recordId, payload: { data: normalized } }),
      );
      const [row] = await tx.select().from(schema.records).where(eq(schema.records.id, recordId));
      logger.info({ recordId, moduleId: input.moduleId }, 'Record created');
      return row!;
    });
  }

  async update(
    moduleId: string,
    recordId: string,
    patch: Record<string, unknown>,
  ): Promise<typeof schema.records.$inferSelect> {
    const scope = requireScope();
    const current = await this.get(moduleId, recordId);
    await assert('edit', {
      type: 'record',
      selector: moduleId,
      ownerUserId: current.ownerUserId,
      teamId: current.teamId,
      branchId: current.branchId,
    });
    const fields = await this.loadFields(moduleId);
    this.assertFieldWrites(fields, Object.keys(patch));
    const merged = { ...(current.data as Record<string, unknown>), ...patch };
    const { normalized, projections } = await validateValues(fields, merged, { mode: 'update' });

    return withTenant(async (tx) => {
      // Recompute derived fields (formula/computed) + aggregates (rollup/count).
      const derived = await computeSelfDerived(tx, scope, moduleId, fields, normalized);
      Object.assign(normalized, derived.values);
      projections.push(...derived.projections);
      const agg = await recomputeAggregates(tx, scope, moduleId, recordId, fields);
      Object.assign(normalized, agg.values);
      projections.push(...agg.projections);
      const changes = this.diff(current.data as Record<string, unknown>, normalized);

      await tx
        .update(schema.records)
        .set({
          data: normalized,
          displayTitle: this.deriveTitle(fields, normalized),
          updatedBy: getContext().userId,
          stage: (patch.stage as string) ?? current.stage,
        })
        .where(eq(schema.records.id, recordId));
      await this.writeValues(tx, scope, moduleId, recordId, projections);
      await this.writeHistory(tx, scope, moduleId, recordId, 2, 'update', changes);
      const stageChanged = patch.stage && patch.stage !== current.stage;
      await writeEvent(
        tx,
        buildEvent({
          type: stageChanged ? EVENT_TYPES.stageChanged : EVENT_TYPES.recordUpdated,
          moduleId,
          recordId,
          changes,
        }),
      );
      const [row] = await tx.select().from(schema.records).where(eq(schema.records.id, recordId));
      return row!;
    });
  }

  async archive(moduleId: string, recordId: string): Promise<void> {
    const current = await this.get(moduleId, recordId);
    await assert('edit', { type: 'record', selector: moduleId, ownerUserId: current.ownerUserId });
    await withTenant(async (tx) => {
      await tx.update(schema.records).set({ archivedAt: new Date() }).where(eq(schema.records.id, recordId));
      await writeEvent(tx, buildEvent({ type: EVENT_TYPES.recordArchived, moduleId, recordId }));
    });
  }

  /** Hard delete is destructive (PRD §9.4): requires confirmation. */
  async delete(moduleId: string, recordId: string, opts: { confirm?: boolean } = {}): Promise<void> {
    if (!opts.confirm) throw DestructiveUnconfirmed('delete_record', { moduleId, recordId });
    const current = await this.get(moduleId, recordId);
    await assert('delete', { type: 'record', selector: moduleId, ownerUserId: current.ownerUserId });
    await withTenant(async (tx) => {
      await tx.update(schema.records).set({ deletedAt: new Date() }).where(eq(schema.records.id, recordId));
      await tx.update(schema.recordValues).set({ deletedAt: new Date() }).where(eq(schema.recordValues.recordId, recordId));
      await writeEvent(tx, buildEvent({ type: EVENT_TYPES.recordDeleted, moduleId, recordId }));
    });
  }

  /**
   * Delta sync for mobile/offline clients (PRD §27.1). Returns records changed
   * since a cursor, including tombstones for deletions, ordered by updated_at so
   * the client can resume with `nextSince`. Field masking is applied.
   */
  async sync(
    moduleId: string,
    sinceIso: string | undefined,
    limit = 100,
  ): Promise<{ changed: Array<typeof schema.records.$inferSelect>; deleted: Array<{ id: string; deletedAt: string }>; nextSince: string; hasMore: boolean }> {
    const scope = requireScope();
    await assert('view', { type: 'record', selector: moduleId });
    const since = sinceIso ? new Date(sinceIso) : new Date(0);
    const capped = Math.min(Math.max(limit, 1), 500);
    return withTenant(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.records)
        .where(
          and(
            eq(schema.records.tenantId, scope.tenantId),
            eq(schema.records.applicationId, scope.applicationId),
            eq(schema.records.environment, scope.environment),
            eq(schema.records.moduleId, moduleId),
            gt(schema.records.updatedAt, since),
          ),
        )
        .orderBy(asc(schema.records.updatedAt))
        .limit(capped + 1);
      const hasMore = rows.length > capped;
      const items = hasMore ? rows.slice(0, capped) : rows;
      const fields = await this.loadFields(moduleId);
      const changed = items.filter((r) => !r.deletedAt).map((r) => this.maskRecord(r, fields));
      const deleted = items
        .filter((r) => r.deletedAt)
        .map((r) => ({ id: r.id, deletedAt: r.deletedAt!.toISOString() }));
      const last = items[items.length - 1];
      return {
        changed,
        deleted,
        nextSince: last ? last.updatedAt.toISOString() : (sinceIso ?? new Date(0).toISOString()),
        hasMore,
      };
    });
  }

  async restore(moduleId: string, recordId: string): Promise<void> {
    await assert('edit', { type: 'record', selector: moduleId });
    await withTenant(async (tx) => {
      await tx.update(schema.records).set({ archivedAt: null }).where(eq(schema.records.id, recordId));
      await writeEvent(tx, buildEvent({ type: EVENT_TYPES.recordRestored, moduleId, recordId }));
    });
  }

  /** Duplicate a record (PRD §12). Copies field data; new ownership/id. */
  async duplicate(moduleId: string, recordId: string): Promise<typeof schema.records.$inferSelect> {
    const current = await this.get(moduleId, recordId);
    return this.create({
      moduleId,
      data: { ...(current.data as Record<string, unknown>) },
      teamId: current.teamId ?? undefined,
      branchId: current.branchId ?? undefined,
    });
  }

  /** Assign to a user; transfer is the same op audited as ownership change. */
  async assign(moduleId: string, recordId: string, assigneeUserId: string | null): Promise<void> {
    const current = await this.get(moduleId, recordId);
    await assert('assign', { type: 'record', selector: moduleId, ownerUserId: current.ownerUserId });
    await withTenant(async (tx) => {
      await tx.update(schema.records).set({ assigneeUserId }).where(eq(schema.records.id, recordId));
      await writeEvent(tx, buildEvent({ type: EVENT_TYPES.recordUpdated, moduleId, recordId, changes: { assigneeUserId } }));
    });
  }

  async transfer(moduleId: string, recordId: string, newOwnerUserId: string): Promise<void> {
    const current = await this.get(moduleId, recordId);
    await assert('assign', { type: 'record', selector: moduleId, ownerUserId: current.ownerUserId });
    await withTenant(async (tx) => {
      await tx.update(schema.records).set({ ownerUserId: newOwnerUserId }).where(eq(schema.records.id, recordId));
      await writeEvent(
        tx,
        buildEvent({ type: EVENT_TYPES.recordUpdated, moduleId, recordId, changes: { ownerUserId: { from: current.ownerUserId, to: newOwnerUserId } } }),
      );
    });
  }

  /** Approve/reject move a record's approval state + emit the event (PRD §12). */
  async setApproval(moduleId: string, recordId: string, decision: 'approved' | 'rejected', reason?: string): Promise<void> {
    const current = await this.get(moduleId, recordId);
    await assert('approve', { type: 'record', selector: moduleId, ownerUserId: current.ownerUserId });
    await this.update(moduleId, recordId, { approval_status: decision, approval_reason: reason ?? null });
    await withTenant(async (tx) => {
      await writeEvent(tx, buildEvent({ type: EVENT_TYPES.approvalResponded, moduleId, recordId, payload: { decision, reason } }));
    });
  }

  async lock(moduleId: string, recordId: string): Promise<void> {
    const ctx = getContext();
    const current = await this.get(moduleId, recordId);
    await assert('edit', { type: 'record', selector: moduleId, ownerUserId: current.ownerUserId });
    await withTenant(async (tx) => {
      await tx.update(schema.records).set({ lockedAt: new Date(), lockedBy: ctx.userId }).where(eq(schema.records.id, recordId));
    });
  }

  async unlock(moduleId: string, recordId: string): Promise<void> {
    const current = await this.get(moduleId, recordId);
    await assert('edit', { type: 'record', selector: moduleId, ownerUserId: current.ownerUserId });
    await withTenant(async (tx) => {
      await tx.update(schema.records).set({ lockedAt: null, lockedBy: null }).where(eq(schema.records.id, recordId));
    });
  }

  // --- helpers ---

  private async loadFields(moduleId: string): Promise<Array<typeof schema.fieldDefinitions.$inferSelect>> {
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.fieldDefinitions)
        .where(eq(schema.fieldDefinitions.moduleId, moduleId)),
    );
  }

  private deriveTitle(
    fields: Array<typeof schema.fieldDefinitions.$inferSelect>,
    data: Record<string, unknown>,
  ): string {
    const titleField = fields.find((f) => f.type === 'text_short') ?? fields[0];
    const val = titleField ? data[titleField.key] : undefined;
    return val != null ? String(val) : 'Untitled';
  }

  private async writeValues(
    tx: DbExecutor,
    scope: { tenantId: string; applicationId: string; environment: string },
    moduleId: string,
    recordId: string,
    projections: Array<{ fieldId: string; fieldKey: string; text?: string; number?: string; bool?: boolean; date?: Date; json?: unknown }>,
  ): Promise<void> {
    for (const p of projections) {
      await tx
        .insert(schema.recordValues)
        .values({
          id: newId('record'),
          tenantId: scope.tenantId,
          applicationId: scope.applicationId,
          environment: scope.environment,
          recordId,
          moduleId,
          fieldId: p.fieldId,
          fieldKey: p.fieldKey,
          valueText: p.text ?? null,
          valueNumber: p.number ?? null,
          valueBool: p.bool ?? null,
          valueDate: p.date ?? null,
          valueJson: (p.json as never) ?? null,
        })
        .onConflictDoUpdate({
          target: [schema.recordValues.recordId, schema.recordValues.fieldId],
          set: {
            valueText: p.text ?? null,
            valueNumber: p.number ?? null,
            valueBool: p.bool ?? null,
            valueDate: p.date ?? null,
            valueJson: (p.json as never) ?? null,
          },
        });
    }
  }

  private async writeHistory(
    tx: DbExecutor,
    scope: { tenantId: string; applicationId: string; environment: string },
    moduleId: string,
    recordId: string,
    version: number,
    changeType: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    const ctx = getContext();
    await tx.insert(schema.recordHistory).values({
      id: newId('record'),
      tenantId: scope.tenantId,
      applicationId: scope.applicationId,
      environment: scope.environment,
      recordId,
      moduleId,
      version,
      changeType,
      changes,
      actor: ctx.userId ?? ctx.serviceAccountId,
      correlationId: ctx.correlationId,
    });
  }

  private diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
        changes[key] = { from: before[key], to: after[key] };
      }
    }
    return changes;
  }
}

export const recordsEngine = new RecordsEngine();
export { check as checkRecordAccess };
