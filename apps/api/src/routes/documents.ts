import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateDocument, requestSignatures, signDocument, getSignatureStatus } from '@crms/document-engine';
import { and, eq, desc, schema, withTenant } from '@crms/database';
import { getContext } from '@crms/tenant-context';
import { newId } from '@crms/kernel';
import { assert } from '@crms/permissions';
import { audit } from '@crms/audit';
import { authed, pub } from '../lib/context.js';

/**
 * Documents (PRD §21): generate from a template (with QR support), request
 * e-signatures, and a PUBLIC token-authorized sign endpoint.
 */
export async function documentRoutes(app: FastifyInstance): Promise<void> {
  // --- Templates (PRD §21) ---
  app.get(
    '/documents/templates',
    authed(async () => {
      const ctx = getContext();
      return withTenant(async (tx) =>
        tx
          .select()
          .from(schema.documentTemplates)
          .where(
            and(
              eq(schema.documentTemplates.applicationId, ctx.applicationId ?? ''),
              eq(schema.documentTemplates.environment, ctx.environment),
            ),
          ),
      );
    }),
  );

  app.post(
    '/documents/templates',
    authed(async (req) => {
      await assert('manage_config', { type: 'application' });
      const ctx = getContext();
      const body = z
        .object({
          key: z.string(),
          name: z.string(),
          html: z.string().min(1),
          moduleId: z.string().optional(),
          outputs: z.array(z.string()).default(['pdf']),
        })
        .parse(req.body);
      const id = newId('documentTemplate');
      await withTenant(async (tx) => {
        await tx.insert(schema.documentTemplates).values({
          id,
          tenantId: ctx.tenantId,
          applicationId: ctx.applicationId ?? '',
          environment: ctx.environment,
          key: body.key,
          name: body.name,
          kind: 'document',
          body: { html: body.html },
          outputs: body.outputs,
          moduleId: body.moduleId ?? null,
          createdBy: ctx.userId,
        });
      });
      return { id };
    }),
  );

  app.get(
    '/documents',
    authed(async () => {
      const ctx = getContext();
      return withTenant(async (tx) =>
        tx
          .select()
          .from(schema.generatedDocuments)
          .where(eq(schema.generatedDocuments.applicationId, ctx.applicationId ?? ''))
          .orderBy(desc(schema.generatedDocuments.createdAt))
          .limit(50),
      );
    }),
  );

  app.post(
    '/documents/generate',
    authed(async (req) => {
      await assert('create', { type: 'document' });
      const body = z
        .object({ templateId: z.string(), recordId: z.string().optional(), data: z.record(z.unknown()), output: z.enum(['pdf', 'html']).optional() })
        .parse(req.body);
      const result = await generateDocument(body);
      await audit({ action: 'document.generate', resourceType: 'document', resourceId: result.documentId });
      return result;
    }),
  );

  app.post(
    '/documents/:id/signatures',
    authed(async (req) => {
      await assert('create', { type: 'document' });
      const { id } = req.params as { id: string };
      const body = z.object({ signers: z.array(z.object({ email: z.string().email(), name: z.string().optional() })) }).parse(req.body);
      const created = await requestSignatures(id, body.signers);
      await audit({ action: 'document.signature.request', resourceType: 'document', resourceId: id, metadata: { signers: created.length } });
      // Tokens are returned so the caller can send sign links via their channels.
      return { requests: created };
    }),
  );

  app.get(
    '/documents/:id/signatures',
    authed(async (req) => {
      const { id } = req.params as { id: string };
      return getSignatureStatus(id);
    }),
  );

  // PUBLIC: token-authorized signing (no session).
  app.post(
    '/sign/:token',
    pub(async (req) => {
      const { token } = req.params as { token: string };
      const body = z.object({ signatureData: z.string().min(1) }).parse(req.body);
      return signDocument(token, { signatureData: body.signatureData, ip: req.ip });
    }),
  );
}
