import { pgTable, text, jsonb, boolean, timestamp, index, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import { automationStatusEnum, runStatusEnum } from './enums';

/**
 * AutomationDefinition (PRD §16). A visual flow: trigger → filters → conditions
 * → branches → actions → waits → approvals → integrations. Versioned; executed
 * asynchronously by the worker off the request path.
 */
export const automationDefinitions = pgTable(
  'automation_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: automationStatusEnum('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    trigger: jsonb('trigger').notNull().default({}),
    /** Ordered graph of steps (filters/conditions/branches/actions/waits). */
    graph: jsonb('graph').notNull().default({ nodes: [], edges: [] }),
    /** Concurrency + loop-prevention config (PRD §16.4). */
    maxConcurrency: integer('max_concurrency').notNull().default(5),
    /** Guards against infinite automation cycles. */
    loopGuard: jsonb('loop_guard').notNull().default({ maxDepth: 10 }),
    timeoutSeconds: integer('timeout_seconds').notNull().default(300),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('automation_defs_app_idx').on(t.tenantId, t.applicationId, t.environment, t.status)],
);

/**
 * AutomationRun (PRD §16.4). One execution instance with full step history,
 * retries, idempotency key, and status for replay/pause/resume/cancel.
 */
export const automationRuns = pgTable(
  'automation_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    automationId: text('automation_id').notNull(),
    automationVersion: integer('automation_version').notNull(),
    status: runStatusEnum('status').notNull().default('queued'),
    triggerEvent: jsonb('trigger_event').notNull().default({}),
    /** Depth counter for cycle prevention across chained automations. */
    depth: integer('depth').notNull().default(0),
    idempotencyKey: text('idempotency_key'),
    context: jsonb('context').notNull().default({}),
    stepHistory: jsonb('step_history').notNull().default([]),
    attempts: integer('attempts').notNull().default(0),
    error: jsonb('error'),
    correlationId: text('correlation_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    resumeAt: timestamp('resume_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...lifecycleColumns,
  },
  (t) => [
    index('automation_runs_status_idx').on(t.tenantId, t.status),
    index('automation_runs_automation_idx').on(t.automationId),
    index('automation_runs_resume_idx').on(t.resumeAt),
  ],
);

/**
 * DocumentTemplate (PRD §21). Designs documents (quotes, contracts, invoices…)
 * with variables, repeatable blocks, totals, formulas, QR, signatures and AI.
 */
export const documentTemplates = pgTable(
  'document_templates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('document'),
    /** Template body (HTML/handlebars-like) + block definitions. */
    body: jsonb('body').notNull().default({}),
    /** Output targets: pdf | docx | email | storage | signature | webhook. */
    outputs: jsonb('outputs').notNull().default(['pdf']),
    moduleId: text('module_id'),
    settings: jsonb('settings').notNull().default({}),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('document_templates_app_idx').on(t.tenantId, t.applicationId, t.environment)],
);

/** Generated documents (instances) — metadata; the file lives in storage. */
export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    templateId: text('template_id').notNull(),
    recordId: text('record_id'),
    fileId: text('file_id'),
    status: text('status').notNull().default('generating'),
    signatureStatus: text('signature_status'),
    idempotencyKey: text('idempotency_key'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('generated_documents_template_idx').on(t.templateId)],
);

/**
 * DocumentSignature (PRD §21). One signer's e-signature request for a generated
 * document. A one-time token authorizes a public sign page; the signature data
 * (typed name or drawn image) + audit fields are recorded on completion.
 */
export const documentSignatures = pgTable(
  'document_signatures',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    documentId: text('document_id').notNull(),
    signerEmail: text('signer_email').notNull(),
    signerName: text('signer_name'),
    token: text('token').notNull(),
    status: text('status').notNull().default('pending'), // pending | signed | declined
    signatureData: text('signature_data'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    ip: text('ip'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    uniqueIndex('document_signatures_token_idx').on(t.token),
    index('document_signatures_doc_idx').on(t.documentId),
  ],
);

/**
 * PortalDefinition (PRD §19). External-facing portal with its own domain,
 * branding, auth, and strictly-scoped resource access for external users.
 */
export const portalDefinitions = pgTable(
  'portal_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** clients | patients | students | suppliers | ... */
    audience: text('audience').notNull().default('clients'),
    branding: jsonb('branding').notNull().default({}),
    domainId: text('domain_id'),
    /** Which modules/views/forms are exposed and under what permissions. */
    exposure: jsonb('exposure').notNull().default({}),
    authConfig: jsonb('auth_config').notNull().default({}),
    /** Credential used for portal payments (tenant's own, PRD §19). */
    paymentCredentialId: text('payment_credential_id'),
    active: boolean('active').notNull().default(false),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('portal_defs_app_idx').on(t.tenantId, t.applicationId, t.environment)],
);
