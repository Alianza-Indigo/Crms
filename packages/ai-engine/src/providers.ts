import { credentialManager } from '@crms/credential-engine';
import { meteredFetch } from '@crms/usage-metering';
import { AppError } from '@crms/kernel';

/**
 * AI provider abstraction (PRD §9.5). Every call uses the TENANT's BYO
 * credential — never a platform key, never a cross-tenant fallback. The provider
 * layer normalizes chat + structured output across OpenAI-compatible and
 * Anthropic APIs. Usage is metered without capturing prompt content.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  credentialKey?: string;
  credentialId?: string;
  provider: string;
  model?: string;
  messages: ChatMessage[];
  /** Ask the model to return JSON matching this description. */
  jsonSchemaHint?: string;
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const { secret, credential } = await credentialManager.useSecret({
    key: opts.credentialKey,
    credentialId: opts.credentialId,
  });
  // The credential itself is authoritative about which provider to call — the
  // caller's `provider` is only a fallback. This lets the UI pick a credential
  // by key without also having to send a matching provider string.
  const provider = (credential.provider as string) || opts.provider;
  const o: ChatOptions = { ...opts, provider };
  const model = opts.model ?? (credential.metadata.defaultModel as string) ?? defaultModel(provider);
  const endpoint = credential.metadata.endpoint as string | undefined;

  if (provider === 'anthropic') {
    return anthropicChat(secret, model, o);
  }
  // Google Gemini via its OpenAI-compatible endpoint (same request/response shape).
  if (provider === 'google_ai' || provider === 'gemini' || provider === 'google') {
    return openAiStyleChat(endpoint ?? 'https://generativelanguage.googleapis.com/v1beta/openai', secret, model, o);
  }
  // OpenAI + Azure OpenAI + any OpenAI-compatible endpoint.
  return openaiChat(secret, model, o, endpoint);
}

function defaultModel(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-4-5';
    case 'google_ai':
    case 'gemini':
    case 'google':
      return 'gemini-3.1-flash-lite';
    case 'openai':
    default:
      return 'gpt-4o';
  }
}

function openaiChat(
  secret: Record<string, unknown>,
  model: string,
  opts: ChatOptions,
  endpoint?: string,
): Promise<ChatResult> {
  // OpenAI's chat path lives under /v1; a custom endpoint is a host base.
  return openAiStyleChat(`${endpoint ?? 'https://api.openai.com'}/v1`, secret, model, opts);
}

/**
 * OpenAI-shaped Chat Completions call. Works for OpenAI, Azure OpenAI, any
 * OpenAI-compatible gateway, and Google Gemini's OpenAI-compat endpoint — they
 * only differ in the base URL that precedes `/chat/completions`.
 */
async function openAiStyleChat(
  baseUrl: string,
  secret: Record<string, unknown>,
  model: string,
  opts: ChatOptions,
): Promise<ChatResult> {
  let res: Response;
  try {
    res = await meteredFetch(opts.provider, `${baseUrl}/chat/completions`, {
      method: 'POST',
      kind: 'ai_tokens',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret.apiKey as string}` },
      body: JSON.stringify({
        model,
        messages: opts.messages,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.jsonSchemaHint ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (err) {
    throw new AppError('DEPENDENCY_FAILED', `Could not reach the AI provider at ${baseUrl}: ${(err as Error).message}`, { expose: true });
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new AppError('DEPENDENCY_FAILED', `AI provider error (${res.status}) using model '${model}': ${detail}`, { expose: true });
  }
  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: json.choices[0]?.message.content ?? '',
    usage: { promptTokens: json.usage?.prompt_tokens, completionTokens: json.usage?.completion_tokens },
  };
}

async function anthropicChat(secret: Record<string, unknown>, model: string, opts: ChatOptions): Promise<ChatResult> {
  const system = opts.messages.find((m) => m.role === 'system')?.content;
  const messages = opts.messages.filter((m) => m.role !== 'system');
  const res = await meteredFetch(opts.provider, 'https://api.anthropic.com/v1/messages', {
    method: 'POST',
    kind: 'ai_tokens',
    headers: {
      'content-type': 'application/json',
      'x-api-key': String(secret.apiKey),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, system, messages, max_tokens: opts.maxTokens ?? 2048 }),
  });
  if (!res.ok) throw new AppError('DEPENDENCY_FAILED', `AI provider error (${res.status})`, { expose: true });
  const json = (await res.json()) as {
    content: Array<{ text: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: json.content.map((c) => c.text).join(''),
    usage: { promptTokens: json.usage?.input_tokens, completionTokens: json.usage?.output_tokens },
  };
}
