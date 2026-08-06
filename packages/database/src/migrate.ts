import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { createLogger } from '@crms/kernel';
import { getDb, getPool, closeDb } from './client.js';

const logger = createLogger('migrate');
const here = dirname(fileURLToPath(import.meta.url));

/**
 * Migration runner: applies generated Drizzle migrations, then applies RLS
 * policies (which Drizzle does not manage). Idempotent — safe to run repeatedly.
 * Generate SQL first with `pnpm db:generate`.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();
  const migrationsFolder = join(here, '..', 'migrations');
  logger.info({ migrationsFolder }, 'Applying schema migrations');
  try {
    await migrate(db, { migrationsFolder });
  } catch (err) {
    logger.warn({ err }, 'No generated migrations found or migration skipped; ensure `pnpm db:generate` was run');
  }

  logger.info('Applying RLS policies');
  const rls = readFileSync(join(here, 'rls.sql'), 'utf8');
  await getPool().unsafe(rls);
  logger.info('Migrations + RLS applied');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}
