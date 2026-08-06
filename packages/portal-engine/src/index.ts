import { and, eq, schema, withTenant, withElevated } from '@crms/database';
import { newId, newToken, NotFound, Unauthenticated, Forbidden, ValidationError, createLogger } from '@crms/kernel';
import { getContext, buildContext, runWithBuiltContext, type TenantContext } from '@crms/tenant-context';
import { hashPassword, verifyPassword, hashToken } from '@crms/auth';
import { recordsEngine, type Filter } from '@crms/records-engine';

const logger = createLogger('portal-engine');

/**
 * Portal runtime (PRD §19). External users register/login against a specific
 * portal; they can only reach the modules the portal EXPOSES, and only THEIR OWN
 * records (owner = the external user). The portal exposure is the authorization
 * boundary — external users never get tenant RBAC.
 *
 * exposure shape: { modules: [{ moduleId, actions: ['view','create','edit'] }] }
 */
interface Exposure {
  modules: Array<{ moduleId: string; actions: string[] }>;
}

export async function createPortal(input: {
  applicationId: string;
  key: string;
  name: string;
  audience?: string;
  exposure: Exposure;
  branding?: Record<string, unknown>;
  paymentCredentialId?: string;
}): Promise<typeof schema.portalDefinitions.$inferSelect> {
  const ctx = getContext();
  const id = newId('portal');
  return withTenant(async (tx) => {
    await tx.insert(schema.portalDefinitions).values({
      id,
      tenantId: ctx.tenantId,
      applicationId: input.applicationId,
      environment: ctx.environment,
      key: input.key,
      name: input.name,
      audience: input.audience ?? 'clients',
      exposure: input.exposure as never,
      branding: input.branding ?? {},
      paymentCredentialId: input.paymentCredentialId,
      active: true,
      createdBy: ctx.userId,
    });
    const [row] = await tx.select().from(schema.portalDefinitions).where(eq(schema.portalDefinitions.id, id));
    return row!;
  });
}

async function loadPortal(portalId: string): Promise<typeof schema.portalDefinitions.$inferSelect> {
  const portal = await withElevated(async (tx) => {
    const [row] = await tx.select().from(schema.portalDefinitions).where(eq(schema.portalDefinitions.id, portalId));
    return row ?? null;
  });
  if (!portal || !portal.active) throw NotFound('Portal', portalId);
  return portal;
}

/** Register an external portal user (creates a global external user + membership). */
export async function registerPortalUser(portalId: string, input: { email: string; password: string; name?: string }): Promise<{ token: string; userId: string }> {
  const portal = await loadPortal(portalId);
  const passwordHash = await hashPassword(input.password);
  return withElevated(async (tx) => {
    let [user] = await tx.select().from(schema.users).where(eq(schema.users.email, input.email.toLowerCase()));
    if (!user) {
      const id = newId('user');
      await tx.insert(schema.users).values({ id, email: input.email.toLowerCase(), passwordHash, name: input.name, type: 'external' });
      [user] = await tx.select().from(schema.users).where(eq(schema.users.id, id));
    }
    // Ensure a membership so the user resolves within the tenant (no tenant roles).
    const [existing] = await tx.select().from(schema.memberships).where(and(eq(schema.memberships.tenantId, portal.tenantId), eq(schema.memberships.userId, user!.id)));
    if (!existing) {
      await tx.insert(schema.memberships).values({ id: newId('membership'), tenantId: portal.tenantId, userId: user!.id, status: 'active', roleIds: [], acceptedAt: new Date() });
    }
    const token = newToken(32);
    await tx.insert(schema.sessions).values({
      id: newId('session'),
      userId: user!.id,
      tokenHash: hashToken(token),
      activeTenantId: portal.tenantId,
      portalId,
      device: { portal: portalId },
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    logger.info({ portalId, userId: user!.id }, 'Portal user registered');
    return { token, userId: user!.id };
  });
}

export async function loginPortalUser(portalId: string, input: { email: string; password: string }): Promise<{ token: string; userId: string }> {
  const portal = await loadPortal(portalId);
  return withElevated(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.email, input.email.toLowerCase()));
    if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw Unauthenticated('Invalid credentials');
    const token = newToken(32);
    await tx.insert(schema.sessions).values({
      id: newId('session'),
      userId: user.id,
      tokenHash: hashToken(token),
      activeTenantId: portal.tenantId,
      portalId,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    });
    return { token, userId: user.id };
  });
}

/** Resolve a portal session token into a scoped context + the portal. */
export async function resolvePortalSession(token: string): Promise<{ ctx: TenantContext; portal: typeof schema.portalDefinitions.$inferSelect; userId: string }> {
  const result = await withElevated(async (tx) => {
    const [session] = await tx.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.portalId) throw Unauthenticated('Portal session invalid');
    return session;
  });
  const portal = await loadPortal(result.portalId!);
  const ctx = buildContext({
    tenantId: portal.tenantId,
    userId: result.userId,
    applicationId: portal.applicationId,
    environment: portal.environment as never,
    origin: 'portal',
    roleIds: ['__owner__'], // constrained by the portal endpoints below, not RBAC
  });
  return { ctx, portal, userId: result.userId };
}

function assertExposed(portal: typeof schema.portalDefinitions.$inferSelect, moduleId: string, action: string): void {
  const exposure = portal.exposure as Exposure;
  const mod = exposure.modules?.find((m) => m.moduleId === moduleId);
  if (!mod || !mod.actions.includes(action)) throw Forbidden(`This portal does not expose '${action}' on this module`);
}

/** List the portal user's OWN records in an exposed module. */
export async function listPortalRecords(token: string, moduleId: string, filters: Filter[] = []): Promise<unknown[]> {
  const { ctx, portal, userId } = await resolvePortalSession(token);
  assertExposed(portal, moduleId, 'view');
  return runWithBuiltContext(ctx, async () => {
    const page = await recordsEngine.list({ moduleId, filters: [...filters, { field: 'owner', operator: 'eq', value: userId }] });
    return page.items;
  }) as Promise<unknown[]>;
}

/** Create a record as the portal user (owned by them) in an exposed module. */
export async function createPortalRecord(token: string, moduleId: string, data: Record<string, unknown>): Promise<{ recordId: string }> {
  const { ctx, portal, userId } = await resolvePortalSession(token);
  assertExposed(portal, moduleId, 'create');
  if (!moduleId) throw ValidationError('moduleId required');
  return runWithBuiltContext(ctx, async () => {
    const rec = await recordsEngine.create({ moduleId, data, ownerUserId: userId });
    return { recordId: rec.id };
  }) as Promise<{ recordId: string }>;
}
