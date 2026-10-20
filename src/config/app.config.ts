import type { Character, CharacterId, LedgerEvent, LocationId, WorldState } from '../engine/types.ts';

export interface LocationMeta {
  id: LocationId;
  name: string;
  region: string;
  minRealm: number;
  description: string;
  neighbors: LocationId[];
}

export const LOCATIONS: Record<LocationId, LocationMeta> = {
  'east-gate': {
    id: 'east-gate',
    name: 'East Gate',
    region: 'Lower Valley',
    minRealm: 1,
    description: 'Twin stone arches guarding the mist valley entrance. Iron lanterns hang beside the warden post.',
    neighbors: ['lantern-terrace', 'beast-ridge'],
  },
  'lantern-terrace': {
    id: 'lantern-terrace',
    name: 'Lantern Terrace',
    region: 'Lower Valley',
    minRealm: 1,
    description: 'Wide flagstone steps where dusk lamps are lit each evening to guide watches coming off the ridge.',
    neighbors: ['east-gate', 'hall-of-records', 'overlook'],
  },
  'hall-of-records': {
    id: 'hall-of-records',
    name: 'Hall of Records',
    region: 'Inner Ward',
    minRealm: 1,
    description: 'Quiet timber galleries lined with cedar tablets recording every oath, tally, and gate passage.',
    neighbors: ['lantern-terrace', 'overlook'],
  },
  'beast-ridge': {
    id: 'beast-ridge',
    name: 'Beast Ridge',
    region: 'Outer Crags',
    minRealm: 1,
    description: 'Wind-swept pines and herb terraces where spirit beasts shelter below the frost line.',
    neighbors: ['east-gate', 'overlook'],
  },
  overlook: {
    id: 'overlook',
    name: 'High Overlook',
    region: 'Upper Crags',
    minRealm: 1,
    description: 'A narrow stone spur above the cloud sea looking toward the high realms.',
    neighbors: ['lantern-terrace', 'hall-of-records', 'beast-ridge', 'sky-realms'],
  },
  'sky-realms': {
    id: 'sky-realms',
    name: 'Sky Realms',
    region: 'Upper Air',
    minRealm: 3,
    description: 'Floating stone shelves suspended in thin, cold air above the valley clouds.',
    neighbors: ['overlook', 'ashen-march'],
  },
  'ashen-march': {
    id: 'ashen-march',
    name: 'Ashen March',
    region: 'Outer Rim',
    minRealm: 5,
    description: 'Cinder plains where old boundary stones still hum with old vows.',
    neighbors: ['sky-realms', 'open-cosmos'],
  },
  'open-cosmos': {
    id: 'open-cosmos',
    name: 'Open Cosmos',
    region: 'Beyond the Veil',
    minRealm: 8,
    description: 'The still expanse beyond the highest arch where breath and sky become one.',
    neighbors: ['ashen-march'],
  },
};

export const REALM_NAMES: Record<number, string> = {
  1: 'First Breath',
  2: 'Steady Pulse',
  3: 'Clear Sight',
  4: 'Stone Root',
  5: 'Still Water',
  6: 'High Wind',
  7: 'Cloud Step',
  8: 'Deep Sky',
  9: 'Unbound Arch',
};

