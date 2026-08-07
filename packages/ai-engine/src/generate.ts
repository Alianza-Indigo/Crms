import { schema, withTenant } from '@crms/database';
import { newId, ValidationError, createLogger } from '@crms/kernel';
import { getContext } from '@crms/tenant-context';
import { chat, type ChatMessage } from './providers.js';
import { aiPlanService, AiPlanInputSchema, type AiPlanInput } from './plan.js';

const logger = createLogger('ai-engine:generate');

/**
 * AI application generation (PRD §9.1). Turns a natural-language description of a
 * business into a structured, persisted AIPlan of schema operations that the
 * user reviews and approves before execution. The model is constrained to emit
 * JSON matching our operation schema; the platform validates it before saving —
 * the AI never mutates the app directly.
 */
const SYSTEM_PROMPT = `You are the architect of a multi-tenant business-application platform.
Given a description of a business or process, design a COMPLETE, usable application — not just the data model, but the views, capture forms, sales/process pipelines, dashboards and follow-up automations a team would actually use.

Return ONE JSON object with this exact shape:
{
  "summary": "one paragraph describing what you will build",
  "operations": [
    { "op": "create_module", "args": { "key": "snake_case", "name": "Singular", "namePlural": "Plural", "icon": "📇" } },
    { "op": "create_field", "args": { "moduleKey": "snake_case", "key": "snake_case", "name": "Label", "type": "text_short|text_long|integer|decimal|currency|percent|date|datetime|email|phone|url|boolean|select|multi_select|status|user|file", "required": false, "config": {} } },
    { "op": "create_relation", "args": { "key": "snake_case", "name": "Label", "type": "one_to_many|many_to_many", "sourceModuleKey": "snake_case", "targetModuleKey": "snake_case" } },
    { "op": "create_view", "args": { "moduleKey": "snake_case", "key": "snake_case", "name": "Label", "type": "table|kanban|calendar|gallery|list" } },
    { "op": "create_form", "args": { "moduleKey": "snake_case", "key": "snake_case", "name": "Label", "kind": "internal|public" } },
    { "op": "create_pipeline", "args": { "moduleKey": "snake_case", "key": "snake_case", "name": "Label", "stages": [{"key":"snake_case","name":"Label"}], "transitions": [{"from":"stage_key","to":"stage_key"}] } },
    { "op": "create_dashboard", "args": { "key": "snake_case", "name": "Label", "widgets": [{ "key": "snake_case", "title": "Label", "type": "metric|bar", "moduleKey": "snake_case", "aggregate": "count|sum|avg", "field": "field_key", "groupBy": "field_key_or_stage" }] } },
    { "op": "create_automation", "args": { "key": "snake_case", "name": "Label", "trigger": { "event": "record.created|record.updated|record.stage_changed", "moduleKey": "snake_case" }, "graph": { "start": "a1", "nodes": [{ "id": "a1", "type": "action", "config": { "action": "notify|create_record|update_record|run_ai", "message": "..." } }], "edges": [] } },
    { "op": "create_role", "args": { "name": "Label", "description": "...", "permissions": ["record:create", "record:read", "record:update"] } },
    { "op": "create_document_template", "args": { "key": "snake_case", "name": "Label", "moduleKey": "snake_case", "html": "<h1>{{title}}</h1><p>{{field_key}}</p>" } },
    { "op": "create_portal", "args": { "key": "snake_case", "name": "Label", "audience": "clients", "moduleKeys": ["snake_case"] } },
    { "op": "create_agent", "args": { "name": "Label", "purpose": "...", "instructions": "...", "provider": "google_ai", "accessibleModuleKeys": ["snake_case"], "allowedActions": ["read_records", "create_record"] } }
  ]
}
Rules:
- Use snake_case keys everywhere. select/status fields MUST include config.options as [{"value","label"}].
- ORDER matters: emit create_module first, then create_field and create_relation, then create_view/create_form/create_pipeline/create_dashboard/create_automation which reference modules by their key.
- Design for real use: for the main process module add a "status" field, a pipeline whose stages match it, and a kanban view; add a public capture form for lead/intake modules; add at least one dashboard with 2-3 widgets; add 1-2 follow-up automations.
- Also add: 2-3 roles with sensible permissions; a document template for any contract/quote/invoice concept referencing field keys; a client portal exposing the customer-facing module(s) when the domain has external users; and 1 AI agent scoped to the main modules.
- Keep it focused: 4-8 modules. Output ONLY the JSON, no prose, no code fences.`;

function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) throw ValidationError('AI did not return JSON');
  // Scan for the first BALANCED object so trailing prose/objects the model may
  // append after the JSON don't break parsing (string-aware brace matching).
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]!;
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw ValidationError('AI returned malformed or truncated JSON');
}

/**
 * Resolve module keys → ids after modules are created, so field/relation
 * operations can reference the real module ids the schema engine expects.
 * Because keys are only known at execution time, we translate on the fly by
 * embedding the key in args and letting execution map it. Here we pre-persist
 * the plan with keys; execution resolves keys → ids.
 */
export async function generatePlanFromPrompt(input: {
  prompt: string;
  provider: string;
  credentialKey?: string;
  credentialId?: string;
}): Promise<{ planId: string; plan: AiPlanInput; conversationId: string }> {
  const ctx = getContext();
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: input.prompt },
  ];
  const result = await chat({
    provider: input.provider,
    credentialKey: input.credentialKey,
    credentialId: input.credentialId,
    messages,
    jsonSchemaHint: 'application design',
    maxTokens: 8000,
  });

  const raw = extractJson(result.text) as { summary?: string; operations?: unknown[] };
  const operations = (raw.operations ?? []).map((op) => {
    const o = op as { op: string; args: Record<string, unknown> };
    return { op: o.op as never, args: o.args, destructive: false };
  });

  // Persist the conversation + session for traceability (PRD §9.3). The session
  // records the assistant turn + provider usage (tokens/counts), not prompts as
  // metering — this is the tenant's own conversation history.
  const conversationId = newId('aiConversation');
  await withTenant(async (tx) => {
    await tx.insert(schema.aiConversations).values({
      id: conversationId,
      tenantId: ctx.tenantId,
      applicationId: ctx.applicationId,
      environment: ctx.environment,
      title: input.prompt.slice(0, 80),
      userId: ctx.userId,
    });
    await tx.insert(schema.aiSessions).values({
      id: newId('aiSession'),
      tenantId: ctx.tenantId,
      conversationId,
      provider: input.provider,
      credentialId: input.credentialId,
      messages: [...messages, { role: 'assistant', content: result.text }] as never,
      usage: (result.usage ?? {}) as never,
    });
  });

  const planInput = AiPlanInputSchema.parse({
    summary: raw.summary ?? 'AI-generated application',
    operations,
    conversationId,
    requiredCredentials: [],
  });
  const planId = await aiPlanService.create(planInput);
  logger.info({ planId, conversationId, operations: operations.length }, 'AI generated an application plan');
  return { planId, plan: planInput, conversationId };
}
