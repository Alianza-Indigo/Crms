import { and, eq, schema, withTenant } from '@crms/database';
import { newId, NotFound, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import type { DomainEvent } from '@crms/events';
import { recordsEngine } from '@crms/records-engine';
import { executeConnector } from '@crms/integration-engine';
import { chat } from '@crms/ai-engine';
import { evaluateFormula } from '@crms/sandbox-engine';

const logger = createLogger('automation-engine');

/**
 * Automation Engine (PRD §16). A definition is a graph of nodes:
 *   trigger → filter → condition → branch → action → wait → approval → integration
 *
 * Runs are asynchronous, idempotent, retryable and auditable. Loop prevention is
 * enforced by a per-run depth counter against the definition's loopGuard.
 */

export interface AutomationNode {
  id: string;
  type: 'filter' | 'condition' | 'action' | 'wait' | 'branch' | 'approval' | 'integration';
  config: Record<string, unknown>;
  next?: string[];
}

export interface AutomationGraph {
  start?: string;
  nodes: AutomationNode[];
  edges?: Array<{ from: string; to: string; when?: string }>;
}

/**
 * Find automations whose trigger matches an event and enqueue a run for each.
 * Called by the outbox dispatcher for every published event.
 */
export async function onEvent(event: DomainEvent): Promise<string[]> {
  const runIds: string[] = [];
  await withTenant(async (tx) => {
    const defs = await tx
      .select()
      .from(schema.automationDefinitions)
      .where(
        and(
          eq(schema.automationDefinitions.applicationId, event.applicationId ?? ''),
          eq(schema.automationDefinitions.environment, event.environment),
          eq(schema.automationDefinitions.status, 'active'),
        ),
      );
    for (const def of defs) {
      const trigger = def.trigger as { event?: string; moduleId?: string };
      if (trigger.event && trigger.event !== event.type) continue;
      if (trigger.moduleId && trigger.moduleId !== event.moduleId) continue;
      const runId = newId('automation');
      await tx.insert(schema.automationRuns).values({
        id: runId,
        tenantId: event.tenantId,
        applicationId: event.applicationId ?? '',
        environment: event.environment,
        automationId: def.id,
        automationVersion: def.version,
        status: 'queued',
        triggerEvent: event as unknown as Record<string, unknown>,
        idempotencyKey: `${def.id}:${event.id}`,
        correlationId: event.correlationId,
      });
      runIds.push(runId);
    }
  });
  return runIds;
}

/** Execute a queued run. Invoked by the worker. */
export async function runAutomation(runId: string): Promise<void> {
  const ctx = getContext();
  const run = await withTenant(async (tx) => {
    const [row] = await tx.select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runId));
    return row ?? null;
  });
  if (!run) throw NotFound('AutomationRun', runId);
  if (run.status === 'succeeded') return; // idempotent

  const def = await withTenant(async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.automationDefinitions)
      .where(eq(schema.automationDefinitions.id, run.automationId));
    return row ?? null;
  });
  if (!def) throw NotFound('Automation', run.automationId);

  const loopGuard = (def.loopGuard as { maxDepth?: number }).maxDepth ?? 10;
  if (run.depth > loopGuard) {
    await markRun(runId, 'failed', run.stepHistory as unknown[], { message: 'Loop guard exceeded' });
    return;
  }

  const graph = def.graph as AutomationGraph;
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  // Resume from saved state (waits/approvals persist a cursor into run.context).
  const saved = (run.context as RunState) ?? {};
  const context: Record<string, unknown> = saved.vars ?? {
    event: run.triggerEvent,
    record: (run.triggerEvent as DomainEvent).payload?.data ?? {},
  };
  const approvals: Record<string, string> = saved.approvals ?? {};
  const waited: Record<string, boolean> = saved.waited ?? {};
  const history: Array<{ node: string; result: unknown }> = (run.stepHistory as never) ?? [];

  await markRun(runId, 'running', history);
  let current = saved.cursor ? nodeMap.get(saved.cursor) : graph.start ? nodeMap.get(graph.start) : graph.nodes[0];
  let guard = 0;

  try {
    while (current && guard++ < 200) {
      // --- Wait node: pause until resumeAt, then resume past it (PRD §16.1). ---
      if (current.type === 'wait') {
        if (!waited[current.id]) {
          const seconds = Number(current.config.durationSeconds ?? current.config.seconds ?? 0);
          waited[current.id] = true;
          await pauseRun(runId, { vars: context, approvals, waited, cursor: current.id }, history, new Date(Date.now() + seconds * 1000));
          logger.info({ runId, node: current.id, seconds }, 'Automation waiting');
          return;
        }
        current = nextNode(graph, nodeMap, current, true, context);
        continue;
      }

      // --- Approval node: pause until a human decision, then branch on it. ---
      if (current.type === 'approval') {
        const decision = approvals[current.id];
        if (!decision) {
          await requestApproval(current, context);
          await pauseRun(runId, { vars: context, approvals, waited, cursor: current.id }, history, null);
          logger.info({ runId, node: current.id }, 'Automation awaiting approval');
          return;
        }
        history.push({ node: current.id, result: decision });
        context.result = decision;
        current = nextNode(graph, nodeMap, current, decision, context);
        continue;
      }

      const result = await executeNode(current, context);
      history.push({ node: current.id, result });
      context[`step_${current.id}`] = result;
      if (current.type === 'filter' && result === false) break; // filtered out
      current = nextNode(graph, nodeMap, current, result, context);
    }
    await markRun(runId, 'succeeded', history);
    logger.info({ runId, steps: history.length }, 'Automation run succeeded');
  } catch (err) {
    const attempts = run.attempts + 1;
    const dead = attempts >= 5;
    await markRun(runId, dead ? 'dead_letter' : 'failed', history, { message: (err as Error).message }, attempts);
    logger.warn({ runId, err, dead }, 'Automation run failed');
    if (!dead) throw err; // let the queue retry
  }
  void ctx;
}

