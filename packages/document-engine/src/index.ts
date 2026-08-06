import { eq, schema, withTenant } from '@crms/database';
import { newId, NotFound, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { evaluateFormula } from '@crms/sandbox-engine';
import { tenantKey, putObject } from '@crms/storage';

const logger = createLogger('document-engine');

/**
 * Document Engine (PRD §21). Renders a template with variables, conditions,
 * repeatable blocks, totals and formulas into HTML, then to a chosen output.
 * PDF rendering is delegated to a pluggable renderer (headless Chrome / a PDF
 * lib) so the core stays dependency-light; when none is registered the HTML
 * artifact is produced and stored.
 */

export interface PdfRenderer {
  render(html: string): Promise<Buffer>;
}
let pdfRenderer: PdfRenderer | null = null;
export function registerPdfRenderer(r: PdfRenderer): void {
  pdfRenderer = r;
}

/** Handlebars-lite: {{var}}, {{#each items}}...{{/each}}, {{#if cond}}...{{/if}}. */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  let out = template;
  // each blocks
  out = out.replace(/\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, path: string, inner: string) => {
    const arr = resolvePath(data, path);
    if (!Array.isArray(arr)) return '';
    return arr.map((item) => renderTemplate(inner, { ...data, this: item, item })).join('');
  });
  // if blocks
  out = out.replace(/\{\{#if\s+(.+?)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, expr: string, inner: string) => {
    try {
      return evaluateFormula(expr, flatten(data)) ? renderTemplate(inner, data) : '';
    } catch {
      return resolvePath(data, expr.trim()) ? renderTemplate(inner, data) : '';
    }
  });
  // simple vars + formula expressions
  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr: string) => {
    const direct = resolvePath(data, expr);
    if (direct !== undefined) return String(direct ?? '');
    try {
      return String(evaluateFormula(expr, flatten(data)) ?? '');
    } catch {
      return '';
    }
  });
  return out;
}

function resolvePath(data: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], data);
}
function flatten(data: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(data)) if (typeof v !== 'object') out[k] = v as never;
  return out;
}

export async function generateDocument(input: {
  templateId: string;
  recordId?: string;
  data: Record<string, unknown>;
  output?: 'pdf' | 'html';
}): Promise<{ documentId: string; storageKey: string; contentType: string }> {
  const ctx = getContext();
  if (!ctx.applicationId) throw new Error('Document generation requires an application context');
  const applicationId = ctx.applicationId;
  const template = await withTenant(async (tx) => {
    const [row] = await tx.select().from(schema.documentTemplates).where(eq(schema.documentTemplates.id, input.templateId));
    return row ?? null;
  });
  if (!template) throw NotFound('DocumentTemplate', input.templateId);

  const body = (template.body as { html?: string }).html ?? '<html><body>{{title}}</body></html>';
  const html = renderTemplate(body, input.data);

  const output = input.output ?? 'pdf';
  let buffer: Buffer;
  let contentType: string;
  let ext: string;
  if (output === 'pdf' && pdfRenderer) {
    buffer = await pdfRenderer.render(html);
    contentType = 'application/pdf';
    ext = 'pdf';
  } else {
    buffer = Buffer.from(html, 'utf8');
    contentType = 'text/html';
    ext = 'html';
  }

  const documentId = newId('document');
  const storageKey = tenantKey('documents', `${documentId}.${ext}`);
  await putObject(storageKey, buffer, contentType);

  await withTenant(async (tx) => {
    const fileId = newId('file');
    await tx.insert(schema.files).values({
      id: fileId,
      tenantId: ctx.tenantId,
      applicationId,
      environment: ctx.environment,
      recordId: input.recordId,
      name: `${template.name}.${ext}`,
      contentType,
      sizeBytes: String(buffer.length),
      storageKey,
      scanStatus: 'clean',
    });
    await tx.insert(schema.generatedDocuments).values({
      id: documentId,
      tenantId: ctx.tenantId,
      applicationId,
      environment: ctx.environment,
      templateId: input.templateId,
      recordId: input.recordId,
      fileId,
      status: 'generated',
    });
  });

  logger.info({ documentId, output }, 'Document generated');
  return { documentId, storageKey, contentType };
}
