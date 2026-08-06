import { and, eq, schema, withElevated } from '@crms/database';
import { loadEnv } from '@crms/config';
import { newId, newToken, Unauthenticated, Forbidden, ValidationError, NotFound, createLogger } from '@crms/kernel';
import { runWithBuiltContext, buildContext, type TenantContext } from '@crms/tenant-context';
import { audit } from '@crms/audit';
import { hashPassword, verifyPassword, validatePasswordPolicy } from './password.js';
import { hashToken } from './token.js';

const logger = createLogger('auth');

/**
 * Auth service. Users are global; tenant authorization comes from memberships.
 * Sessions are revocable and carry optional impersonation identity with a hard
 * expiry (PRD §32.1, §32.5). All security-relevant actions are audited.
 *
 * NOTE: user/session/membership access uses elevated (RLS-bypassing) writes
 * because these run BEFORE a tenant context exists; the service itself scopes
 * every query by explicit ids.
 */
export interface SessionResult {
  token: string;
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  expiresAt: Date;
}

export class AuthService {
  async register(input: { email: string; password: string; name?: string }): Promise<string> {
    const policy = validatePasswordPolicy(input.password);
    if (!policy.ok) throw ValidationError(policy.reason!);
    const passwordHash = await hashPassword(input.password);
    const userId = newId('user');
    await withElevated(async (tx) => {
      const existing = await tx.select().from(schema.users).where(eq(schema.users.email, input.email.toLowerCase()));
      if (existing.length) throw ValidationError('An account with this email already exists');
      await tx.insert(schema.users).values({
        id: userId,
        email: input.email.toLowerCase(),
        passwordHash,
        name: input.name,
        type: 'internal',
      });
    });
    logger.info({ userId }, 'User registered');
    return userId;
  }

  async login(input: {
    email: string;
    password: string;
    device?: Record<string, unknown>;
    ip?: string;
  }): Promise<SessionResult> {
    return withElevated(async (tx) => {
      const [user] = await tx.select().from(schema.users).where(eq(schema.users.email, input.email.toLowerCase()));
      if (!user || !user.passwordHash) throw Unauthenticated('Invalid credentials');
      if (user.lockedUntil && user.lockedUntil > new Date()) throw Forbidden('Account is temporarily locked');

      const ok = await verifyPassword(input.password, user.passwordHash);
      if (!ok) {
        const attempts = Number(user.failedLoginAttempts) + 1;
        await tx
          .update(schema.users)
          .set({
            failedLoginAttempts: String(attempts),
            lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null,
          })
          .where(eq(schema.users.id, user.id));
        throw Unauthenticated('Invalid credentials');
      }

      const token = newToken(32);
      const sessionId = newId('session');
      const [membership] = await tx.select().from(schema.memberships).where(eq(schema.memberships.userId, user.id));
      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      await tx.insert(schema.sessions).values({
        id: sessionId,
        userId: user.id,
        tokenHash: hashToken(token),
        activeTenantId: membership?.tenantId ?? null,
        device: input.device ?? {},
        ip: input.ip,
        expiresAt,
      });
      await tx
        .update(schema.users)
        .set({ failedLoginAttempts: '0', lockedUntil: null, lastLoginAt: new Date() })
        .where(eq(schema.users.id, user.id));

      if (membership) {
        await audit({ action: 'auth.login', resourceType: 'user', resourceId: user.id, tenantId: membership.tenantId, ip: input.ip });
      }
      return { token, sessionId, userId: user.id, activeTenantId: membership?.tenantId ?? null, expiresAt };
    });
  }