export const CHARACTERS: Record<CharacterId, Character> = {
  seren: {
    id: 'seren',
    name: 'Seren',
    role: 'Gate Warden',
    portraitKey: 'seren',
    traits: ['vigilant', 'fair-minded', 'keeps written tallies', 'distrusts haste'],
    goals: ['keep the East Gate seal intact before nightfall', 'verify travelers entering from the ridge'],
    voice: 'Measured, observant, plain-spoken, protective of the stone threshold',
    homePlace: 'east-gate',
    routine: [
      { fromHour: 0, toHour: 5, place: 'east-gate', activity: 'resting in the gatehouse bunk' },
      { fromHour: 5, toHour: 12, place: 'east-gate', activity: 'inspecting the outer arch stones' },
      { fromHour: 12, toHour: 14, place: 'lantern-terrace', activity: 'sharing midday tea and watch notes' },
      { fromHour: 14, toHour: 20, place: 'east-gate', activity: 'standing watch at the East Gate' },
      { fromHour: 20, toHour: 24, place: 'east-gate', activity: 'resting in the gatehouse bunk' },
    ],
  },
  ione: {
    id: 'ione',
    name: 'Ione',
    role: 'Lantern Keeper',
    portraitKey: 'ione',
    traits: ['steady', 'generous', 'remembers every debt of kindness', 'soft-spoken'],
    goals: ['keep the dusk lamps lit along the stone steps', 'prepare warm broth for the night watch'],
    voice: 'Warm, patient, attentive to small shifts in wind and flame',
    homePlace: 'lantern-terrace',
    routine: [
      { fromHour: 0, toHour: 5, place: 'lantern-terrace', activity: 'resting in the lamp alcove' },
      { fromHour: 5, toHour: 11, place: 'lantern-terrace', activity: 'trimming wicks and pressing oil' },
      { fromHour: 11, toHour: 16, place: 'hall-of-records', activity: 'checking lamp oil tallies with Veyra' },
      { fromHour: 16, toHour: 20, place: 'lantern-terrace', activity: 'lighting the dusk lanterns along the steps' },
      { fromHour: 20, toHour: 24, place: 'lantern-terrace', activity: 'resting in the lamp alcove' },
    ],
  },
  veyra: {
    id: 'veyra',
    name: 'Veyra',
    role: 'Archivist',
    portraitKey: 'veyra',
    traits: ['methodical', 'skeptical of rumors', 'respects proof', 'unhurried'],
    goals: ['reconcile the ledger tablets before the third bell', 'trace missing storehouse seals'],
    voice: 'Precise, dry, exacting about dates and causes',
    homePlace: 'hall-of-records',
    routine: [
      { fromHour: 0, toHour: 5, place: 'hall-of-records', activity: 'resting in the upper study' },
      { fromHour: 5, toHour: 17, place: 'hall-of-records', activity: 'cataloguing cedar ledger tablets' },
      { fromHour: 17, toHour: 20, place: 'lantern-terrace', activity: 'reviewing evening watch reports' },
      { fromHour: 20, toHour: 24, place: 'hall-of-records', activity: 'resting in the upper study' },
    ],
  },
  mirel: {
    id: 'mirel',
    name: 'Mirel',
    role: 'Ridge Herbalist',
    portraitKey: 'mirel',
    traits: ['resourceful', 'unsentimental', 'protective of ridge creatures', 'observant'],
    goals: ['gather spirit-root before frost settles', 'mend the wind-torn drying racks'],
    voice: 'Direct, earthy, pragmatic, slightly weathered',
    homePlace: 'beast-ridge',
    routine: [
      { fromHour: 0, toHour: 5, place: 'beast-ridge', activity: 'resting in the herb shed' },
      { fromHour: 5, toHour: 15, place: 'beast-ridge', activity: 'foraging spirit-root along the crags' },
      { fromHour: 15, toHour: 19, place: 'east-gate', activity: 'delivering dried roots to the gate store' },
      { fromHour: 19, toHour: 20, place: 'beast-ridge', activity: 'banking the drying fire' },
      { fromHour: 20, toHour: 24, place: 'beast-ridge', activity: 'resting in the herb shed' },
    ],
  },
  orin: {
    id: 'orin',
    name: 'Orin',
    role: 'Overlook Watcher',
    portraitKey: 'orin',
    traits: ['patient', 'long-sighted', 'calm under pressure', 'seldom promises lightly'],
    goals: ['watch the cloud line toward the Sky Realms', 'guide climbers who have earned the breath required'],
    voice: 'Quiet, unhurried, speaks in short clear observations',
    homePlace: 'overlook',
    routine: [
      { fromHour: 0, toHour: 5, place: 'overlook', activity: 'resting by the wind shelter' },
      { fromHour: 5, toHour: 18, place: 'overlook', activity: 'watching the upper cloud currents' },
      { fromHour: 18, toHour: 20, place: 'lantern-terrace', activity: 'reporting weather signs to the terrace' },
      { fromHour: 20, toHour: 24, place: 'overlook', activity: 'resting by the wind shelter' },
    ],
  },
};

export const CHARACTER_ORDER: CharacterId[] = ['seren', 'ione', 'veyra', 'mirel', 'orin'];

