import { pgTable, text, jsonb, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { lifecycleColumns, actorColumns } from './_shared';
import { credentialStatusEnum, authTypeEnum, environmentEnum } from './enums';

/**
 * Credential (PRD §10). This table holds ONLY non-secret metadata. The encrypted
 * secret value lives in a separate table (credentialSecrets) so the metadata can
 * be read freely while the secret is decrypted only during authorized execution
 * (PRD §10.5 — separation of metadata and secret values).
 */
export const credentials = pgTable(
  'credentials',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Null applicationId = tenant-level credential (can be inherited by apps). */
    applicationId: text('application_id'),
    environment: environmentEnum('environment'),
    /** Logical name used in deployment variables, e.g. OPENAI_CREDENTIAL_ID. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    /** Provider slug: openai | anthropic | stripe | whatsapp | gmail | ... */
    provider: text('provider').notNull(),
    authType: authTypeEnum('auth_type').notNull(),
    status: credentialStatusEnum('status').notNull().default('pending'),
    /** Non-secret connection metadata: endpoint, region, account label, scopes. */
    metadata: jsonb('metadata').notNull().default({}),
    scopes: jsonb('scopes').notNull().default([]),
    /** Connected account label shown to the user (e.g. the email). Never secret. */
    accountLabel: text('account_label'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastError: text('last_error'),
    connectedBy: text('connected_by'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    index('credentials_tenant_idx').on(t.tenantId),
    uniqueIndex('credentials_scope_key_idx').on(t.tenantId, t.applicationId, t.environment, t.key),
    index('credentials_provider_idx').on(t.tenantId, t.provider),
  ],
);

/**
 * Encrypted secret material, versioned (PRD §10.5 — versionado de secretos).
 * `ciphertext` is envelope-encrypted (data key wrapped by the platform master
 * key). This table is NEVER selected by feature code; only the credential-engine
 * reads it, inside an authorized decrypt path, and never returns plaintext to
 * the API/frontend/AI/logs/exports (PRD §10.4).
 */
export const credentialSecrets = pgTable(
  'credential_secrets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    credentialId: text('credential_id').notNull(),
    version: text('version').notNull(),
    /** Base64 IV + authTag + wrapped data key + ciphertext (opaque blob). */
    ciphertext: text('ciphertext').notNull(),
    /** Which master key version wrapped the data key (for rotation). */
    keyVersion: text('key_version').notNull().default('1'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (t) => [
    index('credential_secrets_cred_idx').on(t.credentialId, t.active),
    uniqueIndex('credential_secrets_version_idx').on(t.credentialId, t.version),
  ],
);

/**
 * CredentialAssignment (PRD §10, §11.2). Binds a credential to a consumer
 * (automation, agent, integration, portal) so dependency analysis + revocation
 * impact can be computed.
 */
export const credentialAssignments = pgTable(
  'credential_assignments',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id'),
    environment: environmentEnum('environment'),
    credentialId: text('credential_id').notNull(),
    /** consumer type: automation | agent | integration | portal | form | document */
    consumerType: text('consumer_type').notNull(),
    consumerId: text('consumer_id').notNull(),
    /** Logical variable name the consumer references, e.g. {{STRIPE_CREDENTIAL_ID}}. */
    variableName: text('variable_name'),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [
    index('credential_assignments_cred_idx').on(t.credentialId),
    uniqueIndex('credential_assignments_unique_idx').on(t.credentialId, t.consumerType, t.consumerId),
  ],
);

/**
 * IntegrationConnection (PRD §17). A configured connector to an external REST
 * API or official integration, referencing a credential by id.
 */
export const integrationConnections = pgTable(
  'integration_connections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    key: text('key').notNull(),
    name: text('name').notNull(),
    provider: text('provider').notNull(),
    credentialId: text('credential_id'),
    /** Connector definition: base url, endpoints, headers, pagination, mapping. */
    definition: jsonb('definition').notNull().default({}),
    rateLimits: jsonb('rate_limits').notNull().default({}),
    active: boolean('active').notNull().default(true),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('integrations_app_idx').on(t.tenantId, t.applicationId, t.environment)],
);

/** External database connections used ONLY by the Federated Query Engine (§17.1). */
export const federatedConnections = pgTable(
  'federated_connections',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    name: text('name').notNull(),
    /** postgres | mysql | mssql | ... */
    driver: text('driver').notNull(),
    credentialId: text('credential_id').notNull(),
    /** Non-secret connection metadata (host/db); password is in the credential. */
    metadata: jsonb('metadata').notNull().default({}),
    maxRows: text('max_rows').notNull().default('1000'),
    timeoutMs: text('timeout_ms').notNull().default('5000'),
    /** Column masking rules applied to sensitive columns. */
    maskingRules: jsonb('masking_rules').notNull().default([]),
    active: boolean('active').notNull().default(true),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('federated_connections_app_idx').on(t.tenantId, t.applicationId, t.environment)],
);

/**
 * AgentDefinition (PRD §23). A tenant-defined AI agent bound to a BYO credential,
 * a set of tools/modules, permissions, budget and human-review policy. Agents are
 * subject to the SAME permission checks as users/service accounts.
 */
export const agentDefinitions = pgTable(
  'agent_definitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    environment: text('environment').notNull().default('production'),
    name: text('name').notNull(),
    purpose: text('purpose'),
    instructions: text('instructions'),
    provider: text('provider').notNull().default('openai'),
    model: text('model'),
    credentialId: text('credential_id'),
    /** Which service account identity the agent acts as (permission subject). */
    serviceAccountId: text('service_account_id'),
    tools: jsonb('tools').notNull().default([]),
    accessibleModuleIds: jsonb('accessible_module_ids').notNull().default([]),
    allowedActions: jsonb('allowed_actions').notNull().default([]),
    memoryConfig: jsonb('memory_config').notNull().default({}),
    triggers: jsonb('triggers').notNull().default([]),
    limits: jsonb('limits').notNull().default({}),
    budget: jsonb('budget').notNull().default({}),
    schedule: jsonb('schedule').notNull().default({}),
    requireHumanReview: boolean('require_human_review').notNull().default(true),
    active: boolean('active').notNull().default(true),
    ...actorColumns,
    ...lifecycleColumns,
  },
  (t) => [index('agent_defs_app_idx').on(t.tenantId, t.applicationId, t.environment)],
);
