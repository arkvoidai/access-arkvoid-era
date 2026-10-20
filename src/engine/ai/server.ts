import type { CharacterId, ModelTurn } from '../types.ts';

export interface ServerContextPayload {
  timeLabel: string;
  partOfDay: string;
  placeName: string;
  activity: string;
  trust: number;
  inventory: string[];
  memories: Array<{
    id: string;
    timeLabel: string;
    summary: string;
  }>;
}

export interface ServerChatSuccess {
  ok: true;
  turn: ModelTurn;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface ServerChatFailure {
  ok: false;
  error: string;
}

let lastCallFinishedAt = 0;
let activeInFlight = false;

async function waitForRateSpacing(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallFinishedAt;
  if (elapsed < 1200 && lastCallFinishedAt > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1200 - elapsed));
  }
}

export async function fetchHealthStatus(): Promise<{
  live: boolean;
  model: string;
}> {
  if (typeof fetch === 'undefined') {
    return { live: false, model: 'mistral-small-latest' };
  }
  try {
    const res = await fetch('/api/health', { method: 'GET' });
    if (!res.ok) return { live: false, model: 'mistral-small-latest' };
    const data = (await res.json()) as { live?: boolean; model?: string };
    return {
      live: Boolean(data.live),
      model: typeof data.model === 'string' ? data.model : 'mistral-small-latest',
    };
  } catch {
    return { live: false, model: 'mistral-small-latest' };
  }
}

export async function fetchSessionToken(): Promise<{
  token: string;
  sessionCap: number;
  dailyCap: number;
  live: boolean;
} | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const res = await fetch('/api/session', { method: 'POST' });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      token?: string;
      sessionCap?: number;
      dailyCap?: number;
      live?: boolean;
    };
    if (!data.token) return null;
    return {
      token: data.token,
      sessionCap: data.sessionCap ?? 20,
      dailyCap: data.dailyCap ?? 150,
      live: Boolean(data.live),
    };
  } catch {
    return null;
  }
}

async function postChatOnce(payload: {
  characterId: CharacterId;
  playerText: string;
  context: ServerContextPayload;
  sessionToken?: string;
}): Promise<ServerChatSuccess | ServerChatFailure> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = (await res.json()) as {
      turn?: ModelTurn;
      usage?: { inputTokens: number; outputTokens: number };
      error?: string;
    };

    if (!res.ok || data.error || !data.turn) {
      return { ok: false, error: data.error || `http_${res.status}` };
    }

    return {
      ok: true,
      turn: data.turn,
      usage: data.usage,
    };
  } catch {
    return { ok: false, error: 'network' };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchChatTurn(payload: {
  characterId: CharacterId;
  playerText: string;
  context: ServerContextPayload;
  sessionToken?: string;
}): Promise<ServerChatSuccess | ServerChatFailure> {
  if (typeof fetch === 'undefined' || activeInFlight) {
    return { ok: false, error: 'busy_or_offline' };
  }

  activeInFlight = true;
  try {
    await waitForRateSpacing();
    let res = await postChatOnce(payload);
    // One retry on network error only
    if (!res.ok && res.error === 'network') {
      res = await postChatOnce(payload);
    }
    return res;
  } finally {
    lastCallFinishedAt = Date.now();
    activeInFlight = false;
  }
}
