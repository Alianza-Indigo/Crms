import { and, eq, isNull, withTenant, schema, type DbExecutor } from '@crms/database';
import { newId, NotFound, ValidationError, AppError, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import type { Environment } from '@crms/config';
import { encryptSecret, decryptSecret } from './crypto.js';
import { getProviderValidator } from './providers.js';

const logger = createLogger('credential-engine');

/**
 * Public (safe) representation of a credential. NEVER contains the secret value
 * (PRD §10.4: secrets are never sent to the frontend after saving).
 */
export interface CredentialPublic {
  id: string;
  key: string;
  name: string;
  provider: string;
  authType: string;
  status: string;
  applicationId: string | null;
  environment: string | null;
  accountLabel: string | null;
  scopes: unknown;
  metadata: Record<string, unknown>;
  lastValidatedAt: Date | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export interface CreateCredentialInput {
  key: string;
  name: string;
  provider: string;
  authType: (typeof schema.authTypeEnum.enumValues)[number];
  applicationId?: string | null;
  environment?: Environment | null;
  /** The raw secret material (api key, token set, etc). Encrypted immediately. */
  secret: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  scopes?: string[];
  accountLabel?: string;
}

function toPublic(row: typeof schema.credentials.$inferSelect): CredentialPublic {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    provider: row.provider,
    authType: row.authType,
    status: row.status,
    applicationId: row.applicationId,
    environment: row.environment,
    accountLabel: row.accountLabel,
    scopes: row.scopes,
    metadata: row.metadata as Record<string, unknown>,
    lastValidatedAt: row.lastValidatedAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  };
}

export class CredentialManager {
  /**
   * Create + validate a credential (PRD §10.8). The secret is validated against
   * the provider with a NON-destructive probe, encrypted, and stored separately
   * from metadata. Only public metadata is returned.
   */
  async create(input: CreateCredentialInput): Promise<CredentialPublic> {
    const ctx = getContext();
    const validator = getProviderValidator(input.provider);
    const validation = await validator.validate({
      authType: input.authType,
      secret: input.secret,
      metadata: input.metadata ?? {},
    });
    if (!validation.ok) {
      throw new AppError('CREDENTIAL_INVALID', `Credential validation failed: ${validation.reason}`, {
        details: { provider: input.provider, missingScopes: validation.missingScopes },
      });
    }

    const credentialId = newId('credential');
    const { ciphertext, keyVersion } = encryptSecret(JSON.stringify(input.secret));

    return withTenant(async (tx) => {
      await tx.insert(schema.credentials).values({
        id: credentialId,
        tenantId: ctx.tenantId,
        applicationId: input.applicationId ?? null,
        environment: input.environment ?? null,
        key: input.key,
        name: input.name,
        provider: input.provider,
        authType: input.authType,
        status: 'active',
        metadata: input.metadata ?? {},
        scopes: input.scopes ?? validation.scopes ?? [],
        accountLabel: input.accountLabel ?? validation.accountLabel ?? null,
        lastValidatedAt: new Date(),
        connectedBy: ctx.userId ?? ctx.serviceAccountId,
        createdBy: ctx.userId ?? ctx.serviceAccountId,
      });
      await tx.insert(schema.credentialSecrets).values({
        id: newId('credential'),
        tenantId: ctx.tenantId,
        credentialId,
        version: '1',
        ciphertext,
        keyVersion,
        active: true,
      });
      const [row] = await tx
        .select()
        .from(schema.credentials)
        .where(eq(schema.credentials.id, credentialId));
      logger.info({ credentialId, provider: input.provider }, 'Credential created');
      return toPublic(row!);
    });
  }

  /** List credentials (metadata only) for the current tenant/application scope. */
  async list(applicationId?: string | null): Promise<CredentialPublic[]> {
    return withTenant(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.credentials)
        .where(
          applicationId === undefined
            ? undefined
            : applicationId === null
              ? isNull(schema.credentials.applicationId)
              : eq(schema.credentials.applicationId, applicationId),
        );
      return rows.filter((r) => !r.deletedAt).map(toPublic);
    });
  }

  async get(credentialId: string): Promise<CredentialPublic> {
    return withTenant(async (tx) => {
      const [row] = await tx.select().from(schema.credentials).where(eq(schema.credentials.id, credentialId));
      if (!row || row.deletedAt) throw NotFound('Credential', credentialId);
      return toPublic(row);
    });
  }

  /**
   * Resolve the DECRYPTED secret for authorized execution (PRD §10.5). This is
   * the ONLY method that returns plaintext, it is used exclusively by the
   * execution layer (integration/ai/automation runners), it records last_used,
   * and it must never be exposed via an API route.
   *
   * Credential resolution honors inheritance: an application-scoped credential
   * overrides a tenant-scoped one for the same logical key (PRD §10.3).
   */
  async useSecret(resolve: {
    key?: string;
    credentialId?: string;
    applicationId?: string | null;
    environment?: Environment;
  }): Promise<{ credential: CredentialPublic; secret: Record<string, unknown> }> {
    const ctx = getContext();
    return withTenant(async (tx) => {
      const cred = await this.resolveCredentialRow(tx, resolve, ctx.applicationId, ctx.environment);
      if (cred.status !== 'active') {
        throw new AppError('CREDENTIAL_INVALID', `Credential '${cred.key}' is ${cred.status}`, {
          details: { credentialId: cred.id, status: cred.status },
        });
      }
      const [secretRow] = await tx
        .select()
        .from(schema.credentialSecrets)
        .where(
          and(
            eq(schema.credentialSecrets.credentialId, cred.id),
            eq(schema.credentialSecrets.active, true),
          ),
        );
      if (!secretRow) throw new AppError('CREDENTIAL_MISSING', `No secret stored for credential '${cred.key}'`);

      const plaintext = decryptSecret(secretRow.ciphertext);
      await tx
        .update(schema.credentials)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.credentials.id, cred.id));

      return { credential: toPublic(cred), secret: JSON.parse(plaintext) as Record<string, unknown> };
    });
  }

  private async resolveCredentialRow(
    tx: DbExecutor,
    resolve: { key?: string; credentialId?: string; applicationId?: string | null; environment?: Environment },
    ctxAppId: string | null,
    ctxEnv: Environment,
  ): Promise<typeof schema.credentials.$inferSelect> {
    if (resolve.credentialId) {
      const [row] = await tx.select().from(schema.credentials).where(eq(schema.credentials.id, resolve.credentialId));
      if (!row) throw NotFound('Credential', resolve.credentialId);
      return row;
    }
    if (!resolve.key) throw ValidationError('Provide either credentialId or key to resolve a credential');

    const appId = resolve.applicationId ?? ctxAppId;
    const env = resolve.environment ?? ctxEnv;
    const rows = await tx.select().from(schema.credentials).where(eq(schema.credentials.key, resolve.key));
    const active = rows.filter((r) => !r.deletedAt);
    // Prefer the most specific match: app+env > app > tenant.
    const appEnv = active.find((r) => r.applicationId === appId && r.environment === env);
    const app = active.find((r) => r.applicationId === appId && !r.environment);
    const tenant = active.find((r) => !r.applicationId);
    const chosen = appEnv ?? app ?? tenant;
    if (!chosen) throw new AppError('CREDENTIAL_MISSING', `No credential found for key '${resolve.key}'`);
    return chosen;
  }

  /** Rotate the secret material without changing the credential identity (§10.10). */
  async rotate(credentialId: string, newSecret: Record<string, unknown>): Promise<CredentialPublic> {
    const ctx = getContext();
    const { ciphertext, keyVersion } = encryptSecret(JSON.stringify(newSecret));
    return withTenant(async (tx) => {
      const [cred] = await tx.select().from(schema.credentials).where(eq(schema.credentials.id, credentialId));
      if (!cred) throw NotFound('Credential', credentialId);
      const current = await tx
        .select()
        .from(schema.credentialSecrets)
        .where(and(eq(schema.credentialSecrets.credentialId, credentialId), eq(schema.credentialSecrets.active, true)));
      const nextVersion = String(current.length + 1);
      await tx
        .update(schema.credentialSecrets)
        .set({ active: false, rotatedAt: new Date() })
        .where(eq(schema.credentialSecrets.credentialId, credentialId));
      await tx.insert(schema.credentialSecrets).values({
        id: newId('credential'),
        tenantId: ctx.tenantId,
        credentialId,
        version: nextVersion,
        ciphertext,
        keyVersion,
        active: true,
      });
      await tx
        .update(schema.credentials)
        .set({ status: 'active', lastValidatedAt: new Date(), updatedBy: ctx.userId })
        .where(eq(schema.credentials.id, credentialId));
      const [row] = await tx.select().from(schema.credentials).where(eq(schema.credentials.id, credentialId));
      logger.info({ credentialId, version: nextVersion }, 'Credential rotated');
      return toPublic(row!);
    });
  }

  /** Revoke: future executions using this credential fail immediately (§10.10, §10.11). */
  async revoke(credentialId: string): Promise<void> {
    await withTenant(async (tx) => {
      await tx
        .update(schema.credentials)
        .set({ status: 'revoked' })
        .where(eq(schema.credentials.id, credentialId));
      await tx
        .update(schema.credentialSecrets)
        .set({ active: false })
        .where(eq(schema.credentialSecrets.credentialId, credentialId));
    });
    logger.info({ credentialId }, 'Credential revoked');
  }

  /** Dependency analysis (PRD §10.10): what consumes this credential. */
  async dependencies(credentialId: string): Promise<Array<{ consumerType: string; consumerId: string }>> {
    return withTenant(async (tx) => {
      const rows = await tx
        .select()
        .from(schema.credentialAssignments)
        .where(eq(schema.credentialAssignments.credentialId, credentialId));
      return rows.map((r) => ({ consumerType: r.consumerType, consumerId: r.consumerId }));
    });
  }

  /** Assign a credential to a consumer for dependency tracking + revocation impact. */
  async assign(input: {
    credentialId: string;
    consumerType: string;
    consumerId: string;
    variableName?: string;
    applicationId?: string | null;
    environment?: Environment | null;
  }): Promise<void> {
    const ctx = getContext();
    await withTenant(async (tx) => {
      await tx
        .insert(schema.credentialAssignments)
        .values({
          id: newId('credential'),
          tenantId: ctx.tenantId,
          applicationId: input.applicationId ?? null,
          environment: input.environment ?? null,
          credentialId: input.credentialId,
          consumerType: input.consumerType,
          consumerId: input.consumerId,
          variableName: input.variableName,
          createdBy: ctx.userId,
        })
        .onConflictDoNothing();
    });
  }
}

export const credentialManager = new CredentialManager();
