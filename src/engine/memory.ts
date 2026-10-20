import type { Ledger } from './ledger.ts';
import type { CharacterId, LedgerEvent, WorldMinute, WorldState } from './types.ts';

export interface ScoredMemory {
  event: LedgerEvent;
  score: number;
  breakdown: {
    recency: number;
    importance: number;
    actorMatch: number;
    keywordOverlap: number;
  };
}

export interface RetrievalTrace {
  characterId: CharacterId;
  playerText: string;
  atMinute: WorldMinute;
  results: ScoredMemory[];
}

let lastRetrieval: RetrievalTrace | null = null;

export function getLastRetrieval(): RetrievalTrace | null {
  return lastRetrieval;
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'your', 'that', 'this', 'are', 'was',
  'were', 'have', 'has', 'had', 'what', 'when', 'where', 'who', 'why', 'how',
  'can', 'will', 'about', 'from', 'into', 'near', 'some', 'any',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

function computeKeywordOverlap(playerKeywords: string[], event: LedgerEvent): number {
  if (playerKeywords.length === 0) return 0;
  const hay = `${event.summary} ${event.place} ${Object.values(event.data).join(' ')}`.toLowerCase();
  let hits = 0;
  for (const kw of playerKeywords) {
    if (hay.includes(kw)) {
      hits += 1;
    }
  }
  return Math.min(1, hits / playerKeywords.length);
}

/**
 * Retrieves up to `k` relevant memories that `character` could actually know:
 * - Events where the character was an actor
 * - Events at their current place in the last 2 world days (2880 minutes)
 * - Public events (`data.public === true`)
 *
 * Score = 0.45 * recency (3-world-day half-life) + 0.25 * (importance/5) + 0.20 * actorMatchWithPlayer + 0.10 * keywordOverlap
 */
export function retrieve(
  character: CharacterId,
  playerText: string,
  state: WorldState,
  ledger: Ledger,
  k = 8
): LedgerEvent[] {
  const charPlace = state.npcPlace[character];
  const twoDaysMinutes = 2 * 1440;
  const threeDaysMinutes = 3 * 1440;
  const playerKeywords = extractKeywords(playerText);

  const candidates = ledger.getAll().filter((ev) => {
    if (ev.t > state.now) return false;
    const isActor = ev.actors.includes(character);
    const isRecentSamePlace =
      ev.place === charPlace && state.now - ev.t <= twoDaysMinutes;
    const isPublic = ev.data.public === true;
    return isActor || isRecentSamePlace || isPublic;
  });

  const scored: ScoredMemory[] = candidates.map((ev) => {
    const ageMinutes = Math.max(0, state.now - ev.t);
    // Exponential decay with a 3-world-day (4320 min) half-life: 0.5^(age / 4320)
    const recency = Math.pow(0.5, ageMinutes / threeDaysMinutes);
    const importance = ev.importance / 5;
    const actorMatch = ev.actors.includes('player') && ev.actors.includes(character)
      ? 1
      : ev.actors.includes('player')
        ? 0.5
        : 0;
    const keywordOverlap = computeKeywordOverlap(playerKeywords, ev);

    const score =
      0.45 * recency +
      0.25 * importance +
      0.20 * actorMatch +
      0.10 * keywordOverlap;

    return {
      event: ev,
      score: Number(score.toFixed(4)),
      breakdown: {
        recency: Number(recency.toFixed(3)),
        importance: Number(importance.toFixed(3)),
        actorMatch: Number(actorMatch.toFixed(3)),
        keywordOverlap: Number(keywordOverlap.toFixed(3)),
      },
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.event.t - a.event.t;
  });

  const top = scored.slice(0, k);
  lastRetrieval = {
    characterId: character,
    playerText,
    atMinute: state.now,
    results: top,
  };

  return top.map((item) => item.event);
}
