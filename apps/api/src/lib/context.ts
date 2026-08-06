import type { FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { Unauthenticated, newCorrelationId } from '@crms/kernel';
import { authService } from '@crms/auth';
import { runWithBuiltContext, type TenantContext } from '@crms/tenant-context';
import { APPLICATION_HEADER, ENVIRONMENT_HEADER, CORRELATION_HEADER, type Environment } from '@crms/config';

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
    let ctx: TenantContext = await authService.resolveContext(token, { origin: 'api', correlationId });

    const appId = req.headers[APPLICATION_HEADER] as string | undefined;
    const env = req.headers[ENVIRONMENT_HEADER] as Environment | undefined;
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
