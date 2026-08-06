import { pgTable, text, jsonb, boolean, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import { fieldTypeEnum, relationTypeEnum, onDeleteEnum } from './enums';

/**
 * Builder definitions are the METADATA that describes each application's data
 * model (PRD §11.1 hybrid strategy). Structural definitions live in relational
 * tables (these); the dynamic records they describe live in the EAV tables and
 * are only ever queried through the Query Engine.
 *
 * All of these are scoped to (tenant_id, application_id, environment) so the
 * same logical module can differ between draft/dev/test/staging/prod.
 */

export const moduleDefinitions = pgTable(
  'module_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    namePlural: text('name_plural'),
    icon: text('icon'),
    color: text('color'),
    description: text('description'),
    /** Display field used in relation pickers + record titles. */
    primaryFieldId: text('primary_field_id'),
    /** Ordering + grouping in the app navigation. */
    position: integer('position').notNull().default(0),
    settings: jsonb('settings').notNull().default({}),
    enableComments: boolean('enable_comments').notNull().default(true),
    enableActivity: boolean('enable_activity').notNull().default(true),
    enableVersioning: boolean('enable_versioning').notNull().default(true),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('module_defs_scope_key_idx').on(t.tenantId, t.applicationId, t.environment, t.key),
    index('module_defs_app_idx').on(t.tenantId, t.applicationId, t.environment),
  ],
);

export const fieldDefinitions = pgTable(
  'field_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    moduleId: text('module_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    type: fieldTypeEnum('type').notNull(),
    required: boolean('required').notNull().default(false),
    unique: boolean('unique').notNull().default(false),
    indexed: boolean('indexed').notNull().default(false),
    defaultValue: jsonb('default_value'),
    /** Type-specific config: options for select, precision for decimal, formula
     *  expression, rollup target, relation target module, etc. */
    config: jsonb('config').notNull().default({}),
    /** Validation rules evaluated by the records engine. */
    validations: jsonb('validations').notNull().default([]),
    /** Field-level permission overrides (PRD §18). */
    permissions: jsonb('permissions').notNull().default({}),
    position: integer('position').notNull().default(0),
    helpText: text('help_text'),
    isSystem: boolean('is_system').notNull().default(false),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('field_defs_scope_key_idx').on(t.moduleId, t.key),
    index('field_defs_module_idx').on(t.tenantId, t.applicationId, t.environment, t.moduleId),
  ],
);

export const relationDefinitions = pgTable(
  'relation_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    type: relationTypeEnum('type').notNull(),
    sourceModuleId: text('source_module_id').notNull(),
    targetModuleId: text('target_module_id').notNull(),
    /** For polymorphic: allowed target module ids. */
    polymorphicTargets: jsonb('polymorphic_targets').notNull().default([]),
    onDelete: onDeleteEnum('on_delete').notNull().default('restrict'),
    /** Inverse relation display config. */
    inverseName: text('inverse_name'),
    required: boolean('required').notNull().default(false),
    config: jsonb('config').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    index('relation_defs_source_idx').on(t.sourceModuleId),
    index('relation_defs_target_idx').on(t.targetModuleId),
    uniqueIndex('relation_defs_scope_key_idx').on(t.tenantId, t.applicationId, t.environment, t.key),
  ],
);

export const viewDefinitions = pgTable(
  'view_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    moduleId: text('module_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** table | list | kanban | calendar | agenda | timeline | gantt | map |
     *  gallery | chart | form | record | cards | tree | matrix | workload */
    type: text('type').notNull(),
    config: jsonb('config').notNull().default({}),
    filters: jsonb('filters').notNull().default([]),
    sorts: jsonb('sorts').notNull().default([]),
    grouping: jsonb('grouping').notNull().default({}),
    visibleFieldIds: jsonb('visible_field_ids').notNull().default([]),
    permissions: jsonb('permissions').notNull().default({}),
    isDefault: boolean('is_default').notNull().default(false),
    isShared: boolean('is_shared').notNull().default(true),
    ownerUserId: text('owner_user_id'),
    position: integer('position').notNull().default(0),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('view_defs_module_idx').on(t.moduleId)],
);

export const formDefinitions = pgTable(
  'form_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    moduleId: text('module_id'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** internal | public | embed | portal | multi_step | survey | approval */
    kind: text('kind').notNull().default('internal'),
    layout: jsonb('layout').notNull().default({}),
    fields: jsonb('fields').notNull().default([]),
    conditionalLogic: jsonb('conditional_logic').notNull().default([]),
    settings: jsonb('settings').notNull().default({}),
    /** Public forms get a slug + CAPTCHA + dedup config. */
    publicSlug: text('public_slug'),
    captchaEnabled: boolean('captcha_enabled').notNull().default(false),
    dedupeConfig: jsonb('dedupe_config').notNull().default({}),
    redirectUrl: text('redirect_url'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    index('form_defs_module_idx').on(t.moduleId),
    uniqueIndex('form_defs_public_slug_idx').on(t.publicSlug),
  ],
);

export const dashboardDefinitions = pgTable(
  'dashboard_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    widgets: jsonb('widgets').notNull().default([]),
    filters: jsonb('filters').notNull().default([]),
    permissions: jsonb('permissions').notNull().default({}),
    isShared: boolean('is_shared').notNull().default(false),
    ownerUserId: text('owner_user_id'),
    /** Scheduled email delivery config (PRD §22). */
    schedule: jsonb('schedule').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('dashboard_defs_app_idx').on(t.tenantId, t.applicationId, t.environment)],
);

/**
 * Pipelines / processes (PRD §15). A pipeline defines stages, valid transitions,
 * required fields per stage, permissions per transition, SLAs, and loss reasons.
 */
export const pipelineDefinitions = pgTable(
  'pipeline_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    moduleId: text('module_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    stages: jsonb('stages').notNull().default([]),
    transitions: jsonb('transitions').notNull().default([]),
    /** Field id that holds the current stage on each record. */
    stageFieldId: text('stage_field_id'),
    settings: jsonb('settings').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('pipeline_defs_module_idx').on(t.moduleId)],
);
