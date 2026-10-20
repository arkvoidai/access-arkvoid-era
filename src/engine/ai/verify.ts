import { CHARACTERS, LOCATIONS } from '../../config/app.config.ts';
import type { Ledger } from '../ledger.ts';
import { checkProposal, verifyCitations } from '../rules.ts';
import type {
  CharacterId,
  LedgerEvent,
  LocationId,
  ModelTurn,
  Proposal,
  RuleResult,
  WorldState,
} from '../types.ts';

export function verifyAndCommitTurn(params: {
  characterId: CharacterId;
  playerText: string;
  rawTurn: ModelTurn;
  suppliedMemories: LedgerEvent[];
  state: WorldState;
  ledger: Ledger;
  tier: 0 | 1 | 2;
}): {
  verifiedTurn: ModelTurn;
  checks: Array<{ proposal: Proposal; result: RuleResult }>;
  committed: LedgerEvent[];
} {
  const { characterId, playerText, rawTurn, suppliedMemories, state, ledger, tier } = params;
  const charName = CHARACTERS[characterId]?.name ?? characterId;

  // 1. Verify citations (R7)
  const suppliedIds = new Set(suppliedMemories.map((m) => m.id));
  const { validCitations } = verifyCitations(
    state,
    ledger,
    characterId,
    rawTurn.citations,
    suppliedIds
  );

  const verifiedTurn: ModelTurn = {
    ...rawTurn,
    citations: validCitations,
  };

  const committed: LedgerEvent[] = [];

  // 2. Append the SPOKE event to the ledger first
  const spokeEvent = ledger.append({
    t: state.now,
    realTs: Date.now(),
    type: 'SPOKE',
    actors: ['player', characterId],
    place: state.playerPlace,
    data: {
      playerText: playerText.slice(0, 160),
      emotion: verifiedTurn.emotion,
      utterance: verifiedTurn.utterance.slice(0, 200),
    },
    causes: validCitations,
    importance: 2,
    tier,
    summary: `You spoke with ${charName} at ${LOCATIONS[state.playerPlace]?.name ?? state.playerPlace}: "${verifiedTurn.utterance}"`,
  });
  committed.push(spokeEvent);

  const checks: Array<{ proposal: Proposal; result: RuleResult }> = [];
  const causeIds = validCitations.length > 0 ? [...validCitations, spokeEvent.id] : [spokeEvent.id];

  // 3. Check each proposal through R1-R8 and commit accepted proposals
  for (const proposal of verifiedTurn.proposals) {
    if (proposal.type === 'NONE') continue;
    const result = checkProposal(state, ledger, characterId, proposal);
    checks.push({ proposal, result });

    if (!result.ok) {
      continue;
    }

    switch (proposal.type) {
      case 'GIVE_ITEM': {
        const itemKey = (proposal.item ?? '').trim().toLowerCase().replace(/\s+/g, '-');
        const held = state.npcInventory[characterId]?.[itemKey] ?? 0;
        if (held > 0) {
          state.npcInventory[characterId][itemKey] = held - 1;
          state.inventory[itemKey] = (state.inventory[itemKey] ?? 0) + 1;
          const ev = ledger.append({
            t: state.now,
            realTs: Date.now(),
            type: 'ITEM_GIVEN',
            actors: [characterId, 'player'],
            place: state.playerPlace,
            data: { item: itemKey, from: characterId, to: 'player' },
            causes: causeIds,
            importance: 3,
            tier,
            summary: `${charName} handed ${itemKey.replace(/-/g, ' ')} to you.`,
          });
          committed.push(ev);
        }
        break;
      }

      case 'ACCEPT_ITEM': {
        const itemKey = (proposal.item ?? '').trim().toLowerCase().replace(/\s+/g, '-');
        const held = state.inventory[itemKey] ?? 0;
        if (held > 0) {
          state.inventory[itemKey] = held - 1;
          if (state.inventory[itemKey] <= 0) {
            delete state.inventory[itemKey];
          }
          state.npcInventory[characterId][itemKey] =
            (state.npcInventory[characterId]?.[itemKey] ?? 0) + 1;
          const ev = ledger.append({
            t: state.now,
            realTs: Date.now(),
            type: 'ITEM_GIVEN',
            actors: ['player', characterId],
            place: state.playerPlace,
            data: { item: itemKey, from: 'player', to: characterId },
            causes: causeIds,
            importance: 3,
            tier,
            summary: `You gave ${itemKey.replace(/-/g, ' ')} to ${charName}.`,
          });
          committed.push(ev);
        }
        break;
      }

      case 'MAKE_PROMISE': {
        const hours = proposal.deadlineHours ?? 6;
        const dueBy = state.now + Math.round(hours * 60);
        const promiseId = `p_${String(state.promises.length + 1).padStart(3, '0')}`;
        const text = (proposal.text ?? 'Keep watch along the terrace').trim();
        const ev = ledger.append({
          t: state.now,
          realTs: Date.now(),
          type: 'PROMISE_MADE',
          actors: [characterId, 'player'],
          place: state.playerPlace,
          data: { promiseId, dueBy },
          causes: causeIds,
          importance: 4,
          tier,
          summary: `New promise recorded with ${charName}: "${text}"`,
        });
        state.promises.push({
          id: promiseId,
          by: 'player',
          to: characterId,
          text,
          madeAt: state.now,
          dueBy,
          status: 'open',
          sourceEvent: ev.id,
        });
        committed.push(ev);
        break;
      }

      case 'UPDATE_PROMISE': {
        const target = proposal.promiseId
          ? state.promises.find((p) => p.id === proposal.promiseId && p.status === 'open')
          : state.promises.find(
              (p) =>
                p.status === 'open' &&
                (p.to === characterId || p.by === characterId)
            );
        if (target && (proposal.status === 'kept' || proposal.status === 'moot' || proposal.status === 'broken')) {
          target.status = proposal.status;
          const ev = ledger.append({
            t: state.now,
            realTs: Date.now(),
            type: 'PROMISE_UPDATED',
            actors: ['player', characterId],
            place: state.playerPlace,
            data: { promiseId: target.id, status: proposal.status, public: true },
            causes: [...causeIds, target.sourceEvent],
            importance: 4,
            tier,
            summary: `Promise with ${charName} marked as ${proposal.status}: "${target.text}"`,
          });
          committed.push(ev);
        }
        break;
      }

      case 'MOVE_TO': {
        const dest = proposal.place as LocationId;
        if (LOCATIONS[dest]) {
          const prev = state.npcPlace[characterId];
          state.npcPlace[characterId] = dest;
          const ev = ledger.append({
            t: state.now,
            realTs: Date.now(),
            type: 'MOVED',
            actors: [characterId],
            place: dest,
            data: { from: prev, to: dest },
            causes: causeIds,
            importance: 2,
            tier,
            summary: `${charName} set out for ${LOCATIONS[dest].name}.`,
          });
          committed.push(ev);
        }
        break;
      }

      case 'ADJUST_TRUST': {
        const delta = Math.max(-2, Math.min(2, Math.round(proposal.trustDelta ?? 0)));
        if (delta !== 0) {
          const prev = state.trust[characterId] ?? 0;
          const next = Math.max(-5, Math.min(10, prev + delta));
          state.trust[characterId] = next;
          const ev = ledger.append({
            t: state.now,
            realTs: Date.now(),
            type: 'TRUST_CHANGED',
            actors: [characterId, 'player'],
            place: state.playerPlace,
            data: { delta, next },
            causes: causeIds,
            importance: 3,
            tier,
            summary: `${charName}'s trust in you shifted by ${delta > 0 ? `+${delta}` : delta} (now ${next}).`,
          });
          committed.push(ev);
        }
        break;
      }
    }
  }

  return { verifiedTurn, checks, committed };
}
