import { ValidationError, createLogger } from '@crms/kernel';
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
Given a description of a business or process, design the data model as a JSON object with this exact shape:
{
  "summary": "one paragraph describing what you will build",
  "operations": [
    { "op": "create_module", "args": { "key": "snake_case", "name": "Singular", "namePlural": "Plural" } },
    { "op": "create_field", "args": { "moduleKey": "snake_case", "key": "snake_case", "name": "Label", "type": "text_short|text_long|integer|decimal|currency|date|datetime|email|phone|url|boolean|select|multi_select|status|user|file", "required": false, "config": {} } },
    { "op": "create_relation", "args": { "key": "snake_case", "name": "Label", "type": "one_to_many|many_to_many", "sourceModuleKey": "snake_case", "targetModuleKey": "snake_case" } }
  ]
}
Rules: use snake_case keys; select/status fields must include config.options as [{"value","label"}]; keep it focused (5-8 modules max). Output ONLY the JSON, no prose, no code fences.`;

function extractJson(text: string): unknown {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw ValidationError('AI did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
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
}): Promise<{ planId: string; plan: AiPlanInput }> {
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
    maxTokens: 4000,
  });

  const raw = extractJson(result.text) as { summary?: string; operations?: unknown[] };
  const operations = (raw.operations ?? []).map((op) => {
    const o = op as { op: string; args: Record<string, unknown> };
    return { op: o.op as never, args: o.args, destructive: false };
  });
  const planInput = AiPlanInputSchema.parse({
    summary: raw.summary ?? 'AI-generated application',
    operations,
    requiredCredentials: [],
  });
  const planId = await aiPlanService.create(planInput);
  logger.info({ planId, operations: operations.length }, 'AI generated an application plan');
  return { planId, plan: planInput };
}
