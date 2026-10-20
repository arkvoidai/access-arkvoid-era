import { hash2, seededUnit, WORLD_SEED } from '../../world/noise.ts';
import {
  heightAt,
  pathInfluenceAt,
  regionAt,
  slopeAt,
  waterLevelAt,
} from '../../world/terrainFn.ts';
import type { CircleCollider } from './Colliders.ts';

export interface VegCellRequest {
  cellKey: string;
  cx: number;
  cz: number;
  cellSize: number; // 128 m
  treeDensity: number;
}

export interface VegCellResult {
  cellKey: string;
  cx: number;
  cz: number;
  // Packed [x, y, z, scale, rotY] (5 floats per instance)
  pines: Float32Array;
  broadleafs: Float32Array;
  maples: Float32Array;
  reeds: Float32Array;
  shrubs: Float32Array;
  rocks: Float32Array;
  wildflowers: Float32Array;
  colliders: CircleCollider[];
}

function isInsideTownPlaza(x: number, z: number): boolean {
  if (Math.hypot(x - 32, z) < 36) return true;
  if (Math.hypot(x + 45, z + 10) < 30) return true;
  if (Math.hypot(x + 5, z - 48) < 26) return true;
  if (Math.hypot(x - 70, z + 322) < 24) return true;
  if (Math.hypot(x + 120, z + 560) < 16) return true;
  return false;
}

/**
 * Deterministic seeded Poisson-like stratified cell placement for trees, shrubs, reeds,
 * rocks/boulders, wildflowers, and colliders per 128 m cell.
 * Runs off the main thread in `veg.worker.ts` (and exported for synchronous fallback/tests).
 */
