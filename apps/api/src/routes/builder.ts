import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, schema, withTenant } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
import { diffVersions, cloneApplication, rollbackToVersion } from '@crms/deployment-engine';
import { authed } from '../lib/context.js';

/**
 * Application builder routes (PRD §8, §38). Applications + modules + fields +
 * relations + publish. Every write goes through the schema engine so validation,
 * permissions and destructive-change detection are enforced uniformly.
 */
export async function builderRoutes(app: FastifyInstance): Promise<void> {
  app.get('/applications', authed(async () => {
    const ctx = getContext();
    return withTenant(async (tx) => tx.select().from(schema.applications).where(eq(schema.applications.tenantId, ctx.tenantId)));
  }));

  app.get('/modules', authed(async () => schemaEngine.listModules()));

  app.post(
    '/modules',
    authed(async (req) => {
      const body = z
        .object({
          key: z.string(),
          name: z.string(),
          namePlural: z.string().optional(),
          icon: z.string().optional(),
          color: z.string().optional(),
          description: z.string().optional(),
        })
        .parse(req.body);
      return schemaEngine.createModule(body);
    }),
  );

  app.patch(
    '/modules/:moduleId',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      return schemaEngine.updateModule(moduleId, req.body as never);
    }),
  );

  app.delete(
    '/modules/:moduleId',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      const confirm = (req.query as { confirm?: string }).confirm === 'true';
      return schemaEngine.deleteModule(moduleId, { confirm });
    }),
  );

  app.get(
    '/modules/:moduleId/fields',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      return schemaEngine.listFields(moduleId);
    }),
  );

  app.post(
    '/modules/:moduleId/fields',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      const body = req.body as Record<string, unknown>;
      return schemaEngine.createField({ ...body, moduleId } as never);
    }),
  );

  app.post(
    '/modules/:moduleId/fields/reorder',
    authed(async (req) => {
      const { moduleId } = req.params as { moduleId: string };
      const body = z.object({ fieldIds: z.array(z.string()) }).parse(req.body);
      await schemaEngine.reorderFields(moduleId, body.fieldIds);
      return { ok: true };
    }),
  );

  app.patch(
    '/fields/:fieldId',
    authed(async (req) => {
      const { fieldId } = req.params as { fieldId: string };
      const confirm = (req.query as { confirm?: string }).confirm === 'true';
      return schemaEngine.updateField(fieldId, req.body as never, { confirm });
    }),
  );

  app.delete(
    '/fields/:fieldId',
    authed(async (req) => {
      const { fieldId } = req.params as { fieldId: string };
      const confirm = (req.query as { confirm?: string }).confirm === 'true';
      return schemaEngine.deleteField(fieldId, { confirm });
    }),
  );

  app.get('/relations', authed(async () => schemaEngine.listRelations()));

  app.post(
    '/relations',
    authed(async (req) => schemaEngine.createRelation(req.body as never)),
  );

  app.delete(
    '/relations/:relationId',
    authed(async (req) => {
      const { relationId } = req.params as { relationId: string };
      await schemaEngine.deleteRelation(relationId);
      return { ok: true };
    }),
  );

  app.post(
    '/applications/publish',
    authed(async (req) => {
      const body = z.object({ version: z.string(), changelog: z.string().optional() }).parse(req.body);
      const versionId = await schemaEngine.publish(body.version, body.changelog);
      return { versionId };
    }),
  );

  // Config lifecycle (PRD §8.4): diff / clone / rollback.
  app.get(
    '/applications/:appId/diff',
    authed(async (req) => {
      const { appId } = req.params as { appId: string };
      const q = z.object({ a: z.string(), b: z.string() }).parse(req.query);
      return diffVersions(appId, q.a, q.b);
    }),
  );

  app.post(
    '/applications/:appId/clone',
    authed(async (req) => {
      const { appId } = req.params as { appId: string };
      const body = z.object({ name: z.string() }).parse(req.body);
      const newAppId = await cloneApplication(appId, body.name);
      return { applicationId: newAppId };
    }),
  );

  app.post(
    '/applications/:appId/rollback',
    authed(async (req) => {
      const { appId } = req.params as { appId: string };
      const body = z.object({ version: z.string() }).parse(req.body);
      await rollbackToVersion(appId, body.version);
      return { ok: true };
    }),
  );
}
