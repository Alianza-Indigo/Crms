import { z } from 'zod';

/**
 * Cursor pagination. PRD §41 mandates that NO view ever loads a full
 * collection — every list endpoint paginates. This is the shared contract.
 */
export const PageParamsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type PageParams = z.infer<typeof PageParamsSchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function encodeCursor(value: { id: string; sort?: string | number }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { id: string; sort?: string | number } | null {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function buildPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ id: last.id }) : null,
  };
}
