import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { generateDocument, requestSignatures, signDocument, getSignatureStatus } from '@crms/document-engine';
import { assert } from '@crms/permissions';
import { audit } from '@crms/audit';
import { authed, pub } from '../lib/context.js';

/**
 * Documents (PRD §21): generate from a template (with QR support), request
 * e-signatures, and a PUBLIC token-authorized sign endpoint.
 */
export async function documentRoutes(app: FastifyInstance): Promise<void> {
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
