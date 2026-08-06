import { randomUUID, randomBytes } from 'node:crypto';

/**
 * Prefixed, sortable-ish identifiers. Prefixes make ids self-describing in logs
 * and prevent accidentally passing (say) a credential id where a record id is
 * expected. The body is a UUIDv4 for collision resistance.
 */
export const ID_PREFIXES = {
  tenant: 'ten',
  reseller: 'res',
  user: 'usr',
  membership: 'mem',
  role: 'rol',
  team: 'tea',
  branch: 'bra',
  application: 'app',
  module: 'mod',
  field: 'fld',
  relation: 'rel',
  view: 'viw',
  form: 'frm',
  dashboard: 'dsh',
  workflow: 'wfl',
  automation: 'aut',
  document: 'doc',
  portal: 'por',
  integration: 'int',
  credential: 'cred',
  agent: 'agt',
  record: 'rec',
  file: 'fil',
  comment: 'cmt',
  activity: 'act',
  audit: 'aud',
  notification: 'ntf',
  subscription: 'sub',
  usage: 'usg',
  apikey: 'key',
  serviceAccount: 'svc',
  deployment: 'dep',
  outbox: 'obx',
  webhook: 'whk',
  aiConversation: 'conv',
  aiSession: 'sess',
  aiPlan: 'plan',
  aiExecution: 'exec',
  featureFlag: 'flag',
  session: 'ses',
  event: 'evt',
} as const;

export type IdName = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[IdName];

/** Create a prefixed id from an entity name, e.g. newId('record') -> 'rec_<uuid>'. */
export function newId(name: IdName): string {
  return `${ID_PREFIXES[name]}_${randomUUID()}`;
}

/** High-entropy opaque token (API keys, session tokens, webhook secrets). */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Deterministic hash-friendly correlation id. */
export function newCorrelationId(): string {
  return `cor_${randomUUID()}`;
}
