import { LOCATIONS } from '../../config/app.config.ts';
import { formatWorld, partOfDay } from '../clock.ts';
import type { Ledger } from '../ledger.ts';
import { retrieve } from '../memory.ts';
import { checkPresence } from '../rules.ts';
import { globalTierMeter, type TierMeter } from '../tiers.ts';
import type { CharacterId, TurnResult, WorldState } from '../types.ts';
import { buildScriptedTurn } from './scripted.ts';
import { fetchChatTurn, type ServerContextPayload } from './server.ts';
import { verifyAndCommitTurn } from './verify.ts';

export async function talk(params: {
  characterId: CharacterId;
  playerText: string;
  state: WorldState;
  ledger: Ledger;
  liveAllowed: boolean;
  sessionToken?: string;
  meter?: TierMeter;
  onModeFallback?: () => void;
}): Promise<TurnResult> {
  const {
    characterId,
    playerText,
    state,
    ledger,
    liveAllowed,
    sessionToken,
    meter = globalTierMeter,
    onModeFallback,
  } = params;

  const startedAt = performance.now();

  // R1 Presence check before speaking
  const presence = checkPresence(state, characterId);
  if (!presence.ok) {
    return {
      turn: {
        utterance: presence.reason,
        emotion: 'calm',
        citations: [],
        proposals: [],
      },
      checks: [{ proposal: { type: 'NONE' }, result: presence }],
      committed: [],
      source: 'offline',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  // 1. Retrieve relevant memories from the permanent ledger
  const memories = retrieve(characterId, playerText, state, ledger, 8);

  // 2. If live mode is available, call /api/chat
  if (liveAllowed) {
    const npcItems = Object.entries(state.npcInventory[characterId] ?? {})
      .filter(([, count]) => count > 0)
      .map(([k, count]) => `${k} (${count})`);

    const context: ServerContextPayload = {
      timeLabel: formatWorld(state.now, 'time'),
      partOfDay: partOfDay(state.now),
      placeName: LOCATIONS[state.npcPlace[characterId]]?.name ?? state.npcPlace[characterId],
      activity: state.npcActivity[characterId] ?? 'standing watch',
      trust: state.trust[characterId] ?? 0,
      inventory: npcItems,
      memories: memories.map((m) => ({
        id: m.id,
        timeLabel: formatWorld(m.t, 'time'),
        summary: m.summary,
      })),
    };

    const serverRes = await fetchChatTurn({
      characterId,
      playerText,
      context,
      sessionToken,
    });

    if (serverRes.ok) {
      const latencyMs = Math.round(performance.now() - startedAt);
      meter.recordT2Call(latencyMs, serverRes.usage);

      const { verifiedTurn, checks, committed } = verifyAndCommitTurn({
        characterId,
        playerText,
        rawTurn: serverRes.turn,
        suppliedMemories: memories,
        state,
        ledger,
        tier: 2,
      });

      return {
        turn: verifiedTurn,
        checks,
        committed,
        source: 'live',
        latencyMs,
        usage: serverRes.usage,
      };
    }

    // Any failure silently falls back to offline scripted voice and updates mode
    onModeFallback?.();
  }

  // 3. Deterministic offline scripted fallback
  const scriptedTurn = buildScriptedTurn(characterId, playerText, state, memories);
  meter.recordT1Narration();

  const { verifiedTurn, checks, committed } = verifyAndCommitTurn({
    characterId,
    playerText,
    rawTurn: scriptedTurn,
    suppliedMemories: memories,
    state,
    ledger,
    tier: 1,
  });

  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  return {
    turn: verifiedTurn,
    checks,
    committed,
    source: 'offline',
    latencyMs,
  };
}
