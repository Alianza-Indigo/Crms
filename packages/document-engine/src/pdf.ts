import PDFDocument from 'pdfkit';
import { registerPdfRenderer, type PdfRenderer } from './index.js';
import { createLogger } from '@crms/kernel';

const logger = createLogger('document-engine:pdf');

/**
 * Default PDF renderer using pdfkit (pure JS — no browser/native deps). It
 * renders the template's text content into a paginated PDF. Rich HTML/CSS layout
 * (tables, columns) benefits from a headless-Chrome renderer, which can be
 * registered instead via registerPdfRenderer; this default makes PDF output work
 * out of the box.
 */
function htmlToBlocks(html: string): Array<{ text: string; heading?: boolean }> {
  const withBreaks = html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ');
  const headings = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis;
  const blocks: Array<{ text: string; heading?: boolean }> = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = headings.exec(withBreaks))) {
    const before = withBreaks.slice(lastIndex, m.index);
    if (before.trim()) blocks.push({ text: stripTags(before) });
    blocks.push({ text: stripTags(m[1] ?? ''), heading: true });
    lastIndex = m.index + m[0].length;
  }
  const rest = withBreaks.slice(lastIndex);
  if (rest.trim()) blocks.push({ text: stripTags(rest) });
  return blocks.filter((b) => b.text.trim().length > 0);
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractImages(html: string): { html: string; images: Buffer[] } {
  const images: Buffer[] = [];
  const stripped = html.replace(/<img[^>]*src=["']data:image\/[^;]+;base64,([^"']+)["'][^>]*>/gi, (_m, b64: string) => {
    try {
      images.push(Buffer.from(b64, 'base64'));
    } catch {
      /* skip bad image */
    }
    return '';
  });
  return { html: stripped, images };
}

class PdfKitRenderer implements PdfRenderer {
  render(html: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const { html: textHtml, images } = extractImages(html);
        const doc = new PDFDocument({ size: 'A4', margin: 56 });
        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        for (const block of htmlToBlocks(textHtml)) {
          if (block.heading) doc.moveDown(0.5).fontSize(16).text(block.text).moveDown(0.25).fontSize(11);
          else doc.fontSize(11).text(block.text).moveDown(0.5);
        }
        // Embed extracted images (e.g. QR codes) at the end of the document.
        for (const img of images) {
          doc.moveDown(0.5);
          try {
            doc.image(img, { fit: [160, 160] });
          } catch {
            /* unsupported image */
          }
        }
        doc.end();
      } catch (err) {
        reject(err as Error);
      }
    });
  }
}

export function registerDefaultPdfRenderer(): void {
  registerPdfRenderer(new PdfKitRenderer());
  logger.info('Default pdfkit PDF renderer registered');
}

/** Render HTML directly to a PDF buffer (used by the default renderer + tests). */
export function renderHtmlToPdf(html: string): Promise<Buffer> {
  return new PdfKitRenderer().render(html);
}
