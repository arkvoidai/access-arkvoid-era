import { CHARACTERS, LOCATIONS } from '../config/app.config.ts';
import { partOfDay } from './clock.ts';
import type { Ledger } from './ledger.ts';
import type {
  ActorId,
  CharacterId,
  LocationId,
  Proposal,
  RuleResult,
  WorldMinute,
  WorldState,
} from './types.ts';

export interface RuleLogEntry {
  id: string;
  ts: number;
  worldMinute: WorldMinute;
  actor: ActorId;
  proposalType: string;
  ok: boolean;
  ruleId: string;
  reason: string;
}

const MAX_RULE_LOG = 200;
const ruleLog: RuleLogEntry[] = [];
let ruleLogSeq = 1;
let removedInventedSourcesCount = 0;

function recordRuleCheck(
  worldMinute: WorldMinute,
  actor: ActorId,
  proposalType: string,
  result: RuleResult
): RuleResult {
  ruleLog.unshift({
    id: `chk_${String(ruleLogSeq++).padStart(4, '0')}`,
    ts: Date.now(),
    worldMinute,
    actor,
    proposalType,
    ok: result.ok,
    ruleId: result.ruleId,
    reason: result.reason,
  });
  if (ruleLog.length > MAX_RULE_LOG) {
    ruleLog.length = MAX_RULE_LOG;
  }
  return result;
}

export function getRuleLog(): RuleLogEntry[] {
  return [...ruleLog];
}

export function clearRuleLog(): void {
  ruleLog.length = 0;
  removedInventedSourcesCount = 0;
}

export function getRemovedInventedSourcesCount(): number {
  return removedInventedSourcesCount;
}

function actorName(actor: ActorId): string {
  if (actor === 'player') return 'You';
  return CHARACTERS[actor]?.name ?? actor;
}

function placeName(place: LocationId | string | undefined): string {
  if (!place) return 'an unknown place';
  const loc = LOCATIONS[place as LocationId];
  return loc ? loc.name : place;
}

function formatItemLabel(item: string | undefined): string {
  if (!item) return 'that item';
  return item.replace(/-/g, ' ');
}

/**
 * R1 Presence check for speaking or trading between character and player.
 */
export function checkPresence(state: WorldState, characterId: CharacterId): RuleResult {
  const npcPlace = state.npcPlace[characterId];
  const playerPlace = state.playerPlace;
  if (npcPlace !== playerPlace) {
    const name = actorName(characterId);
    return recordRuleCheck(state.now, characterId, 'SPEAK', {
      ok: false,
      ruleId: 'R1',
      reason: `${name} is at the ${placeName(npcPlace)}. You are at the ${placeName(playerPlace)}.`,
    });
  }
  return recordRuleCheck(state.now, characterId, 'SPEAK', {
    ok: true,
    ruleId: 'R1',
    reason: `${actorName(characterId)} and you are both at the ${placeName(playerPlace)}.`,
  });
}

/**
 * R6 Realm gate check when player or character moves into a gated location.
 */
export function checkRealmGate(
  state: WorldState,
  actor: ActorId,
  targetPlace: LocationId
): RuleResult {
  const loc = LOCATIONS[targetPlace];
  if (!loc) {
    return recordRuleCheck(state.now, actor, 'MOVE_TO', {
      ok: false,
      ruleId: 'R6',
      reason: 'That destination does not exist on the valley map.',
    });
  }
  if (
    (targetPlace === 'sky-realms' ||
      targetPlace === 'ashen-march' ||
      targetPlace === 'open-cosmos') &&
    state.playerRealm < loc.minRealm
  ) {
    return recordRuleCheck(state.now, actor, 'MOVE_TO', {
      ok: false,
      ruleId: 'R6',
      reason: 'You have not climbed far enough.',
    });
  }
  return recordRuleCheck(state.now, actor, 'MOVE_TO', {
    ok: true,
    ruleId: 'R6',
    reason: `${loc.name} is open to your current realm (${state.playerRealm}).`,
  });
}

/**
 * R7 Citations check: any citation id the model returns must exist in the ledger AND
 * in the memories supplied for that turn. Unknown ids are stripped and counted.
 */
export function verifyCitations(
  state: WorldState,
  ledger: Ledger,
  actor: ActorId,
  citations: string[],
  suppliedMemoryIds: ReadonlySet<string>
): { validCitations: string[]; strippedCitations: string[]; results: RuleResult[] } {
  const validCitations: string[] = [];
  const strippedCitations: string[] = [];
  const results: RuleResult[] = [];

  for (const cid of citations) {
    const inLedger = Boolean(ledger.getById(cid));
    const inSupplied = suppliedMemoryIds.has(cid);
    if (inLedger && inSupplied) {
      validCitations.push(cid);
      results.push(
        recordRuleCheck(state.now, actor, 'CITATION', {
          ok: true,
          ruleId: 'R7',
          reason: `Citation ${cid} verified in ledger and retrieved memories.`,
        })
      );
    } else {
      strippedCitations.push(cid);
      removedInventedSourcesCount += 1;
      results.push(
        recordRuleCheck(state.now, actor, 'CITATION', {
          ok: false,
          ruleId: 'R7',
          reason: `Removed invented source ${cid} because it was not in the character's retrieved memories.`,
        })
      );
    }
  }

  return { validCitations, strippedCitations, results };
}

