import { create } from 'zustand';
import {
  CHARACTERS,
  createInitialLedgerEvents,
  createInitialWorldState,
  LOCATIONS,
} from '../config/app.config.ts';
import { talk as runTalk } from './ai/adapter.ts';
import { fetchHealthStatus, fetchSessionToken } from './ai/server.ts';
import { Ledger } from './ledger.ts';
import {
  clearPersistedWorld,
  loadPersistedWorld,
  schedulePersist,
} from './persist.ts';
import { checkProposal, checkRealmGate, clearRuleLog } from './rules.ts';
import { catchUp, step } from './sim.ts';
import { globalTierMeter, type TierMeterSnapshot } from './tiers.ts';
import type {
  ActorId,
  CharacterId,
  LedgerEvent,
  LocationId,
  Proposal,
  RuleResult,
  TurnResult,
  WorldState,
} from './types.ts';

export type ScreenId =
  | 'intro'
  | 'world'
  | 'atlas'
  | 'people'
  | 'journal'
  | 'cultivate'
  | 'time'
  | 'inspector'
  | 'glasses'
  | 'vision';

export type OverlayId = 'encounter' | 'away' | 'director' | 'keys' | 'more' | null;

export interface ToastMessage {
  id: string;
  text: string;
  tone?: 'neutral' | 'ember' | 'violet';
}

export interface ArkvoidStore {
  world: WorldState;
  ledgerInstance: Ledger;
  ledgerEvents: LedgerEvent[];
  awayEvents: LedgerEvent[];
  awayMinutes: number;
  ui: {
    screen: ScreenId;
    overlay: OverlayId;
    selectedCharacter: CharacterId;
    soundOn: boolean;
    reducedMotion: boolean;
    perfTier: 'high' | 'balanced' | 'low';
    glassesQuiet: boolean;
    clockPlaying: boolean;
    timeLensSpeed: 1 | 4 | 16;
    spiritSenseOn: boolean;
    toasts: ToastMessage[];
  };
  ai: {
    mode: 'live' | 'offline';
    serverLiveAvailable: boolean;
    modelName: string;
    sessionToken: string;
    caps: {
      sessionCap: number;
      dailyCap: number;
    };
    isTalking: boolean;
    lastTurnResult: TurnResult | null;
  };
  meter: TierMeterSnapshot;

  // Actions
  hydrate: () => Promise<void>;
  advanceTime: (minutes: number) => LedgerEvent[];
  moveTo: (place: LocationId) => RuleResult;
  commitProposal: (actor: ActorId, proposal: Proposal) => RuleResult;
  talkToCharacter: (characterId: CharacterId, playerText: string) => Promise<TurnResult>;
  resetWorld: () => Promise<void>;
  setScreen: (screen: ScreenId) => void;
  openOverlay: (overlay: Exclude<OverlayId, null>, characterId?: CharacterId) => void;
  closeOverlay: () => void;
  selectCharacter: (characterId: CharacterId) => void;
  toggleSound: () => void;
  toggleClockPlaying: () => void;
  setTimeLensSpeed: (speed: 1 | 4 | 16) => void;
  toggleSpiritSense: () => void;
  toggleGlassesQuiet: () => void;
  practiceBreath: () => void;
  pushToast: (text: string, tone?: 'neutral' | 'ember' | 'violet') => void;
  dismissToast: (id: string) => void;
  syncFromEngine: () => void;
}

const initialWorld = createInitialWorldState();
const initialEvents = createInitialLedgerEvents();
const sharedLedger = new Ledger(initialEvents);

