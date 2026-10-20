import { LANDMARKS, WORLD } from './bible.ts';
import {
  domainWarp2D,
  fbm2D,
  gradientNoise2D,
  ridgedFbm2D,
  valueNoise2D,
  WORLD_SEED,
} from './noise.ts';

export { WORLD_SEED };

export type SurfaceType = 'grass' | 'rock' | 'path' | 'wood' | 'stone' | 'water' | 'ash';
export type SurfaceKind = SurfaceType;
export type RegionId = 'town' | 'valley' | 'ridge' | 'cliff' | 'summit' | 'ashen' | 'outer';

export interface PathSplineSample {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  lengthFromStart: number;
}

export interface PathSpline {
  id: 'townToLanternTerrace' | 'townToHallOfRecords' | 'townToBeastRidge' | 'townToOverlook';
  samples: readonly PathSplineSample[];
  totalLength: number;
  sampleAtDistance: (dist: number) => PathSplineSample;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Smooth plateau helper `stamp(x, z, cx, cz, r, target, blend)`.
 * Returns `[weight, target]` where `weight` is 1 inside radius `r` and smoothly falls to 0 over `blend` metres.
 */
export function stamp(
  x: number,
  z: number,
  cx: number,
  cz: number,
  r: number,
  target: number,
  blend: number
): { weight: number; target: number } {
  const dist = Math.hypot(x - cx, z - cz);
  if (dist <= r) return { weight: 1, target };
  if (dist >= r + blend) return { weight: 0, target };
  const t = (dist - r) / Math.max(0.001, blend);
  const s = 1 - t * t * (3 - 2 * t);
  return { weight: s, target };
}

function catmullRom1D(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Control points for the 4 smoothed paths with explicit elevation targets (`[x, y, z]`)
 * so that cut-and-fill flattens the ground along each path and slopes stay under ~22 degrees.
 */
const RAW_PATH_CONTROLS: Readonly<
  Record<PathSpline['id'], ReadonlyArray<readonly [number, number, number]>>
> = {
  townToLanternTerrace: [
    [30, 140, 0],
    [-5, 131, 48],
    [-60, 122, 95],
    [-115, 114, 75],
    [-175, 106, 135],
    [-210, 100, 175],
    [-262, 96, 214],
  ],
  townToHallOfRecords: [
    [30, 140, 0],
    [42, 142, -80],
    [55, 145, -165],
    [64, 148, -245],
    [70, 150, -318],
  ],
  townToBeastRidge: [
    [34, 140, 0],
    [64, 140, 0],
    [160, 105, -12],
    [275, 76, -35],
    [355, 72, -45],
    [425, 152, -58],
    [472, 224, -64],
    [508, 262, -70],
  ],
  townToOverlook: [
    [30, 140, 0],
    [-45, 150, -10],
    [-95, 188, -110],
    [-40, 232, -210],
    [-135, 282, -310],
    [-70, 336, -415],
    [-145, 388, -495],
    [-120, 432, -560],
  ],
};

function buildCatmullRomSpline(
  id: PathSpline['id'],
  pts: ReadonlyArray<readonly [number, number, number]>,
  subdivisionsPerSegment = 14
): PathSpline {
  const samples: PathSplineSample[] = [];
  let totalLength = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    const steps = i === pts.length - 2 ? subdivisionsPerSegment + 1 : subdivisionsPerSegment;
    for (let s = 0; s < steps; s++) {
      const t = s / subdivisionsPerSegment;
      const x = catmullRom1D(p0[0], p1[0], p2[0], p3[0], t);
      const y = catmullRom1D(p0[1], p1[1], p2[1], p3[1], t);
      const z = catmullRom1D(p0[2], p1[2], p2[2], p3[2], t);

      if (samples.length > 0) {
        const prev = samples[samples.length - 1];
        totalLength += Math.hypot(x - prev.x, z - prev.z);
      }

      samples.push({
        x,
        y,
        z,
        tx: 1,
        tz: 0,
        lengthFromStart: totalLength,
      });
    }
  }

  for (let i = 0; i < samples.length; i++) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    samples[i].tx = dx / len;
    samples[i].tz = dz / len;
  }

