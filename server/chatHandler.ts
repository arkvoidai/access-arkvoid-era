import {
  checkAndConsumeLimits,
  createSessionToken,
  type EnvMap,
  type LimitErrorCode,
} from './limits.ts';
import { buildSystemPrompt, buildUserMessage } from './prompt.ts';
import {
  parseAndValidateModelTurn,
  validateChatRequest,
  type ValidatedModelTurn,
} from './schema.ts';

export interface ChatSuccessResponse {
  turn: ValidatedModelTurn;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
}

export interface ChatErrorResponse {
  error: LimitErrorCode;
}

export type ChatResult = {
  status: number;
  body: ChatSuccessResponse | ChatErrorResponse;
};

export interface SessionResult {
  status: number;
  body: {
    token: string;
    sessionCap: number;
    dailyCap: number;
    requiresCode: boolean;
    live: boolean;
  };
}

export interface HealthResult {
  status: number;
  body: {
    ok: true;
    live: boolean;
    provider: 'mistral';
    model: string;
  };
}

export function getEnvFromProcess(): EnvMap {
  const p = typeof process !== 'undefined' && process.env ? process.env : {};
  return {
    MISTRAL_API_KEY: p.MISTRAL_API_KEY ?? '',
    MISTRAL_MODEL: p.MISTRAL_MODEL ?? '',
    LIVE_AI_ENABLED: p.LIVE_AI_ENABLED ?? '',
    ACCESS_CODES: p.ACCESS_CODES ?? '',
    SESSION_SECRET: p.SESSION_SECRET ?? '',
    DAILY_CALL_CAP: p.DAILY_CALL_CAP ?? '',
    SESSION_CALL_CAP: p.SESSION_CALL_CAP ?? '',
    INDEXABLE: p.INDEXABLE ?? '',
    UPSTASH_REDIS_REST_URL: p.UPSTASH_REDIS_REST_URL ?? '',
    UPSTASH_REDIS_REST_TOKEN: p.UPSTASH_REDIS_REST_TOKEN ?? '',
  };
}

export function isLiveEnabled(env: EnvMap): boolean {
  const key = (env.MISTRAL_API_KEY ?? '').trim();
  const enabledFlag = (env.LIVE_AI_ENABLED ?? '').trim().toLowerCase();
  if (!key) return false;
  if (enabledFlag === 'false' || enabledFlag === '0') return false;
  return true;
}

export function getModelName(env: EnvMap): string {
  const m = (env.MISTRAL_MODEL ?? '').trim();
  return m.length > 0 ? m : 'mistral-small-latest';
}

export async function handleHealth(env: EnvMap = getEnvFromProcess()): Promise<HealthResult> {
  return {
    status: 200,
    body: {
      ok: true,
      live: isLiveEnabled(env),
      provider: 'mistral',
      model: getModelName(env),
    },
  };
}

export async function handleSession(
  _input: unknown,
  env: EnvMap = getEnvFromProcess()
): Promise<SessionResult> {
  const session = createSessionToken(env);
  return {
    status: 200,
    body: {
      ...session,
      live: isLiveEnabled(env),
    },
  };
}

async function callMistralOnce(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
}): Promise<{
  turn: ValidatedModelTurn;
  usage?: { inputTokens: number; outputTokens: number };
} | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userMessage },
        ],
        temperature: 0.7,
        max_tokens: 400,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const rawContent = data?.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string') return null;

    const turn = parseAndValidateModelTurn(rawContent);
    if (!turn) return null;

    const promptTokens = data?.usage?.prompt_tokens;
    const completionTokens = data?.usage?.completion_tokens;
    const usage =
      typeof promptTokens === 'number' && typeof completionTokens === 'number'
        ? { inputTokens: promptTokens, outputTokens: completionTokens }
        : undefined;

    return { turn, usage };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleChat(
  input: { body: unknown; ip?: string },
  env: EnvMap = getEnvFromProcess()
): Promise<ChatResult> {
  if (!isLiveEnabled(env)) {
    return { status: 200, body: { error: 'unavailable' } };
  }

  const validated = validateChatRequest(input.body);
  if (!validated) {
    return { status: 400, body: { error: 'unavailable' } };
  }

  const limitCheck = await checkAndConsumeLimits({
    ip: input.ip || '127.0.0.1',
    sessionToken: validated.sessionToken,
    accessCode: validated.accessCode,
    env,
  });

  if (!limitCheck.ok) {
    return { status: 429, body: { error: limitCheck.error } };
  }

  const apiKey = (env.MISTRAL_API_KEY ?? '').trim();
  const model = getModelName(env);
  const systemPrompt = buildSystemPrompt(validated.characterId, validated.context);
  const userMessage = buildUserMessage(validated.playerText, validated.context);

  // Attempt 1
  let result = await callMistralOnce({ apiKey, model, systemPrompt, userMessage });
  // Retry at most once on failure
  if (!result) {
    result = await callMistralOnce({ apiKey, model, systemPrompt, userMessage });
  }

  if (!result) {
    return { status: 200, body: { error: 'unavailable' } };
  }

  return {
    status: 200,
    body: {
      turn: result.turn,
      usage: result.usage,
      model,
    },
  };
}
