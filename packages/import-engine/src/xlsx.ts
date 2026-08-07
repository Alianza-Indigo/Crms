import * as XLSX from 'xlsx';

/**
 * Parse an Excel workbook (PRD §24). The content is the base64-encoded .xlsx
 * bytes; the first sheet is read as an array of row objects keyed by header.
 */
export function parseXlsx(base64: string): Record<string, unknown>[] {
  const buf = Buffer.from(base64, 'base64');
  const wb = XLSX.read(buf, { type: 'buffer' });
  const first = wb.SheetNames[0];
  if (!first) return [];
  const sheet = wb.Sheets[first]!;
  return XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
}