  return {
    id,
    samples,
    totalLength,
    sampleAtDistance(dist: number): PathSplineSample {
      if (dist <= 0) return samples[0];
      if (dist >= totalLength) return samples[samples.length - 1];
      let lo = 0;
      let hi = samples.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].lengthFromStart <= dist) lo = mid;
        else hi = mid;
      }
      const a = samples[lo];
      const b = samples[hi];
      const span = Math.max(0.0001, b.lengthFromStart - a.lengthFromStart);
      const f = (dist - a.lengthFromStart) / span;
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        z: a.z + (b.z - a.z) * f,
        tx: a.tx + (b.tx - a.tx) * f,
        tz: a.tz + (b.tz - a.tz) * f,
        lengthFromStart: dist,
      };
    },
  };
}

export const PATHS: Readonly<Record<PathSpline['id'], PathSpline>> = {
  townToLanternTerrace: buildCatmullRomSpline(
    'townToLanternTerrace',
    RAW_PATH_CONTROLS.townToLanternTerrace
  ),
  townToHallOfRecords: buildCatmullRomSpline(
    'townToHallOfRecords',
    RAW_PATH_CONTROLS.townToHallOfRecords
  ),
  townToBeastRidge: buildCatmullRomSpline('townToBeastRidge', RAW_PATH_CONTROLS.townToBeastRidge),
  townToOverlook: buildCatmullRomSpline('townToOverlook', RAW_PATH_CONTROLS.townToOverlook),
};

const ALL_PATH_SPLINES: readonly PathSpline[] = [
  PATHS.townToLanternTerrace,
  PATHS.townToHallOfRecords,
  PATHS.townToBeastRidge,
  PATHS.townToOverlook,
];

// Extended stream segments: upper town stream down to waterfall ledge (30, 130) at 130m,
// then lower stream from shelf (30, 138) at 92m flowing into the Valley Lake at (-330, 300) at 58m.
const UPPER_STREAM_PTS: ReadonlyArray<readonly [number, number, number]> = [
  [-30, 146, -140],
  [-12, 141, -40],
  [-12, 138, 20],
  [10, 134, 70],
  [30, 130, 130],
];

const LOWER_STREAM_PTS: ReadonlyArray<readonly [number, number, number]> = [
  [30, 92, 138],
  [-45, 82, 175],
  [-155, 68, 232],
  [-265, 60, 276],
  [-330, 58, 300],
];

function closestSegmentOnPolyline3D(
  x: number,
  z: number,
  pts: ReadonlyArray<readonly [number, number, number]>
): { distSq: number; y: number } {
  let bestDistSq = Number.POSITIVE_INFINITY;
  let bestY = pts[0][1];

  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i][0];
    const y0 = pts[i][1];
    const z0 = pts[i][2];
    const x1 = pts[i + 1][0];
    const y1 = pts[i + 1][1];
    const z1 = pts[i + 1][2];

    const vx = x1 - x0;
    const vz = z1 - z0;
    const lenSq = vx * vx + vz * vz;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / lenSq)) : 0;
    const px = x0 + vx * t;
    const pz = z0 + vz * t;
    const dSq = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestY = y0 + (y1 - y0) * t;
    }
  }
  return { distSq: bestDistSq, y: bestY };
}

/**
 * Evaluates distance and cut-and-fill weight to the nearest smoothed path spline.
 * Within 1.6 m of the centreline, weight = 1; blends out to 0 over a 4 m shoulder (out to 5.6 m).
 */
export function pathInfluenceAt(x: number, z: number): {
  dist: number;
  height: number;
  weight: number;
} {
  // Quick bounding-box reject for distant terrain far from all paths
  if (x < -310 || x > 550 || z < -600 || z > 250) {
    return { dist: 999, height: 140, weight: 0 };
  }

  let bestDistSq = Number.POSITIVE_INFINITY;
  let bestY = 140;

  for (let p = 0; p < ALL_PATH_SPLINES.length; p++) {
    const samples = ALL_PATH_SPLINES[p].samples;
    // Step by 2 segments for fast coarse check, then refine
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const vx = b.x - a.x;
      const vz = b.z - a.z;
      const lenSq = vx * vx + vz * vz;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / lenSq)) : 0;
      const px = a.x + vx * t;
      const pz = a.z + vz * t;
      const dSq = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestY = a.y + (b.y - a.y) * t;
      }
    }
  }

  const dist = Math.sqrt(bestDistSq);
  if (dist >= 5.6) {
    return { dist, height: bestY, weight: 0 };
  }
  if (dist <= 1.6) {
    return { dist, height: bestY, weight: 1 };
  }
  const t = (dist - 1.6) / 4.0;
  const weight = 1 - t * t * (3 - 2 * t);
  return { dist, height: bestY, weight };
}

