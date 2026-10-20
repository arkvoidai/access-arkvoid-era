import { CHARACTERS, CHARACTER_ORDER, LOCATIONS } from '../config/app.config.ts';
import { AWAY_SCALE, dayOf, hourOf, MAX_AWAY_MINUTES } from './clock.ts';
import type { Ledger } from './ledger.ts';
import { createRng, type SeededRng } from './rng.ts';
import { globalTierMeter, type TierMeter } from './tiers.ts';
import type {
  CharacterId,
  LedgerEvent,
  LocationId,
  WorldMinute,
  WorldState,
} from './types.ts';

export interface Storylet {
  id: string;
  when: (state: WorldState, ledger: Ledger) => boolean;
  effects: (state: WorldState, ledger: Ledger, rng: SeededRng) => LedgerEvent[];
  summary: string;
}

/**
 * Pure function `routineAt(characterId, t)`: no state, no randomness.
 * Returns the character's scheduled place and activity at world minute `t`.
 */
export function routineAt(
  characterId: CharacterId,
  t: WorldMinute
): { place: LocationId; activity: string } {
  const character = CHARACTERS[characterId];
  if (!character) {
    return { place: 'east-gate', activity: 'standing watch' };
  }
  const h = hourOf(t);
  for (const block of character.routine) {
    if (h >= block.fromHour && h < block.toHour) {
      return { place: block.place, activity: block.activity };
    }
  }
  const fallback = character.routine[0];
  return fallback
    ? { place: fallback.place, activity: fallback.activity }
    : { place: character.homePlace, activity: 'resting' };
}

export const BASE_STORYLETS: ReadonlyArray<Storylet> = [
  {
    id: 'storylet_dusk_lantern_round',
    summary: 'Ione completed the evening lantern round along Lantern Terrace.',
    when: (state) => {
      const d = dayOf(state.now);
      const h = hourOf(state.now);
      const flagKey = `lantern_round_day_${d}`;
      return h === 19 && !state.flags[flagKey];
    },
    effects: (state, ledger) => {
      const d = dayOf(state.now);
      state.flags[`lantern_round_day_${d}`] = true;
      const ev = ledger.append({
        t: state.now,
        realTs: Date.now(),
        type: 'WORK_COMPLETED',
        actors: ['ione'],
        place: 'lantern-terrace',
        data: { public: true, day: d, storylet: 'storylet_dusk_lantern_round' },
        causes: [],
        importance: 3,
        tier: 0,
        summary: `Ione completed the Day ${d} dusk lantern round on Lantern Terrace.`,
      });
      return [ev];
    },
  },
  {
    id: 'storylet_dawn_herb_harvest',
    summary: 'Mirel gathered fresh spirit-root along Beast Ridge at dawn.',
    when: (state) => {
      const d = dayOf(state.now);
      const h = hourOf(state.now);
      const flagKey = `mirel_harvest_day_${d}`;
      return h === 6 && !state.flags[flagKey];
    },
    effects: (state, ledger, rng) => {
      const d = dayOf(state.now);
      state.flags[`mirel_harvest_day_${d}`] = true;
      const gathered = rng.nextInt(1, 2);
      state.npcInventory.mirel['spirit-root'] =
        (state.npcInventory.mirel['spirit-root'] ?? 0) + gathered;
      const ev = ledger.append({
        t: state.now,
        realTs: Date.now(),
        type: 'ITEM_GATHERED',
        actors: ['mirel'],
        place: 'beast-ridge',
        data: { item: 'spirit-root', count: gathered, public: true, day: d },
        causes: [],
        importance: 3,
        tier: 0,
        summary: `Mirel gathered ${gathered} bundle${gathered > 1 ? 's' : ''} of spirit-root on Beast Ridge at dawn.`,
      });
      return [ev];
    },
  },
  {
    id: 'storylet_archive_tally_reconciled',
    summary: 'Veyra reconciled the gate and storehouse tallies in the Hall of Records.',
    when: (state) => {
      const d = dayOf(state.now);
      const h = hourOf(state.now);
      const flagKey = `veyra_tally_day_${d}`;
      return h === 13 && !state.flags[flagKey];
    },
    effects: (state, ledger) => {
      const d = dayOf(state.now);
      state.flags[`veyra_tally_day_${d}`] = true;
      const ev = ledger.append({
        t: state.now,
        realTs: Date.now(),
        type: 'NOTE',
        actors: ['veyra', 'seren'],
        place: 'hall-of-records',
        data: { public: true, day: d, storylet: 'storylet_archive_tally_reconciled' },
        causes: [],
        importance: 3,
        tier: 0,
        summary: `Veyra verified Seren's watch tallies in the Hall of Records for Day ${d}.`,
      });
      return [ev];
    },
  },
];

