import { createServer, type Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeDb, schema, withElevated, eq } from '@crms/database';
import { runWithBuiltContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { recordsEngine } from '@crms/records-engine';
import { cloneApplication } from '@crms/deployment-engine';
import { createMigrationJob, runMigration, registerPostgresMigrationProvider } from '@crms/tenant-migration';
import { exportSubjectData, eraseSubjectData } from '@crms/compliance';
import { qrDataUri } from '@crms/document-engine';
import { createTenantFixture } from '../helpers/seed.js';

/** Coverage for the completed partials: clone, tenant migration, DSAR, QR. */
describe('config clone', () => {
  it('clones an application with its modules and fields', async () => {
    const ctx = await createTenantFixture('clone');
    const newAppId = await runWithBuiltContext(ctx, async () => {
      const mod = await schemaEngine.createModule({ key: 'deals', name: 'Deal' });
      await schemaEngine.createField({ moduleId: mod.id, key: 'amount', name: 'Amount', type: 'currency' } as never);
      return cloneApplication(ctx.applicationId!, 'Deals Copy');
    });
    const modules = await runWithBuiltContext({ ...ctx, applicationId: newAppId }, () => schemaEngine.listModules());
    expect(modules.some((m) => m.key === 'deals')).toBe(true);
  });
});

describe('tenant migration (schema tier)', () => {
  beforeAll(() => registerPostgresMigrationProvider());
  afterAll(async () => {
    await closeDb();
  });

  it('copies a tenant into a dedicated schema and cuts over routing', async () => {
    const ctx = await createTenantFixture('mig');
    await runWithBuiltContext(ctx, async () => {
      const mod = await schemaEngine.createModule({ key: 'items', name: 'Item' });
      await schemaEngine.createField({ moduleId: mod.id, key: 'name', name: 'Name', type: 'text_short' } as never);
      await recordsEngine.create({ moduleId: mod.id, data: { name: 'Widget' } });
    });

    const jobId = await runWithBuiltContext(ctx, () => createMigrationJob({ tenantId: ctx.tenantId, toTier: 'schema' }));
    await runMigration(jobId);

    const [routing] = await withElevated(async (tx) =>
      tx.select().from(schema.tenantRouting).where(eq(schema.tenantRouting.tenantId, ctx.tenantId)),
    );
    expect(routing?.isolationTier).toBe('schema');
    expect(routing?.routingState).toBe('stable');

    const job = await withElevated(async (tx) => {
      const [j] = await tx.select().from(schema.tenantMigrationJobs).where(eq(schema.tenantMigrationJobs.id, jobId));
      return j;
    });
    expect(job?.status).toBe('succeeded');
  });
});

describe('DSAR export + erasure (PRD §33)', () => {
  // Stand-in for S3-compatible storage (MinIO) so putObject succeeds locally.
  let s3: Server;
  beforeAll(async () => {
    s3 = createServer((req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(200).end());
    });
    await new Promise<void>((resolve) => s3.listen(9000, '127.0.0.1', resolve));
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => s3.close(() => resolve()));
    await closeDb();
  });

  it('exports a subject\'s records and erases (anonymizes) them', async () => {
    const ctx = await createTenantFixture('dsar');
    const userId = ctx.userId!;
    await runWithBuiltContext(ctx, async () => {
      const mod = await schemaEngine.createModule({ key: 'notes', name: 'Note' });
      await schemaEngine.createField({ moduleId: mod.id, key: 'text', name: 'Text', type: 'text_short' } as never);
      await recordsEngine.create({ moduleId: mod.id, data: { text: 'private' } });
    });

    const exported = await runWithBuiltContext(ctx, () => exportSubjectData(userId));
    expect(exported.records).toBeGreaterThanOrEqual(1);
    expect(exported.url).toContain('X-Amz-Signature');

    const erased = await runWithBuiltContext(ctx, () => eraseSubjectData(userId, { confirm: true }));
    expect(erased.anonymizedRecords).toBeGreaterThanOrEqual(1);
    const [user] = await withElevated(async (tx) => tx.select().from(schema.users).where(eq(schema.users.id, userId)));
    expect(user?.email).toContain('erased+');
  });
});

describe('document QR', () => {
  afterAll(async () => {
    await closeDb();
  });
  it('produces a PNG data URI', async () => {
    const uri = await qrDataUri('https://crms.example/doc/123');
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
  });
});