/**
 * Evaluates stream channel carving and waterfall ledge influence at `(x, z)`.
 */
export function streamInfluenceAt(x: number, z: number): {
  dist: number;
  waterLevel: number;
  bedDepth: number;
  isWaterfall: boolean;
} {
  if (x < -380 || x > 80 || z < -160 || z > 340) {
    return { dist: 999, waterLevel: 0, bedDepth: 0, isWaterfall: false };
  }

  const upper = closestSegmentOnPolyline3D(x, z, UPPER_STREAM_PTS);
  const lower = closestSegmentOnPolyline3D(x, z, LOWER_STREAM_PTS);

  const useUpper = upper.distSq <= lower.distSq;
  const dist = Math.sqrt(useUpper ? upper.distSq : lower.distSq);
  const waterY = useUpper ? upper.y : lower.y;

  // Waterfall plunge zone around (30, 130..138)
  const wfDist = Math.hypot(x - 30, z - 134);
  const isWaterfall = wfDist < 8.5;

  // Stream channel is ~3 m wide (half-width 1.5 m, smooth banks to 3.8 m), 1.2 m deep
  if (dist >= 3.8) {
    return { dist, waterLevel: waterY, bedDepth: 0, isWaterfall };
  }
  const bankFactor = 1 - smoothstep(1.1, 3.8, dist);
  return {
    dist,
    waterLevel: waterY,
    bedDepth: 1.2 * bankFactor,
    isWaterfall,
  };
}

/**
 * Pure deterministic terrain height function `heightAt(x, z)` in metres.
 * Shared by the main thread, terrain & vegetation Web Workers, and Node unit tests.
 */