/**
 * Advances the simulation in 15-minute ticks.
 * Mutates `state` in place and appends Tier 0 events to `ledger`.
 */
export function step(
  minutes: number,
  state: WorldState,
  ledger: Ledger,
  meter: TierMeter = globalTierMeter,
  storylets: ReadonlyArray<Storylet> = BASE_STORYLETS
): LedgerEvent[] {
  if (minutes <= 0) return [];

  const createdEvents: LedgerEvent[] = [];
  let remaining = minutes;

  while (remaining > 0) {
    const delta = Math.min(15, remaining);
    state.now += delta;
    remaining -= delta;

    // Seeded RNG per tick derived deterministically from world seed and world minute
    const rng = createRng((state.seed ^ (Math.floor(state.now) * 2654435761)) >>> 0);
    meter.recordT0Step(delta);

    // 1. Update every character's routine place and activity
    for (const cid of CHARACTER_ORDER) {
      const prevPlace = state.npcPlace[cid];
      const next = routineAt(cid, state.now);
      state.npcPlace[cid] = next.place;
      state.npcActivity[cid] = next.activity;

      if (prevPlace !== next.place) {
        const charName = CHARACTERS[cid].name;
        const destName = LOCATIONS[next.place]?.name ?? next.place;
        const ev = ledger.append({
          t: state.now,
          realTs: Date.now(),
          type: 'MOVED',
          actors: [cid],
          place: next.place,
          data: { from: prevPlace, to: next.place, activity: next.activity },
          causes: [],
          importance: 1,
          tier: 0,
          summary: `${charName} walked to ${destName} (${next.activity}).`,
        });
        createdEvents.push(ev);
      }
    }

    // 2. Check open promises that passed their due time
    for (const promise of state.promises) {
      if (promise.status === 'open' && promise.dueBy !== null && state.now > promise.dueBy) {
        promise.status = 'broken';
        const ev = ledger.append({
          t: state.now,
          realTs: Date.now(),
          type: 'PROMISE_UPDATED',
          actors: [promise.by, promise.to],
          place: state.playerPlace,
          data: { promiseId: promise.id, status: 'broken', public: true },
          causes: [promise.sourceEvent],
          importance: 4,
          tier: 0,
          summary: `The promise "${promise.text}" passed its deadline unfulfilled.`,
        });
        createdEvents.push(ev);
      }
    }

    // 3. Run deterministic storylets
    for (const st of storylets) {
      if (st.when(state, ledger)) {
        const out = st.effects(state, ledger, rng);
        createdEvents.push(...out);
      }
    }
  }

  state.lastSeenReal = Date.now();
  return createdEvents;
}

/**
 * Converts real time away into world minutes using AWAY_SCALE (capped at 7 world days),
 * runs step in bulk, and returns notable events (importance >= 3) for the "While you were away" sheet.
 */
export function catchUp(
  fromReal: number,
  toReal: number,
  state: WorldState,
  ledger: Ledger,
  meter: TierMeter = globalTierMeter
): { minutesAdvanced: number; notableEvents: LedgerEvent[] } {
  const elapsedSeconds = Math.max(0, (toReal - fromReal) / 1000);
  const rawMinutes = Math.floor(elapsedSeconds * AWAY_SCALE);
  const minutesAdvanced = Math.min(MAX_AWAY_MINUTES, rawMinutes);

  if (minutesAdvanced < 15) {
    state.lastSeenReal = toReal;
    return { minutesAdvanced: 0, notableEvents: [] };
  }

  const events = step(minutesAdvanced, state, ledger, meter);
  state.lastSeenReal = toReal;
  const notableEvents = events.filter((e) => e.importance >= 3);
  return { minutesAdvanced, notableEvents };
}
