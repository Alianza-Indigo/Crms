import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, schema, withElevated } from '@crms/database';
import { newId } from '@crms/kernel';
import {
  authService,
  buildAuthUrl,
  handleCallback,
  isGoogleConfigured,
  buildOidcAuthUrl,
  handleOidcCallback,
  isOidcConfigured,
} from '@crms/auth';
import { loadEnv } from '@crms/config';
import { createSubscription } from '@crms/billing';
import { pub, authed } from '../lib/context.js';

/**
 * Authentication + onboarding routes (PRD §43.1). Registration, login, logout,
 * tenant creation, and the initial owner membership + first application.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/register',
    pub(async (req) => {
      const body = z.object({ email: z.string().email(), password: z.string(), name: z.string().optional() }).parse(req.body);
      const userId = await authService.register(body);
      return { userId };
    }),
  );

  app.post(
    '/auth/login',
    pub(async (req) => {
      const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
      const result = await authService.login({ ...body, ip: req.ip, device: { ua: req.headers['user-agent'] } });
      return result;
    }),
  );

  // --- Google OAuth (PRD §32.1) ---
  app.get(
    '/auth/google/start',
    pub(async (req, reply) => {
      if (!isGoogleConfigured()) return { configured: false };
      const returnPath = (req.query as { return?: string }).return;
      const { url } = buildAuthUrl(returnPath);
      // Return the URL (SPA redirects) — or 302 when hit directly in a browser.
      if ((req.headers.accept ?? '').includes('text/html')) {
        reply.redirect(url);
        return;
      }
      return { url };
    }),
  );

  app.get(
    '/auth/google/callback',
    pub(async (req, reply) => {
      const q = z.object({ code: z.string(), state: z.string() }).parse(req.query);
      const session = await handleCallback({ code: q.code, state: q.state, ip: req.ip });
      // Redirect back to the web app with the session token in the fragment.
      const base = loadEnv().APP_BASE_URL;
      reply.redirect(`${base}/auth/complete#token=${session.token}&new=${session.isNewUser ? '1' : '0'}`);
    }),
  );

  // --- Generic OIDC SSO (PRD §32.1) ---
  app.get(
    '/auth/oidc/start',
    pub(async (req, reply) => {
      if (!isOidcConfigured()) return { configured: false };
      const { url } = await buildOidcAuthUrl();
      if ((req.headers.accept ?? '').includes('text/html')) {
        reply.redirect(url);
        return;
      }
      return { url };
    }),
  );

  app.get(
    '/auth/oidc/callback',
    pub(async (req, reply) => {
      const q = z.object({ code: z.string(), state: z.string() }).parse(req.query);
      const session = await handleOidcCallback({ code: q.code, state: q.state, ip: req.ip });
      const base = loadEnv().APP_BASE_URL;
      reply.redirect(`${base}/auth/complete#token=${session.token}&new=${session.isNewUser ? '1' : '0'}`);
    }),
  );

  app.post(
    '/auth/logout',
    pub(async (req) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
      await authService.logout(token);
      return { ok: true };
    }),
  );

  app.get('/auth/me', authed(async () => {
    const { getContext } = await import('@crms/tenant-context');
    const ctx = getContext();
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      applicationId: ctx.applicationId,
      environment: ctx.environment,
      roleIds: ctx.roleIds,
      impersonation: ctx.impersonation,
    };
  }));

  /**
   * Onboarding: create an organization (tenant), make the caller its owner, and
   * scaffold a first application. Runs elevated because no tenant context exists
   * yet; the created membership is what unlocks normal, RLS-scoped access.
   */
  app.post(
    '/onboarding/tenant',
    pub(async (req) => {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /i, '');
      const ctx = await authService.resolveContextForOnboarding(token);
      const body = z
        .object({ name: z.string().min(1), slug: z.string().min(1), applicationName: z.string().default('Main App') })
        .parse(req.body);

      const tenantId = newId('tenant');
      const applicationId = newId('application');
      await withElevated(async (tx) => {
        await tx.insert(schema.tenants).values({ id: tenantId, name: body.name, slug: body.slug, createdBy: ctx.userId });
        await tx.insert(schema.tenantRouting).values({ tenantId, isolationTier: 'shared' });
        await tx.insert(schema.memberships).values({
          id: newId('membership'),
          tenantId,
          userId: ctx.userId,
          status: 'active',
          isOwner: true,
          acceptedAt: new Date(),
        });
        await tx.insert(schema.applications).values({
          id: applicationId,
          tenantId,
          name: body.applicationName,
          slug: 'main',
          createdBy: ctx.userId,
        });
        // Point the caller's session at the new tenant.
        await tx
          .update(schema.sessions)
          .set({ activeTenantId: tenantId })
          .where(and(eq(schema.sessions.userId, ctx.userId)));
      });
      await createSubscription({ tenantId, plan: 'trial', trialDays: 14 });
      return { tenantId, applicationId };
    }),
  );
}
