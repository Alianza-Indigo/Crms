import { and, eq, schema, withElevated } from '@crms/database';
import { newId, newToken, Unauthenticated, Forbidden, createLogger } from '@crms/kernel';
import { buildContext, type TenantContext } from '@crms/tenant-context';
import { hashToken } from './token.js';

const logger = createLogger('auth:apikey');

/**
 * API keys (PRD §29). A key is `crms_<prefix>_<secret>`. Only the secret's hash
 * is stored; the plaintext is shown once at creation. Keys are bound to a
 * service account (the permission subject), carry scopes, and are revocable +
 * expiring + IP-restrictable.
 */
export interface CreateApiKeyInput {
  tenantId: string;
  applicationId?: string | null;
  serviceAccountId: string;
  name: string;
  scopes?: string[];
  allowedIps?: string[];
  expiresAt?: Date | null;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<{ id: string; token: string; prefix: string }> {
  const prefix = newToken(6).slice(0, 8);
  const secret = newToken(24);
  const token = `crms_${prefix}_${secret}`;
  const id = newId('apikey');
  await withElevated(async (tx) => {
    await tx.insert(schema.apiKeys).values({
      id,
      tenantId: input.tenantId,
      applicationId: input.applicationId ?? null,
      serviceAccountId: input.serviceAccountId,
      name: input.name,
      prefix,
      keyHash: hashToken(secret),
      scopes: input.scopes ?? [],
      allowedIps: input.allowedIps ?? [],
      expiresAt: input.expiresAt ?? null,
    });
  });
  logger.info({ apiKeyId: id, prefix }, 'API key created');
  return { id, token, prefix };
}

export function isApiKey(token: string): boolean {
  return token.startsWith('crms_');
}

/** Resolve an API key into a service-account tenant context (PRD §5.9, §29). */
export async function resolveApiKeyContext(token: string, opts: { ip?: string; correlationId?: string } = {}): Promise<TenantContext> {
  const parts = token.split('_');
  if (parts.length !== 3) throw Unauthenticated('Malformed API key');
  const [, prefix, secret] = parts as [string, string, string];

  return withElevated(async (tx) => {
    const [key] = await tx.select().from(schema.apiKeys).where(eq(schema.apiKeys.prefix, prefix));
    if (!key || key.revokedAt || key.keyHash !== hashToken(secret)) throw Unauthenticated('Invalid API key');
    if (key.expiresAt && key.expiresAt < new Date()) throw Unauthenticated('API key expired');
    if (!key.serviceAccountId) throw Unauthenticated('API key has no service account');
    const allowed = key.allowedIps as string[];
    if (allowed.length && opts.ip && !allowed.includes(opts.ip)) throw Forbidden('API key not permitted from this IP');

    const [sa] = await tx
      .select()
      .from(schema.serviceAccounts)
      .where(and(eq(schema.serviceAccounts.id, key.serviceAccountId), eq(schema.serviceAccounts.active, true)));
    if (!sa) throw Unauthenticated('API key service account is inactive');

    await tx.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, key.id));

    return buildContext({
      tenantId: key.tenantId,
      serviceAccountId: sa.id,
      applicationId: key.applicationId,
      roleIds: sa.roleIds as string[],
      origin: 'api',
      correlationId: opts.correlationId,
    });
  });
}
