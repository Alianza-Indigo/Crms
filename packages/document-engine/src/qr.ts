import QRCode from 'qrcode';

/**
 * QR generation for documents (PRD §21). Produces a PNG data URI that can be
 * embedded in HTML and rendered into the PDF. Template authors write
 * `{{qr:<value>}}` (or `{{qr:field_key}}` resolved from data) and the engine
 * replaces it with an <img> before rendering.
 */
export async function qrDataUri(value: string, size = 160): Promise<string> {
  return QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' });
}

const QR_TOKEN = /\{\{\s*qr:([^}]+?)\s*\}\}/g;

/** Replace {{qr:...}} tokens with embedded QR images. */
export async function embedQrCodes(html: string, data: Record<string, unknown>): Promise<string> {
  const tokens = [...html.matchAll(QR_TOKEN)];
  if (tokens.length === 0) return html;
  let out = html;
  for (const match of tokens) {
    const raw = (match[1] ?? '').trim();
    // Resolve a field reference if the token names one, else use the literal.
    const value = raw in data ? String(data[raw]) : raw;
    const uri = await qrDataUri(value);
    out = out.replace(match[0], `<img alt="qr" src="${uri}" width="160" height="160" />`);
  }
  return out;
}
