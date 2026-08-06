import { z } from 'zod';
import { newId } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';

/**
 * Internal domain event contract (PRD §40). Every event carries full tenant
 * context and a correlation id. Events are versioned and persisted via the
 * transactional outbox; this module defines the canonical shape + factory.
 */
export const DomainEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  schemaVersion: z.number().int().default(1),
  tenantId: z.string(),
  applicationId: z.string().nullable(),
  moduleId: z.string().nullable().optional(),
  recordId: z.string().nullable().optional(),
  environment: z.string(),
  actor: z.string().nullable(),
  correlationId: z.string(),
  timestamp: z.string(),
  changes: z.record(z.unknown()).optional(),
  payload: z.record(z.unknown()).default({}),
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;

/** Canonical event type names. Extend as domains grow; keep versioned. */
export const EVENT_TYPES = {
  recordCreated: 'record.created',
  recordUpdated: 'record.updated',
  recordArchived: 'record.archived',
  recordRestored: 'record.restored',
  recordDeleted: 'record.deleted',
  stageChanged: 'record.stage_changed',
  fieldChanged: 'record.field_changed',
  formSubmitted: 'form.submitted',
  paymentReceived: 'payment.received',
  fileReceived: 'file.received',
  userCreated: 'user.created',
  approvalResponded: 'approval.responded',
  agentFinished: 'agent.finished',
  webhookReceived: 'webhook.received',
  schemaPublished: 'schema.published',
  deploymentCompleted: 'deployment.completed',
  credentialInvalid: 'credential.invalid',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/**
 * Build a domain event from the ambient tenant context. The result is what the
 * records-engine writes into the outbox within the mutation transaction.
 */
export function buildEvent(input: {
  type: string;
  moduleId?: string | null;
  recordId?: string | null;
  changes?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  schemaVersion?: number;
  timestamp?: Date;
}): DomainEvent {
  const ctx = getContext();
  return DomainEventSchema.parse({
    id: newId('event'),
    type: input.type,
    schemaVersion: input.schemaVersion ?? 1,
    tenantId: ctx.tenantId,
    applicationId: ctx.applicationId,
    moduleId: input.moduleId ?? null,
    recordId: input.recordId ?? null,
    environment: ctx.environment,
    actor: ctx.userId ?? ctx.serviceAccountId,
    correlationId: ctx.correlationId,
    timestamp: (input.timestamp ?? new Date()).toISOString(),
    changes: input.changes,
    payload: input.payload ?? {},
  });
}