export function heightAt(x: number, z: number): number {
  // Hall of Records interior cell around (6000, 0, 6000)
  if (x > 5800 && z > 5800) {
    return 0;
  }

  // 1. BASE LAYER: Low-frequency domain-warped fBm + ridged noise (amplitude ~120 m)
  const [wx, wz] = domainWarp2D(x, z, 85, 0.0011, WORLD_SEED);
  const baseFbm = fbm2D(wx * 0.0011, wz * 0.0011, 4, WORLD_SEED + 7);
  const baseRidged = ridgedFbm2D(wx * 0.0013 + 5.2, wz * 0.0013 - 3.8, 4, WORLD_SEED + 19);
  let h = 112 + baseFbm * 58 + (baseRidged - 0.35) * 68;

  // 2. REGIONAL SHAPING
  // 2a. Town spur: fortress hill centered near (5, 10), falling away steeply on E, S, W
  const townSpurDist = Math.hypot((x - 10) * 0.85, (z - 10) * 1.05);
  const townSpurMask = 1 - smoothstep(65, 220, townSpurDist);
  h = h * (1 - townSpurMask * 0.78) + 138 * (townSpurMask * 0.78);

  // 2b. East road valley & Beast Ridge:
  // From gate (64, 0) descends east to a valley at ~70 m near x = 350, then rises to Beast Ridge
  // crest along (440, -140) to (600, 0) at ~262 m, steep on its east face
  const eastValleyDist = Math.hypot((x - 340) * 0.75, z + 35);
  const eastValleyMask = 1 - smoothstep(35, 165, eastValleyDist);
  h = h * (1 - eastValleyMask * 0.85) + 70 * (eastValleyMask * 0.85);

  // Distance to Beast Ridge crest segment (440, -140) -> (600, 0)
  const brVx = 600 - 440;
  const brVz = 0 - -140;
  const brLenSq = brVx * brVx + brVz * brVz;
  const brT = Math.max(0, Math.min(1, ((x - 440) * brVx + (z + 140) * brVz) / brLenSq));
  const brCx = 440 + brVx * brT;
  const brCz = -140 + brVz * brT;
  const brDx = x - brCx;
  const brDz = z - brCz;
  // Steep on the east face (brDx > 0)
  const brAnisoDist = Math.hypot(brDx > 0 ? brDx * 1.45 : brDx * 0.85, brDz);
  const brMask = 1 - smoothstep(28, 195, brAnisoDist);
  h = h * (1 - brMask * 0.9) + 262 * (brMask * 0.9);

  // 2c. South-West Valley floor (~60 m) & Valley Lake bed at (-330, 300), radius 70, bed at 52 m
  const swValleyDist = Math.hypot((x + 295) * 0.7, (z - 255) * 0.85);
  const swValleyMask = 1 - smoothstep(85, 290, swValleyDist);
  h = h * (1 - swValleyMask * 0.88) + 60 * (swValleyMask * 0.88);

  // 2d. The Overlook rock spire in the north-west at (-120, -560), height 432 m
  const ovDist = Math.hypot(x + 120, z + 560);
  const ovMountainMass = 1 - smoothstep(40, 360, ovDist);
  const ovSpire = 1 - smoothstep(14, 115, ovDist);
  h = h * (1 - ovMountainMass * 0.75) + 290 * (ovMountainMass * 0.75);
  h = h * (1 - ovSpire * 0.94) + 432 * (ovSpire * 0.94);

  // 2e. The Cliff Wall of the Hall of Records: near-vertical step along z = -340 from x = -60 to 220,
  // rising from ~150 m to ~270 m (~120 m high) with noise-displaced strata and ledges
  if (z < -315 && x > -130 && x < 290) {
    const xBlend = smoothstep(-120, -55, x) * (1 - smoothstep(215, 280, x));
    const strataWobble = gradientNoise2D(x * 0.045, z * 0.045, WORLD_SEED + 303) * 3.5;
    const cliffStep = smoothstep(-332, -352, z + strataWobble);
    const strataLedges = Math.sin(cliffStep * Math.PI * 4) * 2.2 * cliffStep * (1 - cliffStep);
    const targetCliffTop = 270 + fbm2D(x * 0.012, z * 0.012, 3, WORLD_SEED + 409) * 14;
    const baseForecourt = 150;
    const cliffY = baseForecourt + (targetCliffTop - baseForecourt) * cliffStep + strataLedges;
    h = h * (1 - xBlend * 0.92) + cliffY * (xBlend * 0.92);
  }

  // 2f. The Ashen Basin in the south-west: bowl centred (-1100, 600) with floor ~50 m,
  // rims 180..250 m, and canyon ravine leading from (-760, 380) at 120 m
  const ashenDist = Math.hypot(x + 1100, z - 600);
  if (ashenDist < 540) {
    const rimRing = Math.exp(-Math.pow((ashenDist - 295) / 85, 2));
    const rimHeight = 205 + ridgedFbm2D(x * 0.006, z * 0.006, 3, WORLD_SEED + 511) * 45;
    const bowlInside = 1 - smoothstep(140, 275, ashenDist);
    // Keep the anchor (-1100, 600) on a basalt shore promenade at 66 m while surrounding lava floor is 50..54 m
    const centerPromontory = 1 - smoothstep(16, 48, ashenDist);
    const basinFloorY = 51 + centerPromontory * 15;
    h = h * (1 - rimRing * 0.82) + rimHeight * (rimRing * 0.82);
    h = h * (1 - bowlInside * 0.95) + basinFloorY * (bowlInside * 0.95);
  }

  // Canyon ravine from (-760, 380) at 120 m into Ashen Basin (-940, 495)
  const ravVx = -940 - -760;
  const ravVz = 495 - 380;
  const ravLenSq = ravVx * ravVx + ravVz * ravVz;
  const ravT = Math.max(0, Math.min(1, ((x + 760) * ravVx + (z - 380) * ravVz) / ravLenSq));
  const ravPx = -760 + ravVx * ravT;
  const ravPz = 380 + ravVz * ravT;
  const ravDist = Math.hypot(x - ravPx, z - ravPz);
  if (ravDist < 65) {
    const ravWeight = 1 - smoothstep(18, 65, ravDist);
    const ravTargetY = 120 - ravT * 42;
    h = h * (1 - ravWeight * 0.88) + ravTargetY * (ravWeight * 0.88);
  }

  // Waterfall lower shelf at (30, 138) at 92 m
  const wfShelf = stamp(x, z, 30, 142, 12, 92, 28);
  if (wfShelf.weight > 0) {
    h = h * (1 - wfShelf.weight) + wfShelf.target * wfShelf.weight;
  }

  // 3. PATHS CUT AND FILL (smoothed Catmull-Rom splines, flattened within 1.6 m, 4 m blend)
  const pathInfo = pathInfluenceAt(x, z);
  if (pathInfo.weight > 0) {
    h = h * (1 - pathInfo.weight * 0.92) + pathInfo.height * (pathInfo.weight * 0.92);
  }

  // 4. RIVERS & VALLEY LAKE BED CARVING
  const streamInfo = streamInfluenceAt(x, z);
  if (streamInfo.bedDepth > 0) {
    const channelTarget = streamInfo.waterLevel - streamInfo.bedDepth;
    const bankBlend = Math.min(1, streamInfo.bedDepth / 0.8);
    h = h * (1 - bankBlend * 0.75) + channelTarget * (bankBlend * 0.75);
  }

  const lakeStamp = stamp(
    x,
    z,
    LANDMARKS.valleyLake.center[0],
    LANDMARKS.valleyLake.center[1],
    LANDMARKS.valleyLake.radius - 14,
    52,
    24
  );
  if (lakeStamp.weight > 0) {
    h = h * (1 - lakeStamp.weight) + lakeStamp.target * lakeStamp.weight;
  }

  // 5. LANDMARK STAMPS (applied last-but-one so all bible anchors hit exact heights)
  const stamps: ReadonlyArray<readonly [number, number, number, number, number]> = [
    // Courtyard & East Gate (centre 30,0; r 38; 140 m, extending through gate at 64,0)
    [30, 0, 38, 140, 42],
    [64, 0, 18, 140, 32],
    // Upper Terrace (-45, -10; r 35; 150 m)
    [-45, -10, 35, 150, 32],
    // Lower Court (-5, 48; r 30; 131 m)
    [-5, 48, 30, 131, 28],
    // Lantern Terrace (-262, 214; r 40; 96 m)
    [-262, 214, 40, 96, 38],
    // Hall of Records entrance platform (70, -322; r 26; 150 m)
    [70, -322, 26, 150, 26],
    // Beast Ridge anchor (508, -70; r 22; 262 m)
    [508, -70, 22, 262, 36],
    // Nest Ledge (545, -92; r 14; 254 m)
    [545, -92, 14, 254, 18],
    // Overlook summit platform (-120, -560; r 24; 432 m)
    [-120, -560, 24, 432, 24],
    // Law Seal ravine entrance (-760, 380; r 16; 120 m)
    [-760, 380, 16, 120, 28],
    // Fortress Ruin (-1250, 520; r 22; 200 m)
    [-1250, 520, 22, 200, 36],
    // Ashen March anchor promontory (-1100, 600; r 16; 66 m)
    [-1100, 600, 16, 66, 22],
  ];

  for (let i = 0; i < stamps.length; i++) {
    const [cx, cz, r, target, blend] = stamps[i];
    const s = stamp(x, z, cx, cz, r, target, blend);
    if (s.weight >= 0.9999) {
      return target;
    }
    if (s.weight > 0) {
      h = h * (1 - s.weight) + s.target * s.weight;
    }
  }

  // 6. OUTER MOUNTAIN WALL: outside WORLD rectangle, climbs to 500..900 m over ~400 m
  const overX = Math.max(0, WORLD.minX - x, x - WORLD.maxX);
  const overZ = Math.max(0, WORLD.minZ - z, z - WORLD.maxZ);
  const outDist = Math.hypot(overX, overZ);
  if (outDist > 0) {
    const wallT = smoothstep(0, 420, outDist);
    const wallPeak = 520 + ridgedFbm2D(x * 0.0025, z * 0.0025, 3, WORLD_SEED + 777) * 380;
    h += wallT * wallPeak;
  }

  return h;
}

