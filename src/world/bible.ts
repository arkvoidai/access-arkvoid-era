import type { LocationId } from '../engine/types.ts';

export const EYE_HEIGHT = 1.65,
  WALK = 3.2,
  RUN = 6.4,
  GLIDE = 14; // m/s

export const WORLD = {
  minX: -1700,
  maxX: 1100,
  minZ: -1000,
  maxZ: 1000,
}; // playable ground

export const SPACE_START = 2500,
  SPACE_FULL = 4500; // metres of altitude where the sky fades to space

export const CLOUD_SEA = { y0: 250, y1: 335 }; // the cloud sea slab

export const SISTER = {
  center: [14300, 5700, -20800] as const,
  radius: 4800,
}; // the pale planet in the sky (m)

export const PLACES = {
  'east-gate': {
    anchor: [34, 140, 0],
    look: [1, 0, 0],
    label: 'The East Gate',
  },
  'lantern-terrace': {
    anchor: [-262, 96, 214],
    look: [0.3, 0, -0.95],
    label: 'Lantern Terrace',
  },
  'hall-of-records': {
    anchor: [70, 150, -318],
    look: [0, 0, -1],
    label: 'The Hall of Records',
  },
  'beast-ridge': {
    anchor: [508, 262, -70],
    look: [1, 0, -0.3],
    label: 'Beast Ridge',
  },
  overlook: {
    anchor: [-120, 432, -560],
    look: [0, 0, 1],
    label: 'The Overlook',
  },
  'sky-realms': {
    anchor: [-110, 985, -620],
    look: [0, 0, 1],
    label: 'The Sky Realms',
  },
  'ashen-march': {
    anchor: [-1100, 66, 600],
    look: [1, 0, -0.4],
    label: 'The Ashen March',
  },
  'open-cosmos': {
    anchor: [-110, 5200, -620],
    look: [0.5, 0.1, -0.85],
    label: 'The Open Cosmos',
  },
} as const;

export const PLACE_IDS: readonly LocationId[] = [
  'east-gate',
  'lantern-terrace',
  'hall-of-records',
  'beast-ridge',
  'overlook',
  'sky-realms',
  'ashen-march',
  'open-cosmos',
] as const;

export const TIME_SCALE = 0.1; // 0.1 world minutes per real second

export const LANDMARKS = {
  gate: {
    arch: [64, 140, 0] as const,
    facing: [1, 0, 0] as const,
    serenAnchor: [58, 140, 0] as const,
    playerSpawn: [34, 140, 0] as const,
    playerFacing: [1, 0, 0] as const,
  },
  courtyard: {
    center: [30, 0] as const,
    radius: 38,
    targetHeight: 140,
  },
  upperTerrace: {
    center: [-45, -10] as const,
    radius: 35,
    height: 150,
  },
  lowerCourt: {
    center: [-5, 48] as const,
    radius: 30,
    height: 131,
    orinWorkshop: [-8, 48] as const,
  },
  market: [8, -30] as const,
  stoneBridge: [-12, 5] as const,
  stream: [
    [-30, -140],
    [-12, -40],
    [-12, 20],
    [10, 70],
    [30, 130],
  ] as const,
  waterfallLedge: [30, 130] as const,
  terraceCottage: [-262, 96, 214] as const,
  valleyLake: {
    center: [-330, 300] as const,
    radius: 70,
    waterLevel: 58,
    valleyFloor: 60,
  },
  hallDoor: {
    pos: [70, 150, -338] as const,
    cliffZ: -340,
    cliffXMin: -60,
    cliffXMax: 220,
    cliffHeight: 120,
    interiorCell: {
      center: [6000, 0, 6000] as const,
      width: 70,
      height: 26,
      length: 100,
    },
  },
  mirelAnchor: [6000, 0, 6030] as const,
  nestLedge: [545, 254, -92] as const,
  veyraAnchor: [508, 262, -70] as const,
  overlookPlatform: {
    center: [-120, 432, -560] as const,
    radius: 14,
  },
  heroMaple: [-128, 432, -556] as const,
  breathSpot: [-120, 432, -560] as const,
  rootSpot: [-112, 432, -566] as const,
  ascentColumn: [-120, 432, -560] as const,
  skyIslands: [
    { center: [-110, 985, -620] as const, radius: 140, isLanding: true },
    { center: [150, 920, -620] as const, radius: 52, isLanding: false },
    { center: [52, 1060, -417] as const, radius: 46, isLanding: false },
    { center: [-168, 1140, -366] as const, radius: 58, isLanding: false },
    { center: [-344, 1230, -507] as const, radius: 48, isLanding: false },
    { center: [-344, 1340, -733] as const, radius: 54, isLanding: false },
    { center: [-168, 1450, -874] as const, radius: 64, isLanding: false },
  ] as const,
  ashenBasin: {
    center: [-1100, 60, 600] as const,
    lavaLevel: 58,
    lavaRadius: 220,
  },
  fortressRuin: [-1250, 200, 520] as const,
  lawSeal: [-760, 120, 380] as const,
  paths: {
    townToLanternTerrace: [
      [30, 0],
      [-5, 48],
      [-60, 95],
      [-115, 75],
      [-175, 135],
      [-210, 175],
      [-262, 214],
    ] as const,
    townToHallOfRecords: [
      [30, 0],
      [42, -80],
      [55, -165],
      [64, -245],
      [70, -318],
    ] as const,
    townToBeastRidge: [
      [34, 0],
      [64, 0],
      [160, -12],
      [275, -35],
      [390, -52],
      [508, -70],
    ] as const,
    townToOverlook: [
      [30, 0],
      [-45, -10],
      [-95, -110],
      [-40, -210],
      [-135, -310],
      [-70, -415],
      [-145, -495],
      [-120, -560],
    ] as const,
  },
  realmGate: {
    'sky-realms': 4,
    'ashen-march': 5,
    'open-cosmos': 6,
  } as const,
} as const;

/**
 * Returns the nearest LocationId by distance, with `open-cosmos` when y > 2600
 * and `sky-realms` when y > 800.
 */
export function placeAt(x: number, y: number, z: number): LocationId {
  if (y > 2600) {
    return 'open-cosmos';
  }
  if (y > 800) {
    return 'sky-realms';
  }
  // Check if inside the Hall of Records interior cell around (6000, 0, 6000)
  if (x > 5800 && z > 5800) {
    return 'hall-of-records';
  }

  let bestId: LocationId = 'east-gate';
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const id of PLACE_IDS) {
    if (id === 'open-cosmos' || id === 'sky-realms') continue;
    const [ax, ay, az] = PLACES[id].anchor;
    const dx = x - ax;
    const dy = y - ay;
    const dz = z - az;
    const dSq = dx * dx + dy * dy + dz * dz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestId = id;
    }
  }

  return bestId;
}