interface RunState {
  vars?: Record<string, unknown>;
  approvals?: Record<string, string>;
  waited?: Record<string, boolean>;
  cursor?: string;
}

/** Persist a paused run's full state so it can resume exactly where it stopped. */
async function pauseRun(runId: string, state: RunState, history: unknown[], resumeAt: Date | null): Promise<void> {
  await withTenant(async (tx) => {
    await tx
      .update(schema.automationRuns)
      .set({ status: 'waiting', context: state as never, stepHistory: history, resumeAt })
      .where(eq(schema.automationRuns.id, runId));
  });
}

/**
 * Resolve a pending approval (PRD §16). Records the decision against the paused
 * node and re-queues the run so the executor resumes and branches on it.
 */
export async function resolveApproval(runId: string, decision: 'approved' | 'rejected'): Promise<void> {
  await withTenant(async (tx) => {
    const [run] = await tx.select().from(schema.automationRuns).where(eq(schema.automationRuns.id, runId));
    if (!run) throw NotFound('AutomationRun', runId);
    const state = (run.context as RunState) ?? {};
    if (!state.cursor) throw NotFound('pending approval for run', runId);
    const approvals = { ...(state.approvals ?? {}), [state.cursor]: decision };
    await tx
      .update(schema.automationRuns)
      .set({ context: { ...state, approvals } as never, status: 'queued', resumeAt: null })
      .where(eq(schema.automationRuns.id, runId));
  });
}

async function requestApproval(node: AutomationNode, context: Record<string, unknown>): Promise<void> {
  const approverId = String(node.config.approverUserId ?? '');
  if (!approverId) return;
  await createNotification({
    userId: approverId,
    title: interpolateStr(String(node.config.title ?? 'Approval required'), context),
    body: interpolateStr(String(node.config.body ?? 'An automation is awaiting your approval.'), context),
    channel: 'in_app',
  });
}

/**
 * Choose the next node. If the graph declares edges, follow the first edge from
 * the current node whose optional `when` condition evaluates truthy (this is how
 * branches fork). Otherwise fall back to the node's first `next`.
 */
