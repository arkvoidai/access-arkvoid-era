import { createInitialLedgerEvents, createInitialWorldState } from '../config/app.config.ts';
import { Ledger } from './ledger.ts';
import { retrieve } from './memory.ts';
import {
  checkEventTime,
  checkProposal,
  verifyCitations,
} from './rules.ts';
import { step } from './sim.ts';
import { TierMeter } from './tiers.ts';

export interface SelfTestItemResult {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
}

export function runEngineSelfTest(): SelfTestItemResult[] {
  const results: SelfTestItemResult[] = [];
  const fixedNow = 1_700_000_000_000;

  // 1. Append-only Ledger & Causal Chain test
  try {
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    const initialCount = ledger.getAll().length;
    const e5 = ledger.append(
      {
        t: 1100,
        realTs: fixedNow,
        type: 'NOTE',
        actors: ['seren'],
        place: 'east-gate',
        data: { public: true },
        causes: ['e_000001'],
        importance: 3,
        tier: 0,
        summary: 'Seren wedged an iron shim into the frost crack at the East Gate.',
      },
      false
    );
    const e6 = ledger.append(
      {
        t: 1115,
        realTs: fixedNow + 1000,
        type: 'WORK_COMPLETED',
        actors: ['seren', 'player'],
        place: 'east-gate',
        data: { public: true },
        causes: [e5.id],
        importance: 4,
        tier: 2,
        summary: 'You and Seren sealed the East Gate arch seam with warm pitch.',
      },
      false
    );

    const chain = ledger.chain(e6.id);
    let mutated = false;
    try {
      (e6 as { summary: string }).summary = 'tampered';
      if (ledger.getById(e6.id)?.summary === 'tampered') mutated = true;
    } catch {
      // Expected freeze error in strict mode
    }

    const ok =
      ledger.getAll().length === initialCount + 2 &&
      chain.length === 3 &&
      chain[0].id === 'e_000001' &&
      chain[1].id === e5.id &&
      chain[2].id === e6.id &&
      !mutated;

    results.push({
      id: 'T_LEDGER',
      name: 'Append-only ledger & causal chain',
      passed: ok,
      detail: ok
        ? `Appended ${e5.id} & ${e6.id}, froze records against mutation, and traced 3-step causal chain from ${ chain[0].id }.`
        : 'Ledger append or causal chain verification failed.',
    });
  } catch (err) {
    results.push({
      id: 'T_LEDGER',
      name: 'Append-only ledger & causal chain',
      passed: false,
      detail: String(err),
    });
  }

  // 2. R1 Presence (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    // Seren is at east-gate, player is at east-gate -> PASS
    const passRes = checkProposal(state, ledger, 'seren', {
      type: 'ADJUST_TRUST',
      trustDelta: 1,
    });
    // Orin is at lantern-terrace, player is at east-gate -> FAIL
    const failRes = checkProposal(state, ledger, 'orin', {
      type: 'ADJUST_TRUST',
      trustDelta: 1,
    });
    const ok = passRes.ok && !failRes.ok && failRes.ruleId === 'R1';
    results.push({
      id: 'T_R1',
      name: 'R1 Presence check (pass & fail)',
      passed: ok,
      detail: ok
        ? `Passed when co-located with Seren; rejected remote turn with Orin ("${failRes.reason}").`
        : 'R1 check did not behave as expected.',
    });
  }

  // 3. R2 Possession (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    // Seren holds gate-key -> PASS
    const passRes = checkProposal(state, ledger, 'seren', {
      type: 'GIVE_ITEM',
      item: 'gate-key',
      recipient: 'player',
    });
    // Seren does NOT hold sky-token -> FAIL
    const failRes = checkProposal(state, ledger, 'seren', {
      type: 'GIVE_ITEM',
      item: 'sky-token',
      recipient: 'player',
    });
    const ok = passRes.ok && passRes.ruleId === 'R2' && !failRes.ok && failRes.ruleId === 'R2';
    results.push({
      id: 'T_R2',
      name: 'R2 Possession check (pass & fail)',
      passed: ok,
      detail: ok
        ? `Passed for held gate-key; rejected unheld item ("${failRes.reason}").`
        : 'R2 possession check failed.',
    });
  }

  // 4. R3 Promises (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    const passRes = checkProposal(state, ledger, 'seren', {
      type: 'MAKE_PROMISE',
      recipient: 'player',
      text: 'Inspect the northern watchtower before noon.',
      deadlineHours: 12,
    });
    const failRes = checkProposal(state, ledger, 'seren', {
      type: 'MAKE_PROMISE',
      recipient: 'player',
      text: 'Wait a full month.',
      deadlineHours: 400, // exceeds 7 days (168h)
    });
    const ok = passRes.ok && passRes.ruleId === 'R3' && !failRes.ok && failRes.ruleId === 'R3';
    results.push({
      id: 'T_R3',
      name: 'R3 Promise bounds & status (pass & fail)',
      passed: ok,
      detail: ok
        ? `Accepted 12h promise; rejected 400h deadline ("${failRes.reason}").`
        : 'R3 promise check failed.',
    });
  }

  // 5. R4 Sleep (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    // Day/dusk move -> PASS
    const passRes = checkProposal(state, ledger, 'seren', {
      type: 'MOVE_TO',
      place: 'lantern-terrace',
    });
    // Night (22:00 = 1320) while resting -> FAIL
    state.now = 22 * 60;
    state.npcActivity.seren = 'resting in the gatehouse bunk';
    const failRes = checkProposal(state, ledger, 'seren', {
      type: 'MOVE_TO',
      place: 'lantern-terrace',
    });
    const ok = passRes.ok && !failRes.ok && failRes.ruleId === 'R4';
    results.push({
      id: 'T_R4',
      name: 'R4 Night rest enforcement (pass & fail)',
      passed: ok,
      detail: ok
        ? `Allowed daytime movement; blocked resting night movement ("${failRes.reason}").`
        : 'R4 sleep check failed.',
    });
  }

  // 6. R5 Trust bounds (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    const passRes = checkProposal(state, ledger, 'seren', {
      type: 'ADJUST_TRUST',
      trustDelta: 2,
    });
    const failRes = checkProposal(state, ledger, 'seren', {
      type: 'ADJUST_TRUST',
      trustDelta: 5, // exceeds +-2 per turn
    });
    const ok = passRes.ok && passRes.ruleId === 'R5' && !failRes.ok && failRes.ruleId === 'R5';
    results.push({
      id: 'T_R5',
      name: 'R5 Trust bounds +-2 & [-5..10] (pass & fail)',
      passed: ok,
      detail: ok
        ? `Accepted +2 trust shift; rejected +5 jump ("${failRes.reason}").`
        : 'R5 trust bounds check failed.',
    });
  }

  // 7. R6 Realm gates (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    state.playerRealm = 1;
    const failRes = checkProposal(state, ledger, 'player', {
      type: 'MOVE_TO',
      place: 'sky-realms', // requires realm 3
    });
    state.playerRealm = 3;
    const passRes = checkProposal(state, ledger, 'player', {
      type: 'MOVE_TO',
      place: 'sky-realms',
    });
    const ok = !failRes.ok && failRes.ruleId === 'R6' && passRes.ok && passRes.ruleId === 'R6';
    results.push({
      id: 'T_R6',
      name: 'R6 Realm gate enforcement (pass & fail)',
      passed: ok,
      detail: ok
        ? `Blocked Sky Realms at Realm 1 ("${failRes.reason}"); allowed at Realm 3.`
        : 'R6 realm gate check failed.',
    });
  }

  // 8. R7 Citations verification (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    const supplied = new Set(['e_000001', 'e_000003']);
    const check = verifyCitations(
      state,
      ledger,
      'seren',
      ['e_000001', 'e_999999'],
      supplied
    );
    const ok =
      check.validCitations.length === 1 &&
      check.validCitations[0] === 'e_000001' &&
      check.strippedCitations.length === 1 &&
      check.strippedCitations[0] === 'e_999999';
    results.push({
      id: 'T_R7',
      name: 'R7 Citation verification & invented source stripping (pass & fail)',
      passed: ok,
      detail: ok
        ? 'Kept verified citation e_000001 and stripped invented citation e_999999.'
        : 'R7 citation check failed.',
    });
  }

  // 9. R8 Chronological time ordering (Pass & Fail)
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    const passRes = checkEventTime(state, ledger, 'seren', 1200);
    const failRes = checkEventTime(state, ledger, 'seren', 100); // earlier than last event (1065)
    let appendThrew = false;
    try {
      ledger.append(
        {
          t: 100,
          realTs: fixedNow,
          type: 'NOTE',
          actors: ['seren'],
          place: 'east-gate',
          data: {},
          causes: [],
          importance: 2,
          tier: 0,
          summary: 'Backwards time event.',
        },
        false
      );
    } catch {
      appendThrew = true;
    }
    const ok = passRes.ok && !failRes.ok && failRes.ruleId === 'R8' && appendThrew;
    results.push({
      id: 'T_R8',
      name: 'R8 Monotonic world time (pass & fail)',
      passed: ok,
      detail: ok
        ? `Accepted t=1200; rejected out-of-order t=100 ("${failRes.reason}").`
        : 'R8 chronological time check failed.',
    });
  }

  // 10. Memory retrieval scoring & ordering
  {
    const state = createInitialWorldState(fixedNow);
    const ledger = new Ledger(createInitialLedgerEvents(fixedNow));
    const retrieved = retrieve('seren', 'Did I promise to bring spirit-root for the brazier?', state, ledger, 4);
    // e_000003 is the high-importance player+seren promise about spirit-root and brazier
    const ok = retrieved.length > 0 && retrieved[0].id === 'e_000003';
    results.push({
      id: 'T_MEMORY',
      name: 'Memory retrieval relevance ordering',
      passed: ok,
      detail: ok
        ? `Ranked ${retrieved[0].id} ("${retrieved[0].summary.slice(0, 56)}...") #1 for brazier promise query.`
        : 'Memory retrieval did not rank expected event first.',
    });
  }

  // 11. Deterministic PRNG & Simulation reproducibility
  {
    const stateA = createInitialWorldState(fixedNow);
    const ledgerA = new Ledger(createInitialLedgerEvents(fixedNow));
    const meterA = new TierMeter();
    step(360, stateA, ledgerA, meterA);

    const stateB = createInitialWorldState(fixedNow);
    const ledgerB = new Ledger(createInitialLedgerEvents(fixedNow));
    const meterB = new TierMeter();
    step(360, stateB, ledgerB, meterB);

    const eventsA = ledgerA.getAll().map((e) => `${e.id}:${e.t}:${e.type}:${e.summary}`);
    const eventsB = ledgerB.getAll().map((e) => `${e.id}:${e.t}:${e.type}:${e.summary}`);
    const identical =
      eventsA.length === eventsB.length &&
      eventsA.every((val, idx) => val === eventsB[idx]) &&
      JSON.stringify(stateA.npcPlace) === JSON.stringify(stateB.npcPlace);

    results.push({
      id: 'T_DETERMINISM',
      name: 'Deterministic simulation (identical seed -> identical ledger)',
      passed: identical,
      detail: identical
        ? `Two independent 6-hour runs with seed ${stateA.seed} produced ${eventsA.length} identical ledger events.`
        : 'Simulation runs diverged.',
    });
  }

  return results;
}
