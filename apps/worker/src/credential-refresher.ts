import { and, eq, inArray, lte, schema, withElevated } from '@crms/database';
import { createLogger } from '@crms/kernel';
import { buildContext, runWithBuiltContext } from '@crms/tenant-context';
import { credentialManager } from '@crms/credential-engine';
import { audit } from '@crms/audit';

const logger = createLogger('worker:credential-refresh');

/**
 * Credential Manager refresh worker (PRD §10.6). Finds OAuth credentials nearing
 * expiry and refreshes them BEFORE they expire. On failure it marks the
 * credential invalid, audits it, and PAUSES dependent automations so they don't
 * run with a broken credential. It NEVER falls back to a global/other-tenant
 * credential (PRD §10.11).
 */
const REFRESH_WINDOW_MS = 10 * 60 * 1000; // refresh when <10 min to expiry

export async function refreshExpiringCredentials(): Promise<number> {
  const due = await withElevated(async (tx) =>
    tx
      .select()
      .from(schema.credentials)
      .where(
        and(
          eq(schema.credentials.status, 'active'),
          inArray(schema.credentials.authType, ['oauth2', 'oauth2_refresh']),
          lte(schema.credentials.expiresAt, new Date(Date.now() + REFRESH_WINDOW_MS)),
        ),
      )
      .limit(25),
  );
  if (due.length === 0) return 0;

  for (const cred of due) {
    const ctx = buildContext({
      tenantId: cred.tenantId,
      applicationId: cred.applicationId,
      environment: (cred.environment as never) ?? 'production',
      origin: 'worker',
      roleIds: ['__owner__'],
    });
    await runWithBuiltContext(ctx, () => refreshOne(cred.id));
  }
  return due.length;
}

async function refreshOne(credentialId: string): Promise<void> {
  try {
    const { secret, credential } = await credentialManager.useSecret({ credentialId });
    const meta = credential.metadata as Record<string, unknown>;
    const tokenUrl = String(meta.tokenUrl ?? meta.token_endpoint ?? '');
    const refreshToken = secret.refreshToken as string | undefined;
    if (!tokenUrl || !refreshToken) {
      logger.warn({ credentialId }, 'Missing tokenUrl/refreshToken; cannot refresh');
      return;
    }

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: String(secret.clientId ?? meta.clientId ?? ''),
        client_secret: String(secret.clientSecret ?? ''),
      }),
    });

    if (!res.ok) {
      await markInvalidAndPause(credentialId, `refresh failed HTTP ${res.status}`);
      return;
    }
    const tokens = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    await credentialManager.rotate(credentialId, {
      ...secret,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? refreshToken,
    });
    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;
    await withElevated(async (tx) => {
      await tx.update(schema.credentials).set({ expiresAt }).where(eq(schema.credentials.id, credentialId));
    });
    logger.info({ credentialId }, 'OAuth credential refreshed');
  } catch (err) {
    await markInvalidAndPause(credentialId, err instanceof Error ? err.message : 'refresh error');
  }
}

async function markInvalidAndPause(credentialId: string, reason: string): Promise<void> {
  await withElevated(async (tx) => {
    await tx
      .update(schema.credentials)
      .set({ status: 'invalid', lastError: reason })
      .where(eq(schema.credentials.id, credentialId));

    // Pause automations that depend on this credential (PRD §10.6).
    const deps = await tx
      .select()
      .from(schema.credentialAssignments)
      .where(
        and(
          eq(schema.credentialAssignments.credentialId, credentialId),
          eq(schema.credentialAssignments.consumerType, 'automation'),
        ),
      );
    if (deps.length) {
      await tx
        .update(schema.automationDefinitions)
        .set({ status: 'paused' })
        .where(inArray(schema.automationDefinitions.id, deps.map((d) => d.consumerId)));
    }
  });
  await audit({ action: 'credential.invalidated', resourceType: 'credential', resourceId: credentialId, metadata: { reason } });
  logger.warn({ credentialId, reason }, 'Credential marked invalid; dependent automations paused');
}