export const useArkvoidStore = create<ArkvoidStore>((set, get) => ({
  world: initialWorld,
  ledgerInstance: sharedLedger,
  ledgerEvents: sharedLedger.getAll(),
  awayEvents: [],
  awayMinutes: 0,
  ui: {
    screen: 'intro',
    overlay: null,
    selectedCharacter: 'seren',
    soundOn: false,
    reducedMotion: false,
    perfTier: 'high',
    glassesQuiet: false,
    clockPlaying: true,
    timeLensSpeed: 1,
    spiritSenseOn: false,
    toasts: [],
  },
  ai: {
    mode: 'offline',
    serverLiveAvailable: false,
    modelName: 'mistral-small-latest',
    sessionToken: '',
    caps: {
      sessionCap: 20,
      dailyCap: 150,
    },
    isTalking: false,
    lastTurnResult: null,
  },
  meter: globalTierMeter.snapshot(),

  hydrate: async () => {
    // Check URL query parameters (READ ONLY at load, never write to URL)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('glasses') === '1') {
        set((s) => ({ ui: { ...s.ui, screen: 'glasses' } }));
      } else if (params.get('demo') === '1' || params.get('autostart') === '1') {
        set((s) => ({
          ui: {
            ...s.ui,
            screen: 'world',
            overlay: params.get('demo') === '1' ? 'director' : null,
          },
        }));
      }
    }

    // Load persisted ledger and state
    const persisted = await loadPersistedWorld();
    if (persisted.ledger && persisted.state) {
      sharedLedger.replaceAll(persisted.ledger, false);
      const stateCopy: WorldState = structuredClone(persisted.state);
      const nowReal = Date.now();
      const { minutesAdvanced, notableEvents } = catchUp(
        stateCopy.lastSeenReal || nowReal,
        nowReal,
        stateCopy,
        sharedLedger,
        globalTierMeter
      );
      schedulePersist(sharedLedger.getAll(), stateCopy);
      set((s) => ({
        world: stateCopy,
        ledgerEvents: sharedLedger.getAll(),
        awayEvents: notableEvents,
        awayMinutes: minutesAdvanced,
        meter: globalTierMeter.snapshot(),
        ui: {
          ...s.ui,
          overlay: notableEvents.length > 0 ? 'away' : s.ui.overlay,
        },
      }));
    } else {
      schedulePersist(sharedLedger.getAll(), get().world);
    }

    // Probe server /api/health and /api/session
    const [health, session] = await Promise.all([
      fetchHealthStatus(),
      fetchSessionToken(),
    ]);

    set((s) => ({
      ai: {
        ...s.ai,
        mode: health.live ? 'live' : 'offline',
        serverLiveAvailable: health.live,
        modelName: health.model,
        sessionToken: session?.token ?? '',
        caps: {
          sessionCap: session?.sessionCap ?? 20,
          dailyCap: session?.dailyCap ?? 150,
        },
      },
    }));
  },

  advanceTime: (minutes: number) => {
    const stateCopy: WorldState = structuredClone(get().world);
    const created = step(minutes, stateCopy, sharedLedger, globalTierMeter);
    schedulePersist(sharedLedger.getAll(), stateCopy);
    set({
      world: stateCopy,
      ledgerEvents: sharedLedger.getAll(),
      meter: globalTierMeter.snapshot(),
    });
    return created;
  },

  moveTo: (place: LocationId) => {
    const current = get().world;
    if (current.playerPlace === place) {
      return { ok: true, ruleId: 'R6', reason: `You are already at ${LOCATIONS[place].name}.` };
    }
    const gateCheck = checkRealmGate(current, 'player', place);
    if (!gateCheck.ok) {
      get().pushToast(gateCheck.reason, 'ember');
      set({ meter: globalTierMeter.snapshot() });
      return gateCheck;
    }

    const stateCopy: WorldState = structuredClone(current);
    const fromPlace = stateCopy.playerPlace;
    stateCopy.playerPlace = place;

    // Walking between locations takes 15 world minutes
    step(15, stateCopy, sharedLedger, globalTierMeter);

    sharedLedger.append({
      t: stateCopy.now,
      realTs: Date.now(),
      type: 'MOVED',
      actors: ['player'],
      place,
      data: { from: fromPlace, to: place },
      causes: [],
      importance: 2,
      tier: 0,
      summary: `You walked from ${LOCATIONS[fromPlace].name} to ${LOCATIONS[place].name}.`,
    });

    schedulePersist(sharedLedger.getAll(), stateCopy);

    // Select a character present at the new place if any
    const presentChar = (Object.keys(stateCopy.npcPlace) as CharacterId[]).find(
      (cid) => stateCopy.npcPlace[cid] === place
    );

    set((s) => ({
      world: stateCopy,
      ledgerEvents: sharedLedger.getAll(),
      meter: globalTierMeter.snapshot(),
      ui: {
        ...s.ui,
        selectedCharacter: presentChar ?? s.ui.selectedCharacter,
      },
    }));
    return gateCheck;
  },

  commitProposal: (actor: ActorId, proposal: Proposal) => {
    const stateCopy: WorldState = structuredClone(get().world);
    const res = checkProposal(stateCopy, sharedLedger, actor, proposal);
    if (!res.ok) {
      get().pushToast(res.reason, 'ember');
      set({ meter: globalTierMeter.snapshot() });
      return res;
    }

    if (proposal.type === 'GIVE_ITEM' && actor === 'player') {
      const itemKey = (proposal.item ?? '').trim().toLowerCase().replace(/\s+/g, '-');
      const recipient = (proposal.recipient ?? get().ui.selectedCharacter) as CharacterId;
      const held = stateCopy.inventory[itemKey] ?? 0;
      if (held > 0 && CHARACTERS[recipient]) {
        stateCopy.inventory[itemKey] = held - 1;
        if (stateCopy.inventory[itemKey] <= 0) delete stateCopy.inventory[itemKey];
        stateCopy.npcInventory[recipient][itemKey] =
          (stateCopy.npcInventory[recipient][itemKey] ?? 0) + 1;
        sharedLedger.append({
          t: stateCopy.now,
          realTs: Date.now(),
          type: 'ITEM_GIVEN',
          actors: ['player', recipient],
          place: stateCopy.playerPlace,
          data: { item: itemKey, from: 'player', to: recipient },
          causes: [],
          importance: 3,
          tier: 0,
          summary: `You handed ${itemKey.replace(/-/g, ' ')} to ${CHARACTERS[recipient].name}.`,
        });
      }
    }

    schedulePersist(sharedLedger.getAll(), stateCopy);
    set({
      world: stateCopy,
      ledgerEvents: sharedLedger.getAll(),
      meter: globalTierMeter.snapshot(),
    });
    return res;
  },

  talkToCharacter: async (characterId: CharacterId, playerText: string) => {
    set((s) => ({ ai: { ...s.ai, isTalking: true } }));
    const stateCopy: WorldState = structuredClone(get().world);
    const currentAi = get().ai;

    const result = await runTalk({
      characterId,
      playerText,
      state: stateCopy,
      ledger: sharedLedger,
      liveAllowed: currentAi.mode === 'live' && currentAi.serverLiveAvailable,
      sessionToken: currentAi.sessionToken,
      meter: globalTierMeter,
      onModeFallback: () => {
        set((s) => ({ ai: { ...s.ai, mode: 'offline' } }));
      },
    });

    schedulePersist(sharedLedger.getAll(), stateCopy);
    set((s) => ({
      world: stateCopy,
      ledgerEvents: sharedLedger.getAll(),
      meter: globalTierMeter.snapshot(),
      ai: {
        ...s.ai,
        isTalking: false,
        mode: result.source === 'live' ? 'live' : 'offline',
        lastTurnResult: result,
      },
    }));
    return result;
  },

  resetWorld: async () => {
    await clearPersistedWorld();
    clearRuleLog();
    globalTierMeter.reset();
    const freshWorld = createInitialWorldState();
    const freshEvents = createInitialLedgerEvents();
    sharedLedger.replaceAll(freshEvents, true);
    schedulePersist(sharedLedger.getAll(), freshWorld);
    set((s) => ({
      world: freshWorld,
      ledgerEvents: sharedLedger.getAll(),
      awayEvents: [],
      awayMinutes: 0,
      meter: globalTierMeter.snapshot(),
      ai: {
        ...s.ai,
        lastTurnResult: null,
      },
    }));
    get().pushToast('World reset to Day 1 · Dusk.', 'neutral');
  },

  setScreen: (screen: ScreenId) => {
    if (typeof document !== 'undefined') {
      document.body.dataset.state = screen === 'intro' ? 'title' : 'playing';
    }
    set((s) => ({
      ui: {
        ...s.ui,
        screen,
        overlay: null,
      },
    }));
  },

  openOverlay: (overlay, characterId) => {
    set((s) => ({
      ui: {
        ...s.ui,
        overlay,
        selectedCharacter: characterId ?? s.ui.selectedCharacter,
      },
    }));
  },

  closeOverlay: () => {
    set((s) => ({
      ui: {
        ...s.ui,
        overlay: null,
      },
    }));
  },

  selectCharacter: (characterId: CharacterId) => {
    set((s) => ({
      ui: {
        ...s.ui,
        selectedCharacter: characterId,
      },
    }));
  },

  toggleSound: () => {
    set((s) => {
      const next = !s.ui.soundOn;
      return {
        ui: { ...s.ui, soundOn: next },
      };
    });
  },

  toggleClockPlaying: () => {
    set((s) => ({
      ui: { ...s.ui, clockPlaying: !s.ui.clockPlaying },
    }));
  },

  setTimeLensSpeed: (speed) => {
    set((s) => ({
      ui: { ...s.ui, timeLensSpeed: speed },
    }));
  },

  toggleSpiritSense: () => {
    set((s) => ({
      ui: { ...s.ui, spiritSenseOn: !s.ui.spiritSenseOn },
    }));
  },

  toggleGlassesQuiet: () => {
    set((s) => ({
      ui: { ...s.ui, glassesQuiet: !s.ui.glassesQuiet },
    }));
  },

  practiceBreath: () => {
    const stateCopy: WorldState = structuredClone(get().world);
    const prevSpirit = stateCopy.spirit;
    stateCopy.spirit = Math.min(100, stateCopy.spirit + 18);
    let breakthrough = false;
    if (stateCopy.spirit >= 100 && stateCopy.playerRealm < 9) {
      stateCopy.playerRealm += 1;
      stateCopy.spirit = 25;
      breakthrough = true;
    }

    step(15, stateCopy, sharedLedger, globalTierMeter);

    sharedLedger.append({
      t: stateCopy.now,
      realTs: Date.now(),
      type: breakthrough ? 'BREAKTHROUGH' : 'TRAINED',
      actors: ['player'],
      place: stateCopy.playerPlace,
      data: {
        spiritBefore: prevSpirit,
        spiritAfter: stateCopy.spirit,
        realm: stateCopy.playerRealm,
      },
      causes: [],
      importance: breakthrough ? 5 : 2,
      tier: 0,
      summary: breakthrough
        ? `Through steady breath practice at ${LOCATIONS[stateCopy.playerPlace].name}, you reached Realm ${stateCopy.playerRealm}.`
        : `You practiced breath stillness at ${LOCATIONS[stateCopy.playerPlace].name} (spirit now ${stateCopy.spirit}).`,
    });

    schedulePersist(sharedLedger.getAll(), stateCopy);
    set({
      world: stateCopy,
      ledgerEvents: sharedLedger.getAll(),
      meter: globalTierMeter.snapshot(),
    });
    get().pushToast(
      breakthrough
        ? `Realm ${stateCopy.playerRealm} reached.`
        : `Breath steadied (+${stateCopy.spirit - prevSpirit} spirit).`,
      breakthrough ? 'violet' : 'ember'
    );
  },

  pushToast: (text, tone = 'neutral') => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({
      ui: {
        ...s.ui,
        toasts: [...s.ui.toasts.slice(-3), { id, text, tone }],
      },
    }));
    setTimeout(() => {
      get().dismissToast(id);
    }, 3800);
  },

  dismissToast: (id) => {
    set((s) => ({
      ui: {
        ...s.ui,
        toasts: s.ui.toasts.filter((t) => t.id !== id),
      },
    }));
  },

  syncFromEngine: () => {
    set({
      ledgerEvents: sharedLedger.getAll(),
      meter: globalTierMeter.snapshot(),
    });
  },
}));
