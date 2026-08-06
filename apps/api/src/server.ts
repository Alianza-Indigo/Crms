import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { loadEnv } from '@crms/config';
import { createLogger } from '@crms/kernel';
import { getPool } from '@crms/database';
import { errorHandler } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { builderRoutes } from './routes/builder.js';
import { recordRoutes } from './routes/records.js';
import { credentialRoutes } from './routes/credentials.js';
import { aiRoutes } from './routes/ai.js';
import { platformRoutes } from './routes/platform.js';

const logger = createLogger('api');

export async function buildServer() {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 5 * 1024 * 1024 });

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

  return app;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer();
  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  logger.info({ port: env.API_PORT }, 'CRMS API listening');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, 'API failed to start');
    process.exit(1);
  });
}