export function buildVegCellData(req: VegCellRequest): VegCellResult {
  const { cellKey, cx, cz, cellSize, treeDensity } = req;
  const x0 = cx * cellSize;
  const z0 = cz * cellSize;
  const cellSeed = (WORLD_SEED + cx * 73856093 + cz * 19349663) | 0;

  const pines: number[] = [];
  const broadleafs: number[] = [];
  const maples: number[] = [];
  const reeds: number[] = [];
  const shrubs: number[] = [];
  const rocks: number[] = [];
  const wildflowers: number[] = [];
  const colliders: CircleCollider[] = [];

  // 1. TREES & ROCKS: 8 x 8 jittered Poisson grid (16 m spacing)
  const gridN = 8;
  const step = cellSize / gridN;

  for (let gz = 0; gz < gridN; gz++) {
    for (let gx = 0; gx < gridN; gx++) {
      const idx = gz * gridN + gx;
      const r1 = seededUnit(idx * 7 + 1, cellSeed);
      const r2 = seededUnit(idx * 7 + 2, cellSeed);
      const r3 = seededUnit(idx * 7 + 3, cellSeed);
      const r4 = seededUnit(idx * 7 + 4, cellSeed);

      if (r1 > treeDensity) continue;

      const wx = x0 + (gx + 0.15 + r2 * 0.7) * step;
      const wz = z0 + (gz + 0.15 + r3 * 0.7) * step;

      const reg = regionAt(wx, wz);
      if (reg === 'outer') continue;

      const wl = waterLevelAt(wx, wz);
      const wy = heightAt(wx, wz);
      const slopeDeg = (slopeAt(wx, wz) * 180) / Math.PI;
      const pathDist = pathInfluenceAt(wx, wz).dist;

      // Keep paths clear
      if (pathDist < 4.2) continue;

      // Reeds along water shores
      if (wl !== null && Math.abs(wy - wl) < 1.6) {
        for (let k = 0; k < 3; k++) {
          const ox = (seededUnit(idx * 13 + k, cellSeed) - 0.5) * 2.8;
          const oz = (seededUnit(idx * 13 + k + 5, cellSeed) - 0.5) * 2.8;
          const ry = heightAt(wx + ox, wz + oz);
          reeds.push(
            wx + ox,
            ry,
            wz + oz,
            0.85 + r4 * 0.45,
            r2 * Math.PI * 2
          );
        }
        continue;
      }

      if (wl !== null && wy < wl) continue;

      // Cliff foot boulder groups & rocky outcrops
      if (slopeDeg > 30 || reg === 'ashen' || reg === 'cliff') {
        if (r4 < 0.52) {
          const rockScale = slopeDeg > 36 ? 1.8 + r2 * 2.4 : 0.9 + r3 * 1.5;
          rocks.push(wx, wy - 0.25, wz, rockScale, r1 * Math.PI * 2);
          if (rockScale > 1.3) {
            colliders.push({
              kind: 'circle',
              id: `rock_${cellKey}_${idx}`,
              x: wx,
              z: wz,
              radius: rockScale * 0.95,
              tag: 'rock',
            });
          }
        }
        continue;
      }

      if (isInsideTownPlaza(wx, wz)) {
        // Only allow a few curated small maples near the edges of the courtyard/terraces
        const edgeCourt = Math.hypot(wx - 32, wz);
        const edgeUpper = Math.hypot(wx + 45, wz + 10);
        if ((edgeCourt > 26 && edgeCourt < 35) || (edgeUpper > 22 && edgeUpper < 29)) {
          if (r4 < 0.35) {
            maples.push(wx, wy, wz, 0.85 + r2 * 0.3, r3 * Math.PI * 2);
            colliders.push({
              kind: 'circle',
              id: `maple_${cellKey}_${idx}`,
              x: wx,
              z: wz,
              radius: 0.55,
              tag: 'trunk',
            });
          }
        }
        continue;
      }

      // Summit sparsity
      if (wy > 380 && r4 > 0.22) continue;

      // Forest density mask using low-freq hash
      const forestMask = hash2(Math.floor(wx * 0.015), Math.floor(wz * 0.015), WORLD_SEED + 88);
      if (forestMask < 0.28) {
        // Sparse rocks or wildflowers in clearings
        if (r4 < 0.28) {
          rocks.push(wx, wy - 0.15, wz, 0.65 + r2 * 0.9, r3 * Math.PI * 2);
        }
        continue;
      }

      const scale = 0.85 + r2 * 0.45;
      const rotY = r3 * Math.PI * 2;

      if (reg === 'town' && r4 < 0.24) {
        // Restraint: occasional ember-red maple on town outskirts/terraces
        maples.push(wx, wy, wz, scale * 0.92, rotY);
      } else if (wy < 185 && r4 < 0.38) {
        // Ancient broadleaf in lower valley & outskirts
        broadleafs.push(wx, wy, wz, scale, rotY);
      } else {
        // Tall olive-ink conifer pine
        pines.push(wx, wy, wz, scale, rotY);
      }

      colliders.push({
        kind: 'circle',
        id: `tree_${cellKey}_${idx}`,
        x: wx,
        z: wz,
        radius: 0.52 * scale,
        tag: 'trunk',
      });
    }
  }

  // 2. SHRUBS, FERNS & SPARSE EMBER/IVORY WILDFLOWERS
  const detailCount = Math.floor(22 * treeDensity);
  for (let i = 0; i < detailCount; i++) {
    const u1 = seededUnit(i * 11 + 101, cellSeed);
    const u2 = seededUnit(i * 11 + 102, cellSeed);
    const u3 = seededUnit(i * 11 + 103, cellSeed);

    const wx = x0 + u1 * cellSize;
    const wz = z0 + u2 * cellSize;
    if (isInsideTownPlaza(wx, wz)) continue;
    if (pathInfluenceAt(wx, wz).dist < 2.8) continue;

    const wl = waterLevelAt(wx, wz);
    const wy = heightAt(wx, wz);
    if (wl !== null && wy <= wl + 0.2) continue;
    if ((slopeAt(wx, wz) * 180) / Math.PI > 30) continue;
    if (regionAt(wx, wz) === 'ashen') continue;

    if (u3 < 0.62) {
      shrubs.push(wx, wy, wz, 0.7 + u1 * 0.6, u2 * Math.PI * 2);
    } else {
      wildflowers.push(wx, wy, wz, 0.8 + u2 * 0.5, u1 * Math.PI * 2);
    }
  }

  return {
    cellKey,
    cx,
    cz,
    pines: new Float32Array(pines),
    broadleafs: new Float32Array(broadleafs),
    maples: new Float32Array(maples),
    reeds: new Float32Array(reeds),
    shrubs: new Float32Array(shrubs),
    rocks: new Float32Array(rocks),
    wildflowers: new Float32Array(wildflowers),
    colliders,
  };
}

const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof window === 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function';

if (isWorkerScope) {
  self.onmessage = (e: MessageEvent<VegCellRequest>) => {
    const res = buildVegCellData(e.data);
    (self as unknown as Worker).postMessage(res, [
      res.pines.buffer,
      res.broadleafs.buffer,
      res.maples.buffer,
      res.reeds.buffer,
      res.shrubs.buffer,
      res.rocks.buffer,
      res.wildflowers.buffer,
    ]);
  };
}
