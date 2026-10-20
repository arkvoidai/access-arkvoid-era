import {
  heightAt,
  heightFine,
  pathInfluenceAt,
  regionAt,
  type RegionId,
} from '../../world/terrainFn.ts';

export interface TerrainChunkRequest {
  id: string;
  chunkX: number; // world X of chunk center
  chunkZ: number; // world Z of chunk center
  size: number;   // 128 m
  segments: number; // LOD0 = 128, LOD1 = 32, LOD2 = 8
}

export interface TerrainChunkResult {
  id: string;
  chunkX: number;
  chunkZ: number;
  segments: number;
  positions: Float32Array;
  normals: Float32Array;
  splat: Float32Array;   // vec4(grass, rockDark, rockPale, pathDirt)
  extra: Float32Array;   // vec2(ash, scree)
  cavity: Float32Array;  // float [0..1] ambient occlusion
  indices: Uint32Array;
  minY: number;
  maxY: number;
  dominantRegion: RegionId;
}

const SKIRT_DEPTH = 6.0;

/**
 * Pure builder for a single 128 m terrain chunk with a 6 m vertical skirt around all 4 edges.
 * Runs inside `terrain.worker.ts` (and exported for direct unit testing / synchronous fallback).
 */
export function buildTerrainChunkData(req: TerrainChunkRequest): TerrainChunkResult {
  const { id, chunkX, chunkZ, size, segments } = req;
  const gridCols = segments + 1;
  const mainVertCount = gridCols * gridCols;
  const skirtVertCount = 4 * gridCols;
  const totalVerts = mainVertCount + skirtVertCount;

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const splat = new Float32Array(totalVerts * 4);
  const extra = new Float32Array(totalVerts * 2);
  const cavity = new Float32Array(totalVerts);

  const half = size * 0.5;
  const step = size / segments;

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const eps = Math.max(0.65, step * 0.35);

  for (let iz = 0; iz < gridCols; iz++) {
    const wz = chunkZ - half + iz * step;
    for (let ix = 0; ix < gridCols; ix++) {
      const wx = chunkX - half + ix * step;
      const vIdx = iz * gridCols + ix;

      const wy = heightAt(wx, wz);
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;

      positions[vIdx * 3] = wx;
      positions[vIdx * 3 + 1] = wy;
      positions[vIdx * 3 + 2] = wz;

      // Central finite differences + micro detail normal contribution
      const hL = heightAt(wx - eps, wz) + heightFine(wx - eps, wz) * 0.35;
      const hR = heightAt(wx + eps, wz) + heightFine(wx + eps, wz) * 0.35;
      const hD = heightAt(wx, wz - eps) + heightFine(wx, wz - eps) * 0.35;
      const hU = heightAt(wx, wz + eps) + heightFine(wx, wz + eps) * 0.35;

      const nx = hL - hR;
      const ny = 2 * eps;
      const nz = hD - hU;
      const invLen = 1 / (Math.hypot(nx, ny, nz) || 1);
      const normX = nx * invLen;
      const normY = ny * invLen;
      const normZ = nz * invLen;

      normals[vIdx * 3] = normX;
      normals[vIdx * 3 + 1] = normY;
      normals[vIdx * 3 + 2] = normZ;

      // Cavity AO: compare vertex height against 4-neighbour mean at 3.5 m radius
      const cRad = 3.5;
      const avgNeighbour =
        0.25 *
        (heightAt(wx - cRad, wz) +
          heightAt(wx + cRad, wz) +
          heightAt(wx, wz - cRad) +
          heightAt(wx, wz + cRad));
      const diff = wy - avgNeighbour;
      const cav = Math.max(0.15, Math.min(1.0, 0.78 + diff * 0.12));
      cavity[vIdx] = cav;

      // Splat weights: vec4(grass, rockDark, rockPale, pathDirt) + vec2(ash, scree)
      const slopeRad = Math.acos(Math.max(-1, Math.min(1, normY)));
      const slopeDeg = (slopeRad * 180) / Math.PI;
      const reg = regionAt(wx, wz);

      // Rock above 35 degrees or altitude > 400 m
      const slopeRock = Math.max(0, Math.min(1, (slopeDeg - 28) / 14));
      const altRock = Math.max(0, Math.min(1, (wy - 365) / 65));
      const totalRock = Math.max(slopeRock, altRock);

      // Limestone pale bands on upper cliffs and summit
      const paleShare =
        reg === 'cliff' || wy > 235
          ? 0.45 + 0.35 * Math.sin(wy * 0.18 + wx * 0.02)
          : 0.2;
      const wRockPale = totalRock * Math.max(0, Math.min(1, paleShare));
      const wRockDark = totalRock * (1 - Math.max(0, Math.min(1, paleShare)));

      // Path/dirt weight (skip full pathInfluenceAt on coarse LOD2 outside path bounds)
      let wPath = 0;
      if (segments >= 32 || (wx > -300 && wx < 540 && wz > -580 && wz < 240)) {
        wPath = pathInfluenceAt(wx, wz).weight;
        const courtDist = Math.hypot(wx - 32, wz);
        if (courtDist < 38) {
          wPath = Math.max(wPath, 1 - Math.max(0, (courtDist - 26) / 12));
        }
      }

      const wGrass = Math.max(0, 1 - Math.max(totalRock, wPath));

      splat[vIdx * 4] = wGrass;
      splat[vIdx * 4 + 1] = wRockDark;
      splat[vIdx * 4 + 2] = wRockPale;
      splat[vIdx * 4 + 3] = wPath;

      const wAsh = reg === 'ashen' ? 1.0 : 0.0;
      const wScree =
        slopeDeg > 20 && slopeDeg < 38 ? Math.min(1, (slopeDeg - 20) / 16) * 0.65 : 0;
      extra[vIdx * 2] = wAsh;
      extra[vIdx * 2 + 1] = wScree;
    }
  }

  // Build 4 vertical skirts (6 m deep) along top (iz=0), bottom (iz=segments), left (ix=0), right (ix=segments)
  let skirtCursor = mainVertCount;
  const copyToSkirt = (srcIdx: number): number => {
    const dstIdx = skirtCursor++;
    positions[dstIdx * 3] = positions[srcIdx * 3];
    positions[dstIdx * 3 + 1] = positions[srcIdx * 3 + 1] - SKIRT_DEPTH;
    positions[dstIdx * 3 + 2] = positions[srcIdx * 3 + 2];

    normals[dstIdx * 3] = normals[srcIdx * 3];
    normals[dstIdx * 3 + 1] = normals[srcIdx * 3 + 1];
    normals[dstIdx * 3 + 2] = normals[srcIdx * 3 + 2];

    splat[dstIdx * 4] = splat[srcIdx * 4];
    splat[dstIdx * 4 + 1] = splat[srcIdx * 4 + 1];
    splat[dstIdx * 4 + 2] = splat[srcIdx * 4 + 2];
    splat[dstIdx * 4 + 3] = splat[srcIdx * 4 + 3];

    extra[dstIdx * 2] = extra[srcIdx * 2];
    extra[dstIdx * 2 + 1] = extra[srcIdx * 2 + 1];
    cavity[dstIdx] = cavity[srcIdx] * 0.85;
    return dstIdx;
  };

  const topSkirtStart = skirtCursor;
  for (let ix = 0; ix < gridCols; ix++) copyToSkirt(ix);

  const bottomSkirtStart = skirtCursor;
  for (let ix = 0; ix < gridCols; ix++) copyToSkirt(segments * gridCols + ix);

  const leftSkirtStart = skirtCursor;
  for (let iz = 0; iz < gridCols; iz++) copyToSkirt(iz * gridCols);

  const rightSkirtStart = skirtCursor;
  for (let iz = 0; iz < gridCols; iz++) copyToSkirt(iz * gridCols + segments);

  // Triangle indices: main grid + 4 skirt strips
  const mainQuadCount = segments * segments;
  const skirtQuadCount = 4 * segments;
  const indices = new Uint32Array((mainQuadCount + skirtQuadCount) * 6);
  let iPtr = 0;

  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = iz * gridCols + ix;
      const b = a + 1;
      const c = a + gridCols;
      const d = c + 1;

      indices[iPtr++] = a;
      indices[iPtr++] = c;
      indices[iPtr++] = b;
      indices[iPtr++] = b;
      indices[iPtr++] = c;
      indices[iPtr++] = d;
    }
  }

  // Top edge skirt (iz = 0)
  for (let ix = 0; ix < segments; ix++) {
    const a = ix;
    const b = ix + 1;
    const sa = topSkirtStart + ix;
    const sb = topSkirtStart + ix + 1;
    indices[iPtr++] = a;
    indices[iPtr++] = b;
    indices[iPtr++] = sa;
    indices[iPtr++] = b;
    indices[iPtr++] = sb;
    indices[iPtr++] = sa;
  }

  // Bottom edge skirt (iz = segments)
  for (let ix = 0; ix < segments; ix++) {
    const a = segments * gridCols + ix;
    const b = a + 1;
    const sa = bottomSkirtStart + ix;
    const sb = bottomSkirtStart + ix + 1;
    indices[iPtr++] = a;
    indices[iPtr++] = sa;
    indices[iPtr++] = b;
    indices[iPtr++] = b;
    indices[iPtr++] = sa;
    indices[iPtr++] = sb;
  }

  // Left edge skirt (ix = 0)
  for (let iz = 0; iz < segments; iz++) {
    const a = iz * gridCols;
    const b = (iz + 1) * gridCols;
    const sa = leftSkirtStart + iz;
    const sb = leftSkirtStart + iz + 1;
    indices[iPtr++] = a;
    indices[iPtr++] = sa;
    indices[iPtr++] = b;
    indices[iPtr++] = b;
    indices[iPtr++] = sa;
    indices[iPtr++] = sb;
  }

  // Right edge skirt (ix = segments)
  for (let iz = 0; iz < segments; iz++) {
    const a = iz * gridCols + segments;
    const b = (iz + 1) * gridCols + segments;
    const sa = rightSkirtStart + iz;
    const sb = rightSkirtStart + iz + 1;
    indices[iPtr++] = a;
    indices[iPtr++] = b;
    indices[iPtr++] = sa;
    indices[iPtr++] = b;
    indices[iPtr++] = sb;
    indices[iPtr++] = sa;
  }

  return {
    id,
    chunkX,
    chunkZ,
    segments,
    positions,
    normals,
    splat,
    extra,
    cavity,
    indices,
    minY: minY - SKIRT_DEPTH,
    maxY,
    dominantRegion: regionAt(chunkX, chunkZ),
  };
}

// Web Worker message listener
const isWorkerScope =
  typeof self !== 'undefined' &&
  typeof window === 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function';

if (isWorkerScope) {
  self.onmessage = (e: MessageEvent<TerrainChunkRequest>) => {
    const res = buildTerrainChunkData(e.data);
    (self as unknown as Worker).postMessage(res, [
      res.positions.buffer,
      res.normals.buffer,
      res.splat.buffer,
      res.extra.buffer,
      res.cavity.buffer,
      res.indices.buffer,
    ]);
  };
}
