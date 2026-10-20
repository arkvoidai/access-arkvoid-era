import crypto from 'node:crypto';

export type LimitErrorCode = 'cap' | 'code' | 'burst' | 'unavailable';

export interface EnvMap {
  MISTRAL_API_KEY?: string;
  MISTRAL_MODEL?: string;
  LIVE_AI_ENABLED?: string;
  ACCESS_CODES?: string;
  SESSION_SECRET?: string;
  DAILY_CALL_CAP?: string;
  SESSION_CALL_CAP?: string;
  INDEXABLE?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
}

const fallbackSecret = crypto.randomBytes(32).toString('hex');

const memoryCounters = new Map<string, { count: number; expiresAt: number }>();
const burstBuckets = new Map<string, number[]>();

function getSecret(env: EnvMap): string {
  const s = (env.SESSION_SECRET ?? '').trim();
  return s.length > 0 ? s : fallbackSecret;
}

export function createSessionToken(env: EnvMap): {
  token: string;
  sessionCap: number;
  dailyCap: number;
  requiresCode: boolean;
} {
  const sessionId = crypto.randomBytes(12).toString('hex');
  const issuedAt = Date.now();
  const payload = `${sessionId}.${issuedAt}`;
  const hmac = crypto.createHmac('sha256', getSecret(env)).update(payload).digest('hex');
  const sessionCap = parsePositiveInt(env.SESSION_CALL_CAP, 20);
  const dailyCap = parsePositiveInt(env.DAILY_CALL_CAP, 150);
  const codes = parseAccessCodes(env.ACCESS_CODES);
  return {
    token: `${payload}.${hmac}`,
    sessionCap,
    dailyCap,
    requiresCode: codes.length > 0,
  };
}

export function verifySessionToken(token: string | undefined, env: EnvMap): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, issuedAtStr, sig] = parts;
  if (!sessionId || !issuedAtStr || !sig) return null;
  const payload = `${sessionId}.${issuedAtStr}`;
  const expected = crypto.createHmac('sha256', getSecret(env)).update(payload).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return sessionId;
  } catch {
    return null;
  }
}

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val || !val.trim()) return fallback;
  const n = Number.parseInt(val.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseAccessCodes(val: string | undefined): string[] {
  if (!val || !val.trim()) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function incrementCounter(
  key: string,
  ttlSeconds: number,
  env: EnvMap
): Promise<number> {
  const redisUrl = (env.UPSTASH_REDIS_REST_URL ?? '').trim();
  const redisToken = (env.UPSTASH_REDIS_REST_TOKEN ?? '').trim();

  if (redisUrl && redisToken) {
    try {
      const res = await fetch(`${redisUrl.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redisToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, ttlSeconds],
        ]),
      });
      if (res.ok) {
        const data = (await res.json()) as Array<{ result?: number }>;
        const count = data?.[0]?.result;
        if (typeof count === 'number') return count;
      }
    } catch {
      // Fall back to in-memory counter if Redis is unreachable
    }
  }

  const now = Date.now();
  const existing = memoryCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryCounters.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}

export async function checkAndConsumeLimits(params: {
  ip: string;
  sessionToken?: string;
  accessCode?: string;
  env: EnvMap;
}): Promise<{ ok: true; sessionId: string } | { ok: false; error: LimitErrorCode }> {
  const { ip, sessionToken, accessCode, env } = params;

  // 1. Access codes check if configured
  const validCodes = parseAccessCodes(env.ACCESS_CODES);
  if (validCodes.length > 0) {
    if (!accessCode || !validCodes.includes(accessCode.trim())) {
      return { ok: false, error: 'code' };
    }
  }

  // 2. Per-IP burst limit: at most 6 calls per 30 seconds
  const now = Date.now();
  const windowStart = now - 30_000;
  const recent = (burstBuckets.get(ip) ?? []).filter((ts) => ts > windowStart);
  if (recent.length >= 6) {
    burstBuckets.set(ip, recent);
    return { ok: false, error: 'burst' };
  }
  recent.push(now);
  burstBuckets.set(ip, recent);

  // 3. Session verification (if no token passed, derive an ephemeral one from IP so zero-config calls still respect session cap)
  const verifiedSession = verifySessionToken(sessionToken, env) ?? `ip_${ip}`;
  const sessionCap = parsePositiveInt(env.SESSION_CALL_CAP, 20);
  const dailyCap = parsePositiveInt(env.DAILY_CALL_CAP, 150);

  const dayKey = new Date().toISOString().slice(0, 10);
  const sessionCount = await incrementCounter(`arkvoid:sess:${verifiedSession}`, 86_400, env);
  if (sessionCount > sessionCap) {
    return { ok: false, error: 'cap' };
  }

  const dailyCount = await incrementCounter(`arkvoid:day:${dayKey}`, 86_400, env);
  if (dailyCount > dailyCap) {
    return { ok: false, error: 'cap' };
  }

  return { ok: true, sessionId: verifiedSession };
}
