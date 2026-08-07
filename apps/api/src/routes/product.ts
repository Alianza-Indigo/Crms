import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createView, listViews, runView, createForm, listForms, submitForm, createPipeline, listPipelines, transition, createDashboard, listDashboards, runWidget } from '@crms/builder-engine';
import { searchRecords } from '@crms/search-engine';
import { createImportJob, getImportJob } from '@crms/import-engine';
import { runAgent, logAgentRun } from '@crms/agent-engine';
import { newId } from '@crms/kernel';
import { schema, withTenant, eq } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { assert } from '@crms/permissions';
import { audit } from '@crms/audit';
import { authed } from '../lib/context.js';

/** Product-surface routes (PRD §13-15, §22, §24, §23, §30). */
export async function productRoutes(app: FastifyInstance): Promise<void> {
  // --- Views ---
  app.get('/modules/:moduleId/views', authed(async (req) => listViews((req.params as { moduleId: string }).moduleId)));
  app.post('/modules/:moduleId/views', authed(async (req) => {
    const { moduleId } = req.params as { moduleId: string };
    const body = req.body as Record<string, unknown>;
    return createView({ ...body, moduleId } as never);
  }));
  app.get('/views/:viewId/run', authed(async (req) => {
    const { viewId } = req.params as { viewId: string };
    const q = req.query as { limit?: string; cursor?: string };
    return runView(viewId, { limit: q.limit ? Number(q.limit) : undefined, cursor: q.cursor });
  }));

  // --- Forms ---
  app.get('/forms', authed(async () => listForms()));
  app.post('/forms', authed(async (req) => createForm(req.body as never)));
  app.post('/forms/:formId/submit', authed(async (req) => {
    const { formId } = req.params as { formId: string };
    const body = z.object({ data: z.record(z.unknown()) }).parse(req.body);
    return submitForm(formId, body.data);
  }));

  // --- Pipelines ---
  app.get('/modules/:moduleId/pipelines', authed(async (req) => listPipelines((req.params as { moduleId: string }).moduleId)));
  app.post('/pipelines', authed(async (req) => createPipeline(req.body as never)));
  app.post('/pipelines/:pipelineId/transition', authed(async (req) => {
    const { pipelineId } = req.params as { pipelineId: string };
    const body = z.object({ recordId: z.string(), toStage: z.string() }).parse(req.body);
    await transition(pipelineId, body.recordId, body.toStage);
    return { ok: true };
  }));

  // --- Dashboards ---
  app.get('/dashboards', authed(async () => listDashboards()));
  app.post('/dashboards', authed(async (req) => createDashboard(req.body as never)));
  app.post('/dashboards/widget/run', authed(async (req) => runWidget(req.body as never)));

  // --- Search ---
  app.get('/search', authed(async (req) => {
    const q = req.query as { q?: string; moduleId?: string; limit?: string };
    return { hits: await searchRecords(q.q ?? '', { moduleId: q.moduleId, limit: q.limit ? Number(q.limit) : undefined }) };
  }));

  // --- Import ---
  app.post('/imports', authed(async (req) => {
    await assert('import', { type: 'record' });
    const body = z
      .object({ moduleId: z.string(), format: z.enum(['csv', 'json', 'xlsx']), content: z.string(), mapping: z.record(z.string()).optional(), dedupeField: z.string().optional(), updateExisting: z.boolean().optional() })
      .parse(req.body);
    const jobId = await createImportJob(body);
    await audit({ action: 'import.create', resourceType: 'module', resourceId: body.moduleId, metadata: { jobId } });
    return { jobId };
  }));
  app.get('/imports/:jobId', authed(async (req) => getImportJob((req.params as { jobId: string }).jobId)));

  // --- Agents ---
  app.get('/agents', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) =>
      tx.select().from(schema.agentDefinitions).where(eq(schema.agentDefinitions.applicationId, ctx.applicationId ?? '')),
    );
  }));
  app.post('/agents', authed(async (req) => {
    await assert('manage_config', { type: 'application' });
    const ctx = getContext();
    const body = z.object({ name: z.string(), purpose: z.string().optional(), instructions: z.string().optional(), provider: z.string().default('openai'), model: z.string().optional(), credentialId: z.string().optional(), serviceAccountId: z.string().optional(), accessibleModuleIds: z.array(z.string()).default([]), allowedActions: z.array(z.string()).default([]) }).parse(req.body);
    const id = newId('agent');
    await withTenant(async (tx) => {
      await tx.insert(schema.agentDefinitions).values({ id, tenantId: ctx.tenantId, applicationId: ctx.applicationId!, environment: ctx.environment, ...body, createdBy: ctx.userId });
    });
    return { id };
  }));
  app.post('/agents/:agentId/run', authed(async (req) => {
    await assert('execute_ai', { type: 'application' });
    const { agentId } = req.params as { agentId: string };
    const body = z.object({ message: z.string() }).parse(req.body);
    const turn = await runAgent(agentId, body.message);
    await logAgentRun(agentId, turn);
    await audit({ action: 'agent.run', resourceType: 'agent', resourceId: agentId, metadata: { rounds: turn.rounds, tools: turn.toolCalls.length } });
    return turn;
  }));
}
