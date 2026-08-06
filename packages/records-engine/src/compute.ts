import { and, eq, inArray, schema, sql, type DbExecutor } from '@crms/database';
import { evaluateFormula } from '@crms/sandbox-engine';
import { createLogger } from '@crms/kernel';
import type { Projection } from './validation.js';

const logger = createLogger('records-engine:compute');

type FieldDef = typeof schema.fieldDefinitions.$inferSelect;

interface Scope {
  tenantId: string;
  applicationId: string;
  environment: string;
}

/**
 * Compute derived field values (PRD §11.3): formula, computed, autonumber. These
 * depend only on the record's own values (+ an autonumber counter), so they run
 * before insert. Rollup/count depend on related records and are computed
 * separately (recomputeAggregates) since they can change as relations change.
 */
export async function computeSelfDerived(
  tx: DbExecutor,
  scope: Scope,
  moduleId: string,
  fields: FieldDef[],
  data: Record<string, unknown>,
): Promise<{ values: Record<string, unknown>; projections: Projection[] }> {
  const values: Record<string, unknown> = {};
  const projections: Projection[] = [];
  const flat = flatten(data);

  for (const field of fields) {
    if (field.deletedAt) continue;
    const cfg = field.config as Record<string, unknown>;
    try {
      if (field.type === 'formula' || field.type === 'computed') {
        const expr = String(cfg.expression ?? '');
        if (!expr) continue;
        const result = evaluateFormula(expr, flat);
        values[field.key] = result;
        projections.push(projectionFor(field, result));
      } else if (field.type === 'autonumber' || field.type === 'auto_id') {
        // Next number = current max for this module + 1 (per tenant/app/env).
        const rows = await tx
          .select({ n: sql<string>`coalesce(max((value_number)::numeric), 0)` })
          .from(schema.recordValues)
          .where(
            and(
              eq(schema.recordValues.applicationId, scope.applicationId),
              eq(schema.recordValues.environment, scope.environment),
              eq(schema.recordValues.moduleId, moduleId),
              eq(schema.recordValues.fieldId, field.id),
            ),
          );
        const next = Number(rows[0]?.n ?? 0) + 1;
        const prefix = String(cfg.prefix ?? '');
        const padded = prefix ? `${prefix}${String(next).padStart(Number(cfg.pad ?? 0), '0')}` : next;
        values[field.key] = padded;
        projections.push({ fieldId: field.id, fieldKey: field.key, number: String(next), text: String(padded) });
      }
    } catch (err) {
      logger.warn({ err, field: field.key }, 'Derived field computation failed; leaving null');
    }
  }
  return { values, projections };
}

/**
 * Recompute rollup + count fields for a record from its related records
 * (PRD §11.4). Called after relations change. Returns patch to merge into data.
 */
export async function recomputeAggregates(
  tx: DbExecutor,
  scope: Scope,
  moduleId: string,
  recordId: string,
  fields: FieldDef[],
): Promise<{ values: Record<string, unknown>; projections: Projection[] }> {
  const values: Record<string, unknown> = {};
  const projections: Projection[] = [];

  for (const field of fields) {
    if (field.deletedAt) continue;
    const cfg = field.config as Record<string, unknown>;
    if (field.type !== 'rollup' && field.type !== 'count') continue;
    const relationId = String(cfg.relationId ?? '');
    if (!relationId) continue;

    const related = await tx
      .select({ targetId: schema.recordRelations.targetRecordId })
      .from(schema.recordRelations)
      .where(
        and(
          eq(schema.recordRelations.relationId, relationId),
          eq(schema.recordRelations.sourceRecordId, recordId),
        ),
      );
    const targetIds = related.map((r) => r.targetId);

    if (field.type === 'count') {
      values[field.key] = targetIds.length;
      projections.push({ fieldId: field.id, fieldKey: field.key, number: String(targetIds.length) });
      continue;
    }

    // rollup: aggregate a target field across related records.
    const targetFieldKey = String(cfg.targetFieldKey ?? '');
    const aggregate = String(cfg.aggregate ?? 'sum');
    let result = 0;
    if (targetIds.length && targetFieldKey) {
      const vals = await tx
        .select({ n: schema.recordValues.valueNumber })
        .from(schema.recordValues)
        .where(
          and(
            inArray(schema.recordValues.recordId, targetIds),
            eq(schema.recordValues.fieldKey, targetFieldKey),
          ),
        );
      const numbers = vals.map((v) => Number(v.n ?? 0));
      result = applyAggregate(aggregate, numbers);
    }
    values[field.key] = result;
    projections.push({ fieldId: field.id, fieldKey: field.key, number: String(result) });
  }
  return { values, projections };
}

function applyAggregate(kind: string, numbers: number[]): number {
  if (!numbers.length) return 0;
  switch (kind) {
    case 'sum':
      return numbers.reduce((a, b) => a + b, 0);
    case 'avg':
      return numbers.reduce((a, b) => a + b, 0) / numbers.length;
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
    case 'count':
      return numbers.length;
    default:
      return numbers.reduce((a, b) => a + b, 0);
  }
}

function projectionFor(field: FieldDef, value: unknown): Projection {
  if (typeof value === 'number') return { fieldId: field.id, fieldKey: field.key, number: String(value) };
  if (typeof value === 'boolean') return { fieldId: field.id, fieldKey: field.key, bool: value };
  return { fieldId: field.id, fieldKey: field.key, text: value == null ? undefined : String(value) };
}

function flatten(data: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(data)) if (v === null || typeof v !== 'object') out[k] = v as never;
  return out;
}