export const INITIAL_SEED = 42019;

// Day 1, 18:05 is 18 * 60 + 5 = 1085 minutes since Day 1, 00:00
export const SEED_WORLD_MINUTE = 18 * 60 + 5;

export function createInitialWorldState(nowReal: number = Date.now()): WorldState {
  return {
    seed: INITIAL_SEED,
    now: SEED_WORLD_MINUTE,
    lastSeenReal: nowReal,
    startedReal: nowReal,
    playerPlace: 'east-gate',
    playerRealm: 1,
    spirit: 64,
    inventory: {
      'spirit-root': 2,
      'river-stone': 1,
      'timber-pin': 1,
    },
    npcInventory: {
      seren: { 'gate-key': 1, 'watch-tally': 1 },
      ione: { 'lantern-oil': 3, 'warm-broth': 2 },
      veyra: { 'archive-seal': 1, 'cedar-tablet': 4 },
      mirel: { 'spirit-root': 3, 'ridge-salve': 2 },
      orin: { 'wind-chime': 1, 'sky-token': 1 },
    },
    npcPlace: {
      seren: 'east-gate',
      ione: 'lantern-terrace',
      veyra: 'lantern-terrace',
      mirel: 'east-gate',
      orin: 'lantern-terrace',
    },
    npcActivity: {
      seren: 'standing watch at the East Gate',
      ione: 'lighting the dusk lanterns along the steps',
      veyra: 'reviewing evening watch reports',
      mirel: 'delivering dried roots to the gate store',
      orin: 'reporting weather signs to the terrace',
    },
    trust: {
      seren: 1,
      ione: 2,
      veyra: 0,
      mirel: 1,
      orin: 1,
    },
    promises: [
      {
        id: 'p_001',
        by: 'player',
        to: 'seren',
        text: 'Bring two dry spirit-roots to reinforce the East Gate brazier before nightfall.',
        madeAt: 16 * 60 + 30,
        dueBy: 20 * 60,
        status: 'open',
        sourceEvent: 'e_000003',
      },
    ],
    flags: {
      gateBraceChecked: true,
      duskBellRung: true,
    },
    version: 1,
  };
}

export function createInitialLedgerEvents(nowReal: number = Date.now()): LedgerEvent[] {
  return [
    {
      id: 'e_000001',
      t: 8 * 60 + 15,
      realTs: nowReal - 3_600_000 * 3,
      type: 'SIGHTED',
      actors: ['seren', 'orin'],
      place: 'east-gate',
      data: { public: true, detail: 'frost-crack-in-outer-arch' },
      causes: [],
      importance: 3,
      tier: 0,
      summary: 'Seren and Orin found a hairline frost crack along the East Gate arch stone.',
    },
    {
      id: 'e_000002',
      t: 14 * 60 + 20,
      realTs: nowReal - 3_600_000 * 2,
      type: 'ITEM_GATHERED',
      actors: ['mirel'],
      place: 'beast-ridge',
      data: { item: 'spirit-root', count: 3, public: true },
      causes: ['e_000001'],
      importance: 2,
      tier: 0,
      summary: 'Mirel gathered three bundles of spirit-root on Beast Ridge for the gate brazier.',
    },
    {
      id: 'e_000003',
      t: 16 * 60 + 30,
      realTs: nowReal - 3_600_000,
      type: 'PROMISE_MADE',
      actors: ['player', 'seren'],
      place: 'east-gate',
      data: { promiseId: 'p_001', dueBy: 20 * 60 },
      causes: ['e_000001'],
      importance: 4,
      tier: 2,
      summary: 'You promised Seren to bring two dry spirit-roots to warm the East Gate brazier before nightfall.',
    },
    {
      id: 'e_000004',
      t: 17 * 60 + 45,
      realTs: nowReal - 1_200_000,
      type: 'WORK_COMPLETED',
      actors: ['ione'],
      place: 'lantern-terrace',
      data: { task: 'dusk-lanterns', public: true },
      causes: [],
      importance: 3,
      tier: 0,
      summary: 'Ione lit the first row of dusk lanterns along Lantern Terrace as the mist rose.',
    },
  ];
}
