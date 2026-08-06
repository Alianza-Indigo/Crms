import { and, eq, count, schema, withTenant } from '@crms/database';
import { newId, NotFound, ValidationError, Conflict, DestructiveUnconfirmed, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { buildEvent, EVENT_TYPES } from '@crms/events';
import { writeEvent } from '@crms/outbox';
import {
  ModuleInputSchema,
  FieldInputSchema,
  RelationInputSchema,
  type ModuleInput,
  type FieldInput,
  type RelationInput,
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
          ),
        ),
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
      tx.select().from(schema.fieldDefinitions).where(eq(schema.fieldDefinitions.moduleId, moduleId)),
    );
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
