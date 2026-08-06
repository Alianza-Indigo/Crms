import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { toAppError, AppError, createLogger } from '@crms/kernel';

const logger = createLogger('api');

/** Central error handler mapping domain errors → safe HTTP responses (PRD §32.3). */
export function errorHandler(err: unknown, req: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof ZodError) {
    reply.status(400).send({
      error: { code: 'VALIDATION', message: 'Request validation failed', details: err.flatten() },
    });
    return;
  }
  const appErr: AppError = toAppError(err);
  if (appErr.httpStatus >= 500) {
    logger.error({ err: appErr, url: req.url, correlationId: req.headers['x-correlation-id'] }, 'Request failed');
  }
  reply.status(appErr.httpStatus).send({ error: appErr.toJSON() });
}
