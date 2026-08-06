import { eq, schema, withTenant } from '@crms/database';
import { newId, NotFound, Forbidden, createLogger } from '@crms/kernel';
import { getContext, buildContext, runWithBuiltContext } from '@crms/tenant-context';
import { chat, type ChatMessage } from '@crms/ai-engine';
import { recordsEngine, type Filter } from '@crms/records-engine';

const logger = createLogger('agent-engine');

/**
 * Tenant AI agent runtime (PRD §23). Runs an agent definition in a tool-use loop
 * bound to the agent's BYO credential and — crucially — the agent's SERVICE
 * ACCOUNT identity, so every tool call goes through the same permission checks as
 * a human/service account. Budget + accessible-module limits are enforced.
 *
 * Tool protocol (kept model-agnostic): the model replies with either plain text
 * or a JSON object {"tool":"query_records|create_record","args":{...}}. The
 * engine executes the tool, appends the result, and continues until the model
 * returns text or the round/budget limit is hit.
 */
const TOOLS_DOC = `You can call tools by replying with ONLY a JSON object:
{"tool":"query_records","args":{"moduleId":"...","filters":[{"field":"...","operator":"eq","value":"..."}]}}
{"tool":"create_record","args":{"moduleId":"...","data":{...}}}
When you have the final answer for the user, reply with plain text (no JSON).`;

export interface AgentTurn {
  text: string;
  toolCalls: Array<{ tool: string; args: unknown; result: unknown }>;
  rounds: number;
}

/** Execute one tool call under the current (agent) context. Exposed for testing. */
export async function executeTool(
  agent: typeof schema.agentDefinitions.$inferSelect,
  call: { tool: string; args: Record<string, unknown> },
): Promise<unknown> {
  const accessible = agent.accessibleModuleIds as string[];
  const moduleId = String(call.args.moduleId ?? '');
  if (accessible.length && moduleId && !accessible.includes(moduleId)) {
    throw Forbidden(`Agent may not access module ${moduleId}`);
  }
  const allowed = agent.allowedActions as string[];
  switch (call.tool) {
    case 'query_records':
      return (await recordsEngine.list({ moduleId, filters: (call.args.filters as Filter[]) ?? [] })).items;
    case 'create_record':
      if (allowed.length && !allowed.includes('create')) throw Forbidden('Agent is not allowed to create records');
      return recordsEngine.create({ moduleId, data: (call.args.data as Record<string, unknown>) ?? {} });
    default:
      return { error: `unknown tool ${call.tool}` };
  }
}

export async function runAgent(agentId: string, userMessage: string, opts: { maxRounds?: number } = {}): Promise<AgentTurn> {
  const parent = getContext();
  const agent = await withTenant(async (tx) => {
    const [row] = await tx.select().from(schema.agentDefinitions).where(eq(schema.agentDefinitions.id, agentId));
    return row ?? null;
  });
  if (!agent || !agent.active) throw NotFound('Agent', agentId);

  // Run as the agent's service account so permissions apply to every tool call.
  let roleIds: string[] = [];
  if (agent.serviceAccountId) {
    const sa = await withTenant(async (tx) => {
      const [row] = await tx.select().from(schema.serviceAccounts).where(eq(schema.serviceAccounts.id, agent.serviceAccountId!));
      return row ?? null;
    });
    roleIds = (sa?.roleIds as string[]) ?? [];
  }
  const agentCtx = buildContext({
    tenantId: agent.tenantId,
    serviceAccountId: agent.serviceAccountId,
    applicationId: agent.applicationId,
    environment: agent.environment as never,
    origin: 'agent',
    correlationId: parent.correlationId,
    roleIds,
  });

  const maxRounds = Math.min(opts.maxRounds ?? Number((agent.limits as { maxRounds?: number }).maxRounds ?? 4), 8);
  const messages: ChatMessage[] = [
    { role: 'system', content: `${agent.instructions ?? ''}\n\n${TOOLS_DOC}` },
    { role: 'user', content: userMessage },
  ];
  const toolCalls: AgentTurn['toolCalls'] = [];

  return runWithBuiltContext(agentCtx, async () => {
    let rounds = 0;
    while (rounds < maxRounds) {
      rounds++;
      const res = await chat({
        provider: agent.provider,
        credentialId: agent.credentialId ?? undefined,
        model: agent.model ?? undefined,
        messages,
        maxTokens: 1500,
      });
      const call = tryParseToolCall(res.text);
      if (!call) {
        logger.info({ agentId, rounds, tools: toolCalls.length }, 'Agent finished');
        return { text: res.text, toolCalls, rounds };
      }
      let result: unknown;
      try {
        result = await executeTool(agent, call);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      toolCalls.push({ tool: call.tool, args: call.args, result });
      messages.push({ role: 'assistant', content: res.text });
      messages.push({ role: 'user', content: `TOOL_RESULT ${JSON.stringify(result).slice(0, 4000)}` });
    }
    return { text: 'Agent reached its round limit.', toolCalls, rounds };
  }) as Promise<AgentTurn>;
}

function tryParseToolCall(text: string): { tool: string; args: Record<string, unknown> } | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const obj = JSON.parse(trimmed) as { tool?: string; args?: Record<string, unknown> };
    if (obj.tool && obj.args) return { tool: obj.tool, args: obj.args };
  } catch {
    /* not a tool call */
  }
  return null;
}

/** Persist an agent execution record for auditability (PRD §23). */
export async function logAgentRun(agentId: string, turn: AgentTurn): Promise<void> {
  const ctx = getContext();
  await withTenant(async (tx) => {
    await tx.insert(schema.activities).values({
      id: newId('activity'),
      tenantId: ctx.tenantId,
      applicationId: ctx.applicationId!,
      environment: ctx.environment,
      type: 'agent.run',
      summary: `Agent ${agentId} ran ${turn.rounds} round(s), ${turn.toolCalls.length} tool call(s)`,
      payload: { agentId, toolCalls: turn.toolCalls },
      actor: ctx.serviceAccountId ?? ctx.userId,
    });
  });
}
