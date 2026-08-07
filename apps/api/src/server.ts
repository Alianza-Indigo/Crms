import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from '@crms/config';
import { createLogger } from '@crms/kernel';
import { getPool } from '@crms/database';
import { registerStripeIfConfigured } from '@crms/billing';
import { registerProvidersFromEnv } from './lib/providers.js';
import { errorHandler } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { builderRoutes } from './routes/builder.js';
import { recordRoutes } from './routes/records.js';
import { credentialRoutes } from './routes/credentials.js';
import { aiRoutes } from './routes/ai.js';
import { platformRoutes } from './routes/platform.js';
import { adminRoutes } from './routes/admin.js';
import { adminConsoleRoutes } from './routes/admin-console.js';
import { templateRoutes } from './routes/templates.js';
import { automationRoutes } from './routes/automations.js';
import { realtimeRoutes } from './routes/realtime.js';
import { documentRoutes } from './routes/documents.js';
import { whitelabelRoutes } from './routes/whitelabel.js';
import { complianceRoutes } from './routes/compliance.js';
import { productRoutes } from './routes/product.js';
import { portalRoutes } from './routes/portals.js';

const logger = createLogger('api');

export async function buildServer() {
  // Auto-register credential/flag-gated providers (Stripe, PDF, sandbox runner).
  registerStripeIfConfigured();
  registerProvidersFromEnv();

  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 5 * 1024 * 1024 });

  // Tolerate empty JSON bodies. Several POST endpoints take no payload
  // (e.g. /ai/plans/:id/approve and /execute), but browser clients still send
  // `content-type: application/json`. Fastify's default parser rejects an empty
  // body with a 500 before the handler runs; treat empty as an empty object.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = (body as string).trim();
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      (err as { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  await app.register(formbody); // parse application/x-www-form-urlencoded (SAML POST)
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  // Rate limiting (PRD §32.3). Keyed per client; tighten per route as needed.
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  app.setErrorHandler(errorHandler);

  // Liveness/readiness (PRD §42).
  app.get('/health', async () => {
    let db = 'ok';
    try {
      await getPool()`select 1`;
    } catch {
      db = 'down';
    }
    return { status: db === 'ok' ? 'ok' : 'degraded', db, ts: new Date().toISOString() };
  });

  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(builderRoutes, { prefix: '/v1' });
  await app.register(recordRoutes, { prefix: '/v1' });
  await app.register(credentialRoutes, { prefix: '/v1' });
  await app.register(aiRoutes, { prefix: '/v1' });
  await app.register(platformRoutes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(adminConsoleRoutes, { prefix: '/v1' });
  await app.register(templateRoutes, { prefix: '/v1' });
  await app.register(automationRoutes, { prefix: '/v1' });
  await app.register(realtimeRoutes, { prefix: '/v1' });
  await app.register(documentRoutes, { prefix: '/v1' });
  await app.register(whitelabelRoutes, { prefix: '/v1' });
  await app.register(complianceRoutes, { prefix: '/v1' });
  await app.register(productRoutes, { prefix: '/v1' });
  await app.register(portalRoutes, { prefix: '/v1' });

  return app;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer();
  // Honor the platform-injected PORT (Railway/Heroku/etc), else the configured one.
  const port = process.env.PORT ? Number(process.env.PORT) : env.API_PORT;
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'CRMS API listening');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, 'API failed to start');
    process.exit(1);
  });
}