/**
 * R8 Time check: no event may be appended with `t` earlier than the last event.
 */
export function checkEventTime(
  state: WorldState,
  ledger: Ledger,
  actor: ActorId,
  proposedMinute: WorldMinute
): RuleResult {
  const all = ledger.getAll();
  const last = all[all.length - 1];
  if (last && proposedMinute < last.t) {
    return recordRuleCheck(state.now, actor, 'APPEND_EVENT', {
      ok: false,
      ruleId: 'R8',
      reason: `Event time (${proposedMinute}) cannot be earlier than the last recorded event (${last.t}).`,
    });
  }
  return recordRuleCheck(state.now, actor, 'APPEND_EVENT', {
    ok: true,
    ruleId: 'R8',
    reason: `Event time (${proposedMinute}) is in valid chronological order.`,
  });
}

/**
 * Evaluates a character or player proposal against R1–R8.
 */
export function checkProposal(
  state: WorldState,
  _ledger: Ledger,
  actor: ActorId,
  proposal: Proposal,
  options?: { urgent?: boolean }
): RuleResult {
  if (proposal.type === 'NONE') {
    return recordRuleCheck(state.now, actor, 'NONE', {
      ok: true,
      ruleId: 'R1',
      reason: 'No world state change proposed.',
    });
  }

  // R1 Presence: speaking/trading/promising between character and player requires same place
  if (
    actor !== 'player' &&
    (proposal.type === 'GIVE_ITEM' ||
      proposal.type === 'ACCEPT_ITEM' ||
      proposal.type === 'MAKE_PROMISE' ||
      proposal.type === 'UPDATE_PROMISE' ||
      proposal.type === 'ADJUST_TRUST')
  ) {
    const npcPlace = state.npcPlace[actor];
    if (npcPlace !== state.playerPlace) {
      return recordRuleCheck(state.now, actor, proposal.type, {
        ok: false,
        ruleId: 'R1',
        reason: `${actorName(actor)} is at the ${placeName(npcPlace)}. You are at the ${placeName(state.playerPlace)}.`,
      });
    }
  }

  switch (proposal.type) {
    case 'GIVE_ITEM': {
      const itemKey = (proposal.item ?? '').trim().toLowerCase().replace(/\s+/g, '-');
      const itemLabel = formatItemLabel(itemKey);
      if (!itemKey) {
        return recordRuleCheck(state.now, actor, 'GIVE_ITEM', {
          ok: false,
          ruleId: 'R2',
          reason: `${actorName(actor)} did not specify which item to hand over.`,
        });
      }
      if (actor === 'player') {
        const held = state.inventory[itemKey] ?? 0;
        if (held < 1) {
          return recordRuleCheck(state.now, actor, 'GIVE_ITEM', {
            ok: false,
            ruleId: 'R2',
            reason: `You do not have the ${itemLabel}, so you cannot hand it over.`,
          });
        }
      } else {
        const held = state.npcInventory[actor]?.[itemKey] ?? 0;
        if (held < 1) {
          return recordRuleCheck(state.now, actor, 'GIVE_ITEM', {
            ok: false,
            ruleId: 'R2',
            reason: `${actorName(actor)} does not have the ${itemLabel}, so she cannot hand it over.`,
          });
        }
      }
      return recordRuleCheck(state.now, actor, 'GIVE_ITEM', {
        ok: true,
        ruleId: 'R2',
        reason: `${actorName(actor)} holds the ${itemLabel} and can hand it over.`,
      });
    }

    case 'ACCEPT_ITEM': {
      const itemKey = (proposal.item ?? '').trim().toLowerCase().replace(/\s+/g, '-');
      const itemLabel = formatItemLabel(itemKey);
      const heldByPlayer = state.inventory[itemKey] ?? 0;
      if (!itemKey || heldByPlayer < 1) {
        return recordRuleCheck(state.now, actor, 'ACCEPT_ITEM', {
          ok: false,
          ruleId: 'R2',
          reason: `You do not have the ${itemLabel} in your pack to give to ${actorName(actor)}.`,
        });
      }
      return recordRuleCheck(state.now, actor, 'ACCEPT_ITEM', {
        ok: true,
        ruleId: 'R2',
        reason: `You hold the ${itemLabel} and hand it to ${actorName(actor)}.`,
      });
    }

    case 'MAKE_PROMISE': {
      const text = (proposal.text ?? '').trim();
      const hours = proposal.deadlineHours;
      const recipient = proposal.recipient ?? (actor === 'player' ? 'seren' : 'player');
      if (!recipient || !text) {
        return recordRuleCheck(state.now, actor, 'MAKE_PROMISE', {
          ok: false,
          ruleId: 'R3',
          reason: 'A promise requires an assignee and a plain statement of what will be done.',
        });
      }
      if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 1 || hours > 7 * 24) {
        return recordRuleCheck(state.now, actor, 'MAKE_PROMISE', {
          ok: false,
          ruleId: 'R3',
          reason: 'A promise deadline must be between 1 hour and 7 world days.',
        });
      }
      return recordRuleCheck(state.now, actor, 'MAKE_PROMISE', {
        ok: true,
        ruleId: 'R3',
        reason: `Promise recorded with a deadline of ${hours} world hours.`,
      });
    }

    case 'UPDATE_PROMISE': {
      const pid = proposal.promiseId;
      const openPromise = pid
        ? state.promises.find((p) => p.id === pid && p.status === 'open')
        : state.promises.find(
            (p) =>
              p.status === 'open' &&
              (p.by === actor || p.to === actor || p.by === 'player' || p.to === 'player')
          );
      if (!openPromise) {
        return recordRuleCheck(state.now, actor, 'UPDATE_PROMISE', {
          ok: false,
          ruleId: 'R3',
          reason: 'There is no matching open promise in the ledger to update.',
        });
      }
      const nextStatus = proposal.status;
      if (nextStatus !== 'kept' && nextStatus !== 'moot' && nextStatus !== 'broken') {
        return recordRuleCheck(state.now, actor, 'UPDATE_PROMISE', {
          ok: false,
          ruleId: 'R3',
          reason: 'Promise update must mark the promise as kept, moot, or broken.',
        });
      }
      return recordRuleCheck(state.now, actor, 'UPDATE_PROMISE', {
        ok: true,
        ruleId: 'R3',
        reason: `Open promise ${openPromise.id} marked as ${nextStatus}.`,
      });
    }

    case 'MOVE_TO': {
      const dest = (proposal.place ?? '') as LocationId;
      if (!LOCATIONS[dest]) {
        return recordRuleCheck(state.now, actor, 'MOVE_TO', {
          ok: false,
          ruleId: 'R6',
          reason: `Unknown location "${proposal.place ?? ''}".`,
        });
      }

      // R4 Sleep: at night (20:00 to 05:00) a character who is "resting" will not leave their place unless urgent
      if (actor !== 'player') {
        const pod = partOfDay(state.now);
        const activity = (state.npcActivity[actor] ?? '').toLowerCase();
        if (pod === 'night' && activity.includes('resting') && !options?.urgent) {
          return recordRuleCheck(state.now, actor, 'MOVE_TO', {
            ok: false,
            ruleId: 'R4',
            reason: `${actorName(actor)} is resting for the night and will not leave the ${placeName(state.npcPlace[actor])} unless urgent.`,
          });
        }
      }

      // R6 Realm gates
      if (
        dest === 'sky-realms' ||
        dest === 'ashen-march' ||
        dest === 'open-cosmos'
      ) {
        const minRealm = LOCATIONS[dest].minRealm;
        if (state.playerRealm < minRealm) {
          return recordRuleCheck(state.now, actor, 'MOVE_TO', {
            ok: false,
            ruleId: 'R6',
            reason: 'You have not climbed far enough.',
          });
        }
      }

      return recordRuleCheck(state.now, actor, 'MOVE_TO', {
        ok: true,
        ruleId: actor === 'player' ? 'R6' : 'R4',
        reason: `${actorName(actor)} can move to the ${placeName(dest)}.`,
      });
    }

    case 'ADJUST_TRUST': {
      if (actor === 'player') {
        return recordRuleCheck(state.now, actor, 'ADJUST_TRUST', {
          ok: false,
          ruleId: 'R5',
          reason: 'Only a character can adjust their trust in you.',
        });
      }
      const delta = proposal.trustDelta;
      if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0) {
        return recordRuleCheck(state.now, actor, 'ADJUST_TRUST', {
          ok: false,
          ruleId: 'R5',
          reason: 'Trust adjustment must be a non-zero number.',
        });
      }
      if (Math.abs(delta) > 2) {
        return recordRuleCheck(state.now, actor, 'ADJUST_TRUST', {
          ok: false,
          ruleId: 'R5',
          reason: `Trust can change by at most 2 per turn (proposed ${delta > 0 ? `+${delta}` : delta}).`,
        });
      }
      const current = state.trust[actor] ?? 0;
      const next = current + delta;
      if (next < -5 || next > 10) {
        return recordRuleCheck(state.now, actor, 'ADJUST_TRUST', {
          ok: false,
          ruleId: 'R5',
          reason: `Trust with ${actorName(actor)} must stay between -5 and 10 (would reach ${next}).`,
        });
      }
      return recordRuleCheck(state.now, actor, 'ADJUST_TRUST', {
        ok: true,
        ruleId: 'R5',
        reason: `Trust with ${actorName(actor)} shifts by ${delta > 0 ? `+${delta}` : delta} to ${next}.`,
      });
    }

    default:
      return recordRuleCheck(state.now, actor, 'NONE', {
        ok: false,
        ruleId: 'R1',
        reason: 'Unrecognized proposal type.',
      });
  }
}
