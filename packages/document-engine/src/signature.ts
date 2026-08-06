import { and, eq, schema, withTenant, withElevated } from '@crms/database';
import { newId, newToken, NotFound, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

const logger = createLogger('document-engine:signature');

/**
 * E-signature flow (PRD §21). A generated document can request signatures from
 * one or more signers. Each gets a one-time token authorizing a PUBLIC sign
 * page; signing records the signature data + audit fields. When all signers have
 * signed, the document's signatureStatus becomes 'signed'.
 */
export interface Signer {
  email: string;
  name?: string;
}

export async function requestSignatures(documentId: string, signers: Signer[]): Promise<Array<{ signerEmail: string; token: string }>> {
  const ctx = getContext();
  if (!ctx.applicationId) throw NotFound('application context');
  const created: Array<{ signerEmail: string; token: string }> = [];
  await withTenant(async (tx) => {
    const [doc] = await tx.select().from(schema.generatedDocuments).where(eq(schema.generatedDocuments.id, documentId));
    if (!doc) throw NotFound('Document', documentId);
    for (const signer of signers) {
      const token = newToken(24);
      await tx.insert(schema.documentSignatures).values({
        id: newId('document'),
        tenantId: ctx.tenantId,
        applicationId: ctx.applicationId!,
        documentId,
        signerEmail: signer.email.toLowerCase(),
        signerName: signer.name,
        token,
        status: 'pending',
        createdBy: ctx.userId,
      });
      created.push({ signerEmail: signer.email, token });
    }
    await tx.update(schema.generatedDocuments).set({ signatureStatus: 'pending' }).where(eq(schema.generatedDocuments.id, documentId));
  });
  logger.info({ documentId, signers: created.length }, 'Signature requests created');
  return created;
}

/** Public sign action (token-authorized, no session). Records the signature. */
export async function signDocument(token: string, input: { signatureData: string; ip?: string }): Promise<{ documentId: string; allSigned: boolean }> {
  return withElevated(async (tx) => {
    const [sig] = await tx.select().from(schema.documentSignatures).where(eq(schema.documentSignatures.token, token));
    if (!sig) throw NotFound('Signature request', token);
    if (sig.status === 'signed') return { documentId: sig.documentId, allSigned: true };

    await tx
      .update(schema.documentSignatures)
      .set({ status: 'signed', signatureData: input.signatureData, signedAt: new Date(), ip: input.ip })
      .where(eq(schema.documentSignatures.id, sig.id));

    const remaining = await tx
      .select()
      .from(schema.documentSignatures)
      .where(and(eq(schema.documentSignatures.documentId, sig.documentId), eq(schema.documentSignatures.status, 'pending')));
    const allSigned = remaining.length === 0;
    if (allSigned) {
      await tx.update(schema.generatedDocuments).set({ signatureStatus: 'signed', status: 'signed' }).where(eq(schema.generatedDocuments.id, sig.documentId));
    }
    logger.info({ documentId: sig.documentId, allSigned }, 'Document signed');
    return { documentId: sig.documentId, allSigned };
  });
}

export async function getSignatureStatus(documentId: string): Promise<Array<{ signerEmail: string; status: string; signedAt: Date | null }>> {
  return withTenant(async (tx) => {
    const rows = await tx.select().from(schema.documentSignatures).where(eq(schema.documentSignatures.documentId, documentId));
    return rows.map((r) => ({ signerEmail: r.signerEmail, status: r.status, signedAt: r.signedAt }));
  });
}
