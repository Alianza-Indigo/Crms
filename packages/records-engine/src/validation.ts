import { schema } from '@crms/database';
import { ValidationError } from '@crms/kernel';

type FieldDef = typeof schema.fieldDefinitions.$inferSelect;

export interface Projection {
  fieldId: string;
  fieldKey: string;
  text?: string;
  number?: string;
  bool?: boolean;
  date?: Date;
  json?: unknown;
}

/**
 * Validate + normalize record data against field definitions and produce the
 * typed projections written to record_values for indexing/filtering/rollups.
 * Server-side validation is authoritative (PRD §49.3 — never trust the frontend).
 */
export async function validateValues(
  fields: FieldDef[],
  data: Record<string, unknown>,
  opts: { mode: 'create' | 'update' },
): Promise<{ normalized: Record<string, unknown>; projections: Projection[] }> {
  const normalized: Record<string, unknown> = {};
  const projections: Projection[] = [];
  const errors: string[] = [];

  // These field types are computed by the engine, not supplied by the user, so
  // they are never validated/coerced here (they are recomputed on write).
  const DERIVED_TYPES = new Set(['formula', 'computed', 'rollup', 'count', 'autonumber', 'auto_id']);

  for (const field of fields) {
    if (field.deletedAt) continue;
    if (DERIVED_TYPES.has(field.type)) continue;
    const raw = data[field.key];
    const present = raw !== undefined && raw !== null && raw !== '';

    if (field.required && !present && opts.mode === 'create') {
      errors.push(`Field '${field.key}' is required`);
      continue;
    }
    if (!present) {
      if (raw === null) normalized[field.key] = null;
      continue;
    }

    try {
      const { value, projection } = coerce(field, raw);
      normalized[field.key] = value;
      projections.push({ fieldId: field.id, fieldKey: field.key, ...projection });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Invalid value for '${field.key}'`);
    }
  }

  if (errors.length) throw ValidationError('Record validation failed', { errors });
  return { normalized, projections };
}

function coerce(field: FieldDef, raw: unknown): { value: unknown; projection: Omit<Projection, 'fieldId' | 'fieldKey'> } {
  switch (field.type) {
    case 'integer':
    case 'autonumber':
    case 'count': {
      const n = Number(raw);
      if (!Number.isInteger(n)) throw new Error(`Field '${field.key}' must be an integer`);
      return { value: n, projection: { number: String(n) } };
    }
    case 'decimal':
    case 'currency':
    case 'percent': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`Field '${field.key}' must be a number`);
      return { value: n, projection: { number: String(n) } };
    }
    case 'boolean': {
      const b = raw === true || raw === 'true' || raw === 1;
      return { value: b, projection: { bool: b } };
    }
    case 'date':
    case 'datetime':
    case 'time': {
      const d = new Date(raw as string);
      if (Number.isNaN(d.getTime())) throw new Error(`Field '${field.key}' must be a valid date`);
      return { value: d.toISOString(), projection: { date: d, text: d.toISOString() } };
    }
    case 'email': {
      const s = String(raw);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new Error(`Field '${field.key}' must be a valid email`);
      return { value: s, projection: { text: s } };
    }
    case 'select':
    case 'status': {
      const options = ((field.config as Record<string, unknown>).options as Array<{ value: string }>) ?? [];
      const s = String(raw);
      if (options.length && !options.some((o) => o.value === s)) {
        throw new Error(`Field '${field.key}' value '${s}' is not an allowed option`);
      }
      return { value: s, projection: { text: s } };
    }
    case 'multi_select': {
      const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      return { value: arr, projection: { text: arr.join(','), json: arr } };
    }
    case 'json':
    case 'location':
    case 'coordinates':
    case 'signature': {
      return { value: raw, projection: { json: raw } };
    }
    default: {
      const s = String(raw);
      return { value: s, projection: { text: s } };
    }
  }
}