/**
 * 3-octave micro-detail height (`heightFine(x, z)`) used only for visual shader normals,
 * never for physics/collision so walking stays silk-smooth.
 */
export function heightFine(x: number, z: number): number {
  const n1 = valueNoise2D(x * 0.35, z * 0.35, WORLD_SEED + 901) * 0.14;
  const n2 = valueNoise2D(x * 0.95, z * 0.95, WORLD_SEED + 902) * 0.05;
  const n3 = valueNoise2D(x * 2.4, z * 2.4, WORLD_SEED + 903) * 0.018;
  return n1 + n2 + n3;
}

/**
 * Computes the unit surface normal at `(x, z)` via central finite differences.
 */
export function normalAt(
  x: number,
  z: number,
  target: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }
): { x: number; y: number; z: number } {
  const eps = 0.75;
  const hL = heightAt(x - eps, z);
  const hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps);
  const hU = heightAt(x, z + eps);
  const nx = hL - hR;
  const ny = 2 * eps;
  const nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  target.x = nx / len;
  target.y = ny / len;
  target.z = nz / len;
  return target;
}

/**
 * Returns the terrain slope angle in radians (`0` = flat horizontal, `PI/2` = vertical cliff) at `(x, z)`.
 */
export function slopeAt(x: number, z: number): number {
  const n = normalAt(x, z);
  return Math.acos(Math.max(-1, Math.min(1, n.y)));
}

