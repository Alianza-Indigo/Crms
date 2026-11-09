import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { Unauthenticated, Forbidden, newCorrelationId } from '@crms/kernel';
import { authService, isApiKey, resolveApiKeyContext } from '@crms/auth';
import { runWithBuiltContext, type TenantContext } from '@crms/tenant-context';
import { APPLICATION_HEADER, ENVIRONMENT_HEADER, CORRELATION_HEADER, ENVIRONMENTS, type Environment } from '@crms/config';
import { eq, schema, withTenant } from '@crms/database';

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim();
}

/**
 * Resolve the request's TenantContext from the bearer token, then apply the
 * requested application + environment (via headers) after verifying membership.
 * The whole handler runs inside the AsyncLocalStorage context so every engine
 * call downstream is tenant-scoped (PRD §6.2).
 */
export function authed(handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>): RouteHandlerMethod {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const token = bearer(req);
    if (!token) throw Unauthenticated();
    const correlationId = (req.headers[CORRELATION_HEADER] as string) ?? newCorrelationId();
    // Two credential types share the Bearer header: opaque API keys (crms_...)
    // resolve to a service-account context; everything else is a user session.
    let ctx: TenantContext = isApiKey(token)
      ? await resolveApiKeyContext(token, { ip: req.ip, correlationId })
      : await authService.resolveContext(token, { origin: 'api', correlationId });

    const requestedApp = req.headers[APPLICATION_HEADER];
    const requestedEnv = req.headers[ENVIRONMENT_HEADER];
    if (requestedApp !== undefined && (typeof requestedApp !== 'string' || !requestedApp)) {
      throw Forbidden('Invalid application header');
    }
    if (requestedEnv !== undefined &&
      (typeof requestedEnv !== 'string' || !ENVIRONMENTS.includes(requestedEnv as Environment))) {
      throw Forbidden('Invalid environment header');
    }
    const appId = requestedApp as string | undefined;
    const env = requestedEnv as Environment | undefined;
    if (appId && appId !== ctx.applicationId) {
      // Service-account API keys bound to an app cannot switch to a different app.
      if (ctx.serviceAccountId && ctx.applicationId) throw Forbidden('API key is bound to another application');
      const appRow = await withTenant(async (tx) => {
        const [row] = await tx.select({ id: schema.applications.id, status: schema.applications.status })
          .from(schema.applications).where(eq(schema.applications.id, appId));
        return row;
      }, ctx);
      if (!appRow || appRow.status !== 'active') throw Forbidden('Application is not available in this tenant');
    }
    if (appId || env) {
      ctx = { ...ctx, applicationId: appId ?? ctx.applicationId, environment: env ?? ctx.environment };
    }
    reply.header(CORRELATION_HEADER, correlationId);
    return runWithBuiltContext(ctx, () => handler(req, reply));
  };
}

/** Public handler wrapper: just ensures a correlation id is echoed. */
export function pub(handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>): RouteHandlerMethod {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    const correlationId = (req.headers[CORRELATION_HEADER] as string) ?? newCorrelationId();
    reply.header(CORRELATION_HEADER, correlationId);
    return handler(req, reply);
  };
}
