// Public surface of @crms/database.
// `withTenant` / `withElevated` are the sanctioned data-access entry points.
export * from './client.js';
export { runMigrations } from './migrate.js';

// Re-export the drizzle query helpers so consumers don't depend on drizzle-orm
// directly (keeps the ORM swappable per PRD §34.4).
export {
  eq,
  ne,
  and,
  or,
  not,
  isNull,
  isNotNull,
  inArray,
  notInArray,
  gt,
  gte,
  lt,
  lte,
  like,
  ilike,
  between,
  desc,
  asc,
  count,
} from 'drizzle-orm';
