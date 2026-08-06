import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeDb } from '@crms/database';
import { runWithBuiltContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { recordsEngine } from '@crms/records-engine';
import { createView, runView, createForm, submitForm, createPipeline, transition, createDashboard, runWidget } from '@crms/builder-engine';
import { searchRecords } from '@crms/search-engine';
import { createImportJob, processImportJob } from '@crms/import-engine';
import { createTenantFixture } from '../helpers/seed.js';

/** Product-surface engines: views, forms, pipelines, dashboards, search, import. */
describe('product surface', () => {
  let ctx: Awaited<ReturnType<typeof createTenantFixture>>;
  let moduleId: string;

  beforeAll(async () => {
    ctx = await createTenantFixture('product');
    await runWithBuiltContext(ctx, async () => {
      const mod = await schemaEngine.createModule({ key: 'leads', name: 'Lead' });
      moduleId = mod.id;
      await schemaEngine.createField({ moduleId: mod.id, key: 'name', name: 'Name', type: 'text_short' } as never);
      await schemaEngine.createField({ moduleId: mod.id, key: 'value', name: 'Value', type: 'currency' } as never);
      await schemaEngine.createField({ moduleId: mod.id, key: 'stage', name: 'Stage', type: 'status', config: { options: [{ value: 'new' }, { value: 'won' }] } } as never);
    });
  });
  afterAll(async () => {
    await closeDb();
  });

  it('runs a kanban view grouped by stage', async () => {
    await runWithBuiltContext(ctx, async () => {
      await recordsEngine.create({ moduleId, data: { name: 'A', value: 100 }, stage: 'new' });
      await recordsEngine.create({ moduleId, data: { name: 'B', value: 200 }, stage: 'won' });
      const view = await createView({ moduleId, key: 'board', name: 'Board', type: 'kanban', grouping: { field: 'stage' } });
      const result = await runView(view.id);
      expect(result.shape).toBe('kanban');
      const keys = (result.groups ?? []).map((g) => g.key).sort();
      expect(keys).toContain('new');
      expect(keys).toContain('won');
    });
  });

  it('submits a form that creates a record', async () => {
    await runWithBuiltContext(ctx, async () => {
      const form = await createForm({ moduleId, key: 'intake', name: 'Intake' });
      const res = await submitForm(form.id, { name: 'From Form', value: 50 });
      expect(res.mode).toBe('create');
      const rec = await recordsEngine.get(moduleId, res.recordId);
      expect((rec.data as Record<string, unknown>).name).toBe('From Form');
    });
  });

  it('enforces pipeline transitions', async () => {
    await runWithBuiltContext(ctx, async () => {
      const pipe = await createPipeline({
        moduleId,
        key: 'sales',
        name: 'Sales',
        stages: [{ key: 'new', name: 'New' }, { key: 'won', name: 'Won', requiredFields: ['value'] }],
        transitions: [{ from: 'new', to: 'won' }],
      });
      const rec = await recordsEngine.create({ moduleId, data: { name: 'Deal', value: 10 }, stage: 'new' });
      await transition(pipe.id, rec.id, 'won');
      const updated = await recordsEngine.get(moduleId, rec.id);
      expect(updated.stage).toBe('won');
      // Invalid transition rejected.
      await expect(transition(pipe.id, rec.id, 'new')).rejects.toThrow(/not allowed/i);
    });
  });

  it('aggregates a dashboard widget', async () => {
    const result = await runWithBuiltContext(ctx, () => runWidget({ key: 'total', type: 'metric', moduleId, aggregate: 'sum', field: 'value' }));
    expect(typeof result.metric).toBe('number');
    expect(result.metric!).toBeGreaterThan(0);
  });

  it('finds records by search', async () => {
    const hits = await runWithBuiltContext(ctx, () => searchRecords('From Form'));
    expect(hits.some((h) => h.title === 'From Form')).toBe(true);
  });

  it('imports records from CSV', async () => {
    const jobId = await runWithBuiltContext(ctx, () =>
      createImportJob({ moduleId, format: 'csv', content: 'name,value\nImported1,11\nImported2,22\n' }),
    );
    await processImportJob(jobId);
    const hits = await runWithBuiltContext(ctx, () => searchRecords('Imported1'));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
