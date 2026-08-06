import { z } from 'zod';

export const FIELD_TYPES = [
  'text_short', 'text_long', 'text_rich', 'integer', 'decimal', 'currency', 'percent',
  'date', 'time', 'datetime', 'duration', 'email', 'phone', 'url', 'boolean', 'select',
  'multi_select', 'status', 'user', 'team', 'file', 'image', 'signature', 'location',
  'coordinates', 'color', 'code', 'json', 'auto_id', 'relation', 'formula', 'computed',
  'rollup', 'count', 'autonumber', 'qr', 'barcode', 'ai_generated',
] as const;

export const ModuleInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'key must be snake_case'),
  name: z.string().min(1),
  namePlural: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  description: z.string().optional(),
});
export type ModuleInput = z.infer<typeof ModuleInputSchema>;

export const FieldInputSchema = z.object({
  moduleId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/, 'key must be snake_case'),
  name: z.string().min(1),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  indexed: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  config: z.record(z.unknown()).default({}),
  validations: z.array(z.record(z.unknown())).default([]),
  helpText: z.string().optional(),
});
export type FieldInput = z.infer<typeof FieldInputSchema>;

export const RelationInputSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  type: z.enum(['one_to_one', 'one_to_many', 'many_to_many', 'polymorphic', 'hierarchical', 'self']),
  sourceModuleId: z.string(),
  targetModuleId: z.string(),
  onDelete: z.enum(['restrict', 'cascade', 'set_null', 'unlink']).default('restrict'),
  inverseName: z.string().optional(),
  required: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
});
export type RelationInput = z.infer<typeof RelationInputSchema>;

/** A change flagged as destructive requires impact analysis + confirmation. */
export interface DestructiveChange {
  operation: string;
  target: string;
  reason: string;
  affectedRecords?: number;
}