/**
 * Returns the water surface elevation (in metres) at `(x, z)` if inside the Valley Lake or stream,
 * or `null` if on dry ground.
 */
export function waterLevelAt(x: number, z: number): number | null {
  const lakeDist = Math.hypot(
    x - LANDMARKS.valleyLake.center[0],
    z - LANDMARKS.valleyLake.center[1]
  );
  if (lakeDist <= LANDMARKS.valleyLake.radius) {
    const groundY = heightAt(x, z);
    if (groundY <= LANDMARKS.valleyLake.waterLevel + 0.35) {
      return LANDMARKS.valleyLake.waterLevel;
    }
  }

  const stream = streamInfluenceAt(x, z);
  if (stream.dist <= 2.4) {
    return stream.waterLevel;
  }

  return null;
}

/**
 * Returns the semantic region identifier at `(x, z)`:
 * `'town' | 'valley' | 'ridge' | 'cliff' | 'summit' | 'ashen' | 'outer'`.
 */
export function regionAt(x: number, z: number): RegionId {
  if (x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ) {
    return 'outer';
  }
  if (Math.hypot(x + 1100, z - 600) < 380 || Math.hypot(x + 760, z - 380) < 95) {
    return 'ashen';
  }
  if (Math.hypot(x + 120, z + 560) < 150) {
    return 'summit';
  }
  if (z < -260 && x > -110 && x < 260) {
    return 'cliff';
  }
  if (x > 290 && z > -240 && z < 120) {
    return 'ridge';
  }
  if (Math.hypot(x - 10, z - 10) < 145) {
    return 'town';
  }
  return 'valley';
}

/**
 * Returns the physical surface material at `(x, z)` for footstep audio and terrain splatting:
 * `'grass' | 'rock' | 'path' | 'wood' | 'stone' | 'water' | 'ash'`.
 */
export function surfaceAt(x: number, z: number): SurfaceType {
  const wl = waterLevelAt(x, z);
  const gy = heightAt(x, z);
  if (wl !== null && gy <= wl + 0.15) {
    return 'water';
  }

  // Stone bridge at (-12, 5)
  if (Math.hypot(x - LANDMARKS.stoneBridge[0], z - LANDMARKS.stoneBridge[1]) < 5.5) {
    return 'stone';
  }

  // Town plazas (Courtyard, Upper Terrace, Lower Court) & Overlook stone platform
  if (
    Math.hypot(x - 30, z) < 34 ||
    Math.hypot(x + 45, z + 10) < 28 ||
    Math.hypot(x + 5, z - 48) < 24 ||
    Math.hypot(x + 120, z + 560) < 14 ||
    Math.hypot(x - 70, z + 322) < 22
  ) {
    return 'stone';
  }

  // Lantern Terrace wooden cottage deck
  if (Math.hypot(x + 262, z - 214) < 12) {
    return 'wood';
  }

  if (regionAt(x, z) === 'ashen') {
    return 'ash';
  }

  const p = pathInfluenceAt(x, z);
  if (p.dist <= 2.4) {
    return 'path';
  }

  const slopeRad = slopeAt(x, z);
  if (slopeRad > (35 * Math.PI) / 180 || gy > 400) {
    return 'rock';
  }

  return 'grass';
}
