import { and, eq, count, isNull, schema, withTenant } from '@crms/database';
import { newId, NotFound, ValidationError, Conflict, DestructiveUnconfirmed, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { buildEvent, EVENT_TYPES } from '@crms/events';
import { writeEvent } from '@crms/outbox';
import {
  ModuleInputSchema,
  FieldInputSchema,
  RelationInputSchema,
  ModulePatchSchema,
  FieldPatchSchema,
  type ModuleInput,
  type FieldInput,
  type RelationInput,
  type ModulePatch,
  type FieldPatch,
  type DestructiveChange,
} from './types.js';

const logger = createLogger('schema-engine');

/**
 * Schema Engine (PRD §38). Manages the metadata that describes each
 * application's data model: modules, fields, relations. All definitions are
 * scoped to (tenant, application, environment) so the same module can differ
 * between draft/dev/test/staging/prod, and structural changes flow through the
 * builder → validate → impact → publish path rather than hitting prod directly.
 */
export class SchemaEngine {
  private scope() {
    const ctx = getContext();
    if (!ctx.applicationId) throw ValidationError('Schema operations require an application context');
    return { tenantId: ctx.tenantId, applicationId: ctx.applicationId, environment: ctx.environment };
  }

  async createModule(input: ModuleInput): Promise<typeof schema.moduleDefinitions.$inferSelect> {
    const data = ModuleInputSchema.parse(input);
    await assert('manage_config', { type: 'application' });
    const s = this.scope();
    return withTenant(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.moduleDefinitions)
        .where(
          and(
            eq(schema.moduleDefinitions.applicationId, s.applicationId),
            eq(schema.moduleDefinitions.environment, s.environment),
            eq(schema.moduleDefinitions.key, data.key),
          ),
        );
      if (existing.length) throw Conflict(`Module '${data.key}' already exists`);
      const id = newId('module');
      await tx.insert(schema.moduleDefinitions).values({
        id,
        tenantId: s.tenantId,
        applicationId: s.applicationId,
        environment: s.environment,
        key: data.key,
        name: data.name,
        namePlural: data.namePlural,
        icon: data.icon,
        color: data.color,
        description: data.description,
        createdBy: getContext().userId,
      });
      const [row] = await tx.select().from(schema.moduleDefinitions).where(eq(schema.moduleDefinitions.id, id));
      logger.info({ moduleId: id, key: data.key }, 'Module created');
      return row!;
    });
  }

  /** Update a module's editable attributes (key is immutable). */
  async updateModule(
    moduleId: string,
    patch: ModulePatch,
  ): Promise<typeof schema.moduleDefinitions.$inferSelect> {
    const data = ModulePatchSchema.parse(patch);
    await assert('manage_config', { type: 'application' });
    return withTenant(async (tx) => {
      const [module] = await tx
        .select()
        .from(schema.moduleDefinitions)
        .where(eq(schema.moduleDefinitions.id, moduleId));
      if (!module) throw NotFound('Module', moduleId);
      await tx
        .update(schema.moduleDefinitions)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(schema.moduleDefinitions.id, moduleId));
      const [row] = await tx.select().from(schema.moduleDefinitions).where(eq(schema.moduleDefinitions.id, moduleId));
      logger.info({ moduleId }, 'Module updated');
      return row!;
    });
  }

  /** Impact of deleting a module: how many records it would discard. */
  async analyzeModuleDeletion(moduleId: string): Promise<DestructiveChange[]> {
    const s = this.scope();
    return withTenant(async (tx) => {
      const [module] = await tx
        .select()
        .from(schema.moduleDefinitions)
        .where(eq(schema.moduleDefinitions.id, moduleId));
      if (!module) throw NotFound('Module', moduleId);
      const countRows = await tx
        .select({ value: count() })
        .from(schema.records)
        .where(
          and(
            eq(schema.records.applicationId, s.applicationId),
            eq(schema.records.environment, s.environment),
            eq(schema.records.moduleId, moduleId),
          ),
        );
      const affected = Number(countRows[0]?.value ?? 0);
      return [
        {
          operation: 'delete_module',
          target: module.key,
          reason: 'Deleting a module permanently discards all its records and fields',
          affectedRecords: affected,
        },
      ];
    });
  }

  /** Delete a module (soft). Destructive: requires confirmation when it holds data. */
  async deleteModule(moduleId: string, opts: { confirm?: boolean } = {}): Promise<DestructiveChange[]> {
    const impact = await this.analyzeModuleDeletion(moduleId);
    const hasData = impact.some((c) => (c.affectedRecords ?? 0) > 0);
    if (hasData && !opts.confirm) throw DestructiveUnconfirmed('delete_module', { impact });
    await assert('manage_config', { type: 'application' });
    await withTenant(async (tx) => {
      const now = new Date();
      await tx.update(schema.moduleDefinitions).set({ deletedAt: now }).where(eq(schema.moduleDefinitions.id, moduleId));
      // Cascade: soft-delete the module's fields too.
      await tx.update(schema.fieldDefinitions).set({ deletedAt: now }).where(eq(schema.fieldDefinitions.moduleId, moduleId));
    });
    logger.info({ moduleId }, 'Module deleted');
    return impact;
  }

  async listModules(): Promise<Array<typeof schema.moduleDefinitions.$inferSelect>> {
    const s = this.scope();
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.moduleDefinitions)
        .where(
          and(
            eq(schema.moduleDefinitions.applicationId, s.applicationId),
            eq(schema.moduleDefinitions.environment, s.environment),
            isNull(schema.moduleDefinitions.deletedAt),
          ),
        )
        .orderBy(schema.moduleDefinitions.position),
    );
  }

  async createField(input: FieldInput): Promise<typeof schema.fieldDefinitions.$inferSelect> {
    const data = FieldInputSchema.parse(input);
    await assert('manage_config', { type: 'module', selector: data.moduleId });
    const s = this.scope();
    this.validateFieldConfig(data);
    return withTenant(async (tx) => {
      const [module] = await tx
        .select()
        .from(schema.moduleDefinitions)
        .where(eq(schema.moduleDefinitions.id, data.moduleId));
      if (!module) throw NotFound('Module', data.moduleId);
      const dupe = await tx
        .select()
        .from(schema.fieldDefinitions)
        .where(and(eq(schema.fieldDefinitions.moduleId, data.moduleId), eq(schema.fieldDefinitions.key, data.key)));
      if (dupe.length) throw Conflict(`Field '${data.key}' already exists on this module`);
      const id = newId('field');
      await tx.insert(schema.fieldDefinitions).values({
        id,
        tenantId: s.tenantId,
        applicationId: s.applicationId,
        environment: s.environment,
        moduleId: data.moduleId,
        key: data.key,
        name: data.name,
        type: data.type,
        required: data.required,
        unique: data.unique,
        indexed: data.indexed,
        defaultValue: data.defaultValue as never,
        config: data.config,
        validations: data.validations,
        permissions: data.permissions,
        helpText: data.helpText,
        createdBy: getContext().userId,
      });
      const [row] = await tx.select().from(schema.fieldDefinitions).where(eq(schema.fieldDefinitions.id, id));
      return row!;
    });
  }

  private validateFieldConfig(data: FieldInput): void {
    if ((data.type === 'select' || data.type === 'multi_select' || data.type === 'status') && !data.config.options) {
      throw ValidationError(`Field type '${data.type}' requires config.options`);
    }
    if (data.type === 'relation' && !data.config.targetModuleId) {
      throw ValidationError(`Relation field requires config.targetModuleId`);
    }
    if ((data.type === 'formula' || data.type === 'computed') && !data.config.expression) {
      throw ValidationError(`Formula/computed field requires config.expression`);
    }
    if (data.type === 'rollup' && (!data.config.relationId || !data.config.aggregate)) {
      throw ValidationError(`Rollup field requires config.relationId and config.aggregate`);
    }
  }

  async listFields(moduleId: string): Promise<Array<typeof schema.fieldDefinitions.$inferSelect>> {
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.fieldDefinitions)
        .where(and(eq(schema.fieldDefinitions.moduleId, moduleId), isNull(schema.fieldDefinitions.deletedAt)))
        .orderBy(schema.fieldDefinitions.position),
    );
  }

  /**
   * Update a field's editable attributes (key is immutable). Changing the type
   * of a field that already holds values is destructive (PRD §9.4) and requires
   * confirmation.
   */
  async updateField(
    fieldId: string,
    patch: FieldPatch,
    opts: { confirm?: boolean } = {},
  ): Promise<typeof schema.fieldDefinitions.$inferSelect> {
    const data = FieldPatchSchema.parse(patch);
    const s = this.scope();
    return withTenant(async (tx) => {
      const [field] = await tx.select().from(schema.fieldDefinitions).where(eq(schema.fieldDefinitions.id, fieldId));
      if (!field) throw NotFound('Field', fieldId);
      await assert('manage_config', { type: 'module', selector: field.moduleId });

      const nextType = data.type ?? field.type;
      const nextConfig = (data.config ?? (field.config as Record<string, unknown>)) as Record<string, unknown>;
      // Re-validate the resulting (type, config) shape.
      this.validateFieldConfig({ type: nextType, config: nextConfig } as FieldInput);

      // A type change on a field with stored values can corrupt data.
      if (data.type && data.type !== field.type) {
        const countRows = await tx
          .select({ value: count() })
          .from(schema.recordValues)
          .where(
            and(
              eq(schema.recordValues.applicationId, s.applicationId),
              eq(schema.recordValues.environment, s.environment),
              eq(schema.recordValues.fieldId, fieldId),
            ),
          );
        const affected = Number(countRows[0]?.value ?? 0);
        if (affected > 0 && !opts.confirm) {
          throw DestructiveUnconfirmed('change_field_type', {
            impact: [
              {
                operation: 'change_field_type',
                target: `${field.moduleId}.${field.key}`,
                reason: `Changing type ${field.type} → ${data.type} may invalidate stored values`,
                affectedRecords: affected,
              },
            ],
          });
        }
      }

      await tx
        .update(schema.fieldDefinitions)
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.type !== undefined ? { type: data.type } : {}),
          ...(data.required !== undefined ? { required: data.required } : {}),
          ...(data.unique !== undefined ? { unique: data.unique } : {}),
          ...(data.indexed !== undefined ? { indexed: data.indexed } : {}),
          ...(data.defaultValue !== undefined ? { defaultValue: data.defaultValue as never } : {}),
          ...(data.config !== undefined ? { config: data.config } : {}),
          ...(data.validations !== undefined ? { validations: data.validations } : {}),
          ...(data.permissions !== undefined ? { permissions: data.permissions } : {}),
          ...(data.helpText !== undefined ? { helpText: data.helpText } : {}),
          ...(data.position !== undefined ? { position: data.position } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.fieldDefinitions.id, fieldId));
      const [row] = await tx.select().from(schema.fieldDefinitions).where(eq(schema.fieldDefinitions.id, fieldId));
      logger.info({ fieldId }, 'Field updated');
      return row!;
    });
  }

  /** Persist a new field ordering for a module (positions follow the array). */
  async reorderFields(moduleId: string, orderedFieldIds: string[]): Promise<void> {
    await assert('manage_config', { type: 'module', selector: moduleId });
    await withTenant(async (tx) => {
      for (let i = 0; i < orderedFieldIds.length; i++) {
        await tx
          .update(schema.fieldDefinitions)
          .set({ position: i })
          .where(and(eq(schema.fieldDefinitions.id, orderedFieldIds[i]!), eq(schema.fieldDefinitions.moduleId, moduleId)));
      }
    });
    logger.info({ moduleId, count: orderedFieldIds.length }, 'Fields reordered');
  }

  async createRelation(input: RelationInput): Promise<typeof schema.relationDefinitions.$inferSelect> {
    const data = RelationInputSchema.parse(input);
    await assert('manage_config', { type: 'application' });
    const s = this.scope();
    return withTenant(async (tx) => {
      const id = newId('relation');
      await tx.insert(schema.relationDefinitions).values({
        id,
        tenantId: s.tenantId,
        applicationId: s.applicationId,
        environment: s.environment,
        key: data.key,
        name: data.name,
        type: data.type,
        sourceModuleId: data.sourceModuleId,
        targetModuleId: data.targetModuleId,
        onDelete: data.onDelete,
        inverseName: data.inverseName,
        required: data.required,
        config: data.config,
        createdBy: getContext().userId,
      });
      const [row] = await tx.select().from(schema.relationDefinitions).where(eq(schema.relationDefinitions.id, id));
      return row!;
    });
  }

  async listRelations(): Promise<Array<typeof schema.relationDefinitions.$inferSelect>> {
    const s = this.scope();
    return withTenant(async (tx) =>
      tx
        .select()
        .from(schema.relationDefinitions)
        .where(
          and(
            eq(schema.relationDefinitions.applicationId, s.applicationId),
            eq(schema.relationDefinitions.environment, s.environment),
            isNull(schema.relationDefinitions.deletedAt),
          ),
        ),
    );
  }

  async deleteRelation(relationId: string): Promise<void> {
    await assert('manage_config', { type: 'application' });
    await withTenant(async (tx) => {
      await tx
        .update(schema.relationDefinitions)
        .set({ deletedAt: new Date() })
        .where(eq(schema.relationDefinitions.id, relationId));
    });
    logger.info({ relationId }, 'Relation deleted');
  }

  /**
   * Detect destructive impact of deleting a field/module before applying it
   * (PRD §9.4, §38: detect destructive changes, analyze impact). Returns the
   * list of destructive changes with affected record counts.
   */
  async analyzeFieldDeletion(fieldId: string): Promise<DestructiveChange[]> {
    const s = this.scope();
    return withTenant(async (tx) => {
      const [field] = await tx.select().from(schema.fieldDefinitions).where(eq(schema.fieldDefinitions.id, fieldId));
      if (!field) throw NotFound('Field', fieldId);
      const countRows = await tx
        .select({ value: count() })
        .from(schema.recordValues)
        .where(
          and(
            eq(schema.recordValues.applicationId, s.applicationId),
            eq(schema.recordValues.environment, s.environment),
            eq(schema.recordValues.fieldId, fieldId),
          ),
        );
      const affected = countRows[0]?.value ?? 0;
      return [
        {
          operation: 'delete_field',
          target: `${field.moduleId}.${field.key}`,
          reason: 'Deleting a field permanently discards all stored values for it',
          affectedRecords: Number(affected ?? 0),
        },
      ];
    });
  }

  /**
   * Delete a field. Destructive: requires explicit confirmation (PRD §9.4).
   */
  async deleteField(fieldId: string, opts: { confirm?: boolean } = {}): Promise<DestructiveChange[]> {
    const impact = await this.analyzeFieldDeletion(fieldId);
    const hasData = impact.some((c) => (c.affectedRecords ?? 0) > 0);
    if (hasData && !opts.confirm) {
      throw DestructiveUnconfirmed('delete_field', { impact });
    }
    await assert('manage_config', { type: 'application' });
    await withTenant(async (tx) => {
      await tx.update(schema.fieldDefinitions).set({ deletedAt: new Date() }).where(eq(schema.fieldDefinitions.id, fieldId));
    });
    return impact;
  }

  /**
   * Publish the current draft/env schema as an immutable application version
   * (PRD §38 publish process). Emits schema.published.
   */
  async publish(version: string, changelog?: string): Promise<string> {
    await assert('manage_config', { type: 'application' });
    const s = this.scope();
    return withTenant(async (tx) => {
      const [modules, fields, relations, views, forms, dashboards, pipelines] = await Promise.all([
        tx.select().from(schema.moduleDefinitions).where(scopeWhere(schema.moduleDefinitions, s)),
        tx.select().from(schema.fieldDefinitions).where(scopeWhere(schema.fieldDefinitions, s)),
        tx.select().from(schema.relationDefinitions).where(scopeWhere(schema.relationDefinitions, s)),
        tx.select().from(schema.viewDefinitions).where(scopeWhere(schema.viewDefinitions, s)),
        tx.select().from(schema.formDefinitions).where(scopeWhere(schema.formDefinitions, s)),
        tx.select().from(schema.dashboardDefinitions).where(scopeWhere(schema.dashboardDefinitions, s)),
        tx.select().from(schema.pipelineDefinitions).where(scopeWhere(schema.pipelineDefinitions, s)),
      ]);
      const versionId = newId('deployment');
      await tx.insert(schema.applicationVersions).values({
        id: versionId,
        tenantId: s.tenantId,
        applicationId: s.applicationId,
        version,
        environment: s.environment as never,
        snapshot: { modules, fields, relations, views, forms, dashboards, pipelines },
        changelog,
        publishedAt: new Date(),
        createdBy: getContext().userId,
      });
      await writeEvent(
        tx,
        buildEvent({ type: EVENT_TYPES.schemaPublished, payload: { version, applicationId: s.applicationId } }),
      );
      logger.info({ applicationId: s.applicationId, version }, 'Schema published');
      return versionId;
    });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scopeWhere(table: any, s: { applicationId: string; environment: string }) {
  return and(eq(table.applicationId, s.applicationId), eq(table.environment, s.environment));
}

export const schemaEngine = new SchemaEngine();