function nextNode(
  graph: AutomationGraph,
  nodeMap: Map<string, AutomationNode>,
  current: AutomationNode,
  result: unknown,
  context: Record<string, unknown>,
): AutomationNode | undefined {
  const edges = (graph.edges ?? []).filter((e) => e.from === current.id);
  if (edges.length) {
    const flat = { ...flatten(context), result: result as never };
    for (const edge of edges) {
      if (!edge.when || !!evaluateFormula(edge.when, flat)) return nodeMap.get(edge.to);
    }
    return undefined;
  }
  const nextId = (current.next ?? [])[0];
  return nextId ? nodeMap.get(nextId) : undefined;
}

async function executeNode(node: AutomationNode, context: Record<string, unknown>): Promise<unknown> {
  switch (node.type) {
    case 'filter':
    case 'condition': {
      const expr = String(node.config.expression ?? 'true');
      return !!evaluateFormula(expr, flatten(context));
    }
    case 'action': {
      const action = String(node.config.action);
      if (action === 'create_record') {
        return recordsEngine.create({
          moduleId: String(node.config.moduleId),
          data: (node.config.data as Record<string, unknown>) ?? {},
        });
      }
      if (action === 'update_record') {
        return recordsEngine.update(
          String(node.config.moduleId),
          String(node.config.recordId),
          (node.config.patch as Record<string, unknown>) ?? {},
        );
      }
      if (action === 'notify') {
        return createNotification({
          userId: String(node.config.userId ?? ''),
          title: interpolateStr(String(node.config.title ?? 'Notification'), context),
          body: interpolateStr(String(node.config.body ?? ''), context),
          channel: String(node.config.channel ?? 'in_app'),
        });
      }
      if (action === 'run_ai') {
        // Runs the tenant's BYO AI on an interpolated prompt (PRD §16.3, §23).
        const result = await chat({
          provider: String(node.config.provider ?? 'openai'),
          credentialKey: node.config.credentialKey as string | undefined,
          credentialId: node.config.credentialId as string | undefined,
          messages: [
            ...(node.config.system ? [{ role: 'system' as const, content: String(node.config.system) }] : []),
            { role: 'user' as const, content: interpolateStr(String(node.config.prompt ?? ''), context) },
          ],
          maxTokens: Number(node.config.maxTokens ?? 1024),
        });
        return { text: result.text };
      }
      return { skipped: action };
    }
    case 'integration':
      return executeConnector(String(node.config.integrationId), {
        variables: context,
        overrideBody: node.config.body,
      });
    case 'wait':
    case 'approval':
    case 'branch':
    default:
      return { type: node.type, noop: true };
  }
}

function flatten(context: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  const record = context.record as Record<string, unknown> | undefined;
  if (record) for (const [k, v] of Object.entries(record)) out[k] = v as never;
  return out;
}

function interpolateStr(template: string, context: Record<string, unknown>): string {
  const flat = flatten(context);
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => String(flat[key] ?? ''));
}

async function createNotification(input: {
  userId: string;
  title: string;
  body: string;
  channel: string;
}): Promise<{ notificationId: string }> {
  const ctx = getContext();
  const id = newId('notification');
  await withTenant(async (tx) => {
    await tx.insert(schema.notifications).values({
      id,
      tenantId: ctx.tenantId,
      applicationId: ctx.applicationId,
      userId: input.userId,
      channel: input.channel,
      title: input.title,
      body: input.body,
    });
  });
  return { notificationId: id };
}

async function markRun(
  runId: string,
  status: (typeof schema.runStatusEnum.enumValues)[number],
  history: unknown[],
  error?: unknown,
  attempts?: number,
): Promise<void> {
  await withTenant(async (tx) => {
    await tx
      .update(schema.automationRuns)
      .set({
        status,
        stepHistory: history,
        error: error ?? null,
        attempts: attempts ?? undefined,
        startedAt: status === 'running' ? new Date() : undefined,
        finishedAt: ['succeeded', 'failed', 'dead_letter', 'cancelled'].includes(status) ? new Date() : undefined,
      })
      .where(eq(schema.automationRuns.id, runId));
  });
}
