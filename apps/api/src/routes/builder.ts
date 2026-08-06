import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, schema, withTenant } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { schemaEngine } from '@crms/schema-engine';
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

  app.delete(
    '/fields/:fieldId',
    authed(async (req) => {
      const { fieldId } = req.params as { fieldId: string };
      const confirm = (req.query as { confirm?: string }).confirm === 'true';
      return schemaEngine.deleteField(fieldId, { confirm });
    }),
  );

  app.post(
    '/relations',
    authed(async (req) => schemaEngine.createRelation(req.body as never)),
  );

  app.post(
    '/applications/publish',
    authed(async (req) => {
      const body = z.object({ version: z.string(), changelog: z.string().optional() }).parse(req.body);
      const versionId = await schemaEngine.publish(body.version, body.changelog);
      return { versionId };
    }),
  );
}