  /** Resolve a bearer token into a full TenantContext for the active tenant. */
  async resolveContext(token: string, opts: { origin?: string; correlationId?: string } = {}): Promise<TenantContext> {
    const context = await withElevated(async (tx) => {
      const [session] = await tx.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
      if (!session || session.revokedAt || session.expiresAt < new Date()) throw Unauthenticated('Session expired');

      // Impersonation expiry enforced hard (PRD §32.5).
      let impersonation = null;
      let effectiveUserId = session.userId;
      if (session.impersonatedUserId && session.impersonationExpiresAt) {
        if (session.impersonationExpiresAt < new Date()) {
          await tx
            .update(schema.sessions)
            .set({ impersonatedUserId: null, impersonatedBy: null, impersonationExpiresAt: null })
            .where(eq(schema.sessions.id, session.id));
        } else {
          impersonation = {
            originalUserId: session.userId,
            impersonatedUserId: session.impersonatedUserId,
            impersonatedBy: session.impersonatedBy!,
            expiresAt: session.impersonationExpiresAt,
          };
          effectiveUserId = session.impersonatedUserId;
        }
      }

      if (!session.activeTenantId) throw Forbidden('No active tenant selected');
      const [membership] = await tx
        .select()
        .from(schema.memberships)
        .where(and(eq(schema.memberships.userId, effectiveUserId), eq(schema.memberships.tenantId, session.activeTenantId)));
      if (!membership || membership.status !== 'active') throw Forbidden('No active membership for tenant');

      const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, session.userId));

      await tx.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, session.id));

      return buildContext({
        tenantId: membership.tenantId,
        userId: effectiveUserId,
        roleIds: membership.isOwner
          ? ['__owner__', ...(membership.roleIds as string[])]
          : (membership.roleIds as string[]),
        teamIds: membership.teamIds as string[],
        branchId: membership.branchId,
        origin: opts.origin ?? 'api',
        correlationId: opts.correlationId,
        impersonation,
        isPlatformAdmin: user?.isPlatformAdmin ?? false,
      });
    });
    return context;
  }

  /**
   * Resolve just the authenticated user from a token, WITHOUT requiring an
   * active tenant/membership. Used during onboarding, before the first tenant
   * exists. Returns the underlying (non-impersonated) user id.
   */
  async resolveContextForOnboarding(token: string): Promise<{ userId: string }> {
    return withElevated(async (tx) => {
      const [session] = await tx.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
      if (!session || session.revokedAt || session.expiresAt < new Date()) throw Unauthenticated('Session expired');
      return { userId: session.userId };
    });
  }

  async logout(token: string): Promise<void> {
    await withElevated(async (tx) => {
      await tx.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.tokenHash, hashToken(token)));
    });
  }

  /**
   * Start an authorized, time-boxed impersonation (PRD §5.1, §32.5). The banner,
   * expiry and audit trail are enforced by resolveContext + the API/UI. Only a
   * platform admin (or a reseller with tenant consent) may call this.
   */
  async startImpersonation(input: {
    adminToken: string;
    targetUserId: string;
    ttlSeconds?: number;
  }): Promise<void> {
    const ttl = Math.min(input.ttlSeconds ?? loadEnv().IMPERSONATION_MAX_TTL_SECONDS, loadEnv().IMPERSONATION_MAX_TTL_SECONDS);
    await withElevated(async (tx) => {
      const [session] = await tx.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(input.adminToken)));
      if (!session) throw Unauthenticated('Session expired');
      const [admin] = await tx.select().from(schema.users).where(eq(schema.users.id, session.userId));
      if (!admin?.isPlatformAdmin) throw Forbidden('Only platform administrators may impersonate');
      const [target] = await tx.select().from(schema.users).where(eq(schema.users.id, input.targetUserId));
      if (!target) throw NotFound('User', input.targetUserId);
      await tx
        .update(schema.sessions)
        .set({
          impersonatedUserId: input.targetUserId,
          impersonatedBy: session.userId,
          impersonationExpiresAt: new Date(Date.now() + ttl * 1000),
        })
        .where(eq(schema.sessions.id, session.id));
    });
    logger.warn({ by: input.targetUserId }, 'Impersonation started');
  }

  /** End an impersonation session immediately (PRD §32.5). */
  async stopImpersonation(token: string): Promise<void> {
    await withElevated(async (tx) => {
      await tx
        .update(schema.sessions)
        .set({ impersonatedUserId: null, impersonatedBy: null, impersonationExpiresAt: null })
        .where(eq(schema.sessions.tokenHash, hashToken(token)));
    });
  }

  /** Run a callback within a resolved context (used by workers/tests). */
  async withResolved<T>(token: string, fn: () => Promise<T>): Promise<T> {
    const ctx = await this.resolveContext(token);
    return runWithBuiltContext(ctx, fn) as Promise<T>;
  }
}

export const authService = new AuthService();
