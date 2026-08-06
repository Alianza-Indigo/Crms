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
/** Redact the password from a Postgres URL so it is safe to log. */
function redactDbUrl(url: string | undefined): string {
  if (!url) return '(unset)';
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return `${u.protocol}//${u.username}:***@${u.host}${u.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
}

export async function runMigrations(): Promise<void> {
  // Surface exactly what we're connecting to (password redacted) so a failed
  // deploy shows the real target instead of a bare "Migration failed".
  logger.info(
    {
      databaseUrl: redactDbUrl(process.env.DATABASE_URL),
      adminUrlSet: Boolean(process.env.CRMS_ADMIN_DATABASE_URL),
      appRole: process.env.CRMS_APP_ROLE ?? '(unset)',
    },
    'Migration starting',
  );
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

  await ensureAppRole();
}

/**
 * Create/refresh the least-privilege application role (PRD §6.1, §34.3). The app
 * services MUST connect as a NOSUPERUSER/NOBYPASSRLS role or RLS is bypassed.
 * This runs as the migration (admin/owner) connection. Enabled by setting
 * CRMS_APP_ROLE + CRMS_APP_ROLE_PASSWORD — the recommended one-command deploy.
 */
async function ensureAppRole(): Promise<void> {
  const role = process.env.CRMS_APP_ROLE;
  const password = process.env.CRMS_APP_ROLE_PASSWORD;
  if (!role || !password) {
    logger.info('CRMS_APP_ROLE not set; skipping app-role bootstrap (app must connect as a NOBYPASSRLS role)');
    return;
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(role)) throw new Error('CRMS_APP_ROLE must be a valid identifier');
  const pw = password.replace(/'/g, "''");
  await getPool().unsafe(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = '${role}') then
        execute format('create role %I login password %L nosuperuser nobypassrls', '${role}', '${pw}');
      else
        execute format('alter role %I password %L nosuperuser nobypassrls', '${role}', '${pw}');
      end if;
    end $$;
    grant usage on schema public to "${role}";
    grant select, insert, update, delete on all tables in schema public to "${role}";
    grant usage, select on all sequences in schema public to "${role}";
    alter default privileges in schema public grant select, insert, update, delete on tables to "${role}";
    alter default privileges in schema public grant usage, select on sequences to "${role}";
  `);
  logger.info({ role }, 'Application role ensured (NOSUPERUSER NOBYPASSRLS) with table grants');
}

/** Wait for the database to accept connections (Postgres may still be booting
 * on a fresh Railway deploy). Retries connection-level errors with backoff. */
async function waitForDb(attempts = 15, delayMs = 3000): Promise<void> {
  const connErrs = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'CONNECT_TIMEOUT']);
  for (let i = 1; i <= attempts; i++) {
    try {
      await getPool()`select 1`;
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const last = i === attempts;
      if (last || (code && !connErrs.has(code))) throw err;
      logger.warn({ attempt: i, of: attempts, code }, 'Database not ready yet; retrying');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  waitForDb()
    .then(() => runMigrations())
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((err) => {
      // Print the real cause plainly so the deploy log is actionable
      // (a bare "Migration failed" hides connection/auth errors).
      const e = err as { message?: string; code?: string; stack?: string };
      logger.error({ err }, 'Migration failed');
      console.error('--- Migration failed ---');
      console.error('message:', e?.message ?? String(err));
      if (e?.code) console.error('code   :', e.code);
      console.error('target :', redactDbUrl(process.env.DATABASE_URL));
      if (e?.stack) console.error(e.stack);
      process.exit(1);
    });
}
