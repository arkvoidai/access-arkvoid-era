import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { KitPart } from './Kit.ts';
import type { ArchMaterialId } from './Materials.ts';
import { getArchMaterials } from './Materials.ts';

export interface MergeStats {
  chunkCount: number;
  drawCalls: number;
  triangles: number;
}

/**
 * Merges static architectural `KitPart` arrays by material into at most 4 spatial quadrants
 * per place (`Merge.ts` — Prompt 5 Section 2) so a whole 45-building town costs ~25–35 draw calls
 * while preserving frustum culling per quadrant.
 */
export function mergePlaceSpatialChunks(
  parts: ReadonlyArray<KitPart>,
  centerX: number,
  centerZ: number,
  placeId: string,
  maxSpatialChunks: 1 | 2 | 4 = 4
): { group: THREE.Group; stats: MergeStats } {
  const root = new THREE.Group();
  root.name = `place-merged:${placeId}`;

  const mats = getArchMaterials();
  const buckets = new Map<string, { matId: ArchMaterialId; quadrant: number; geos: THREE.BufferGeometry[] }>();

  for (const part of parts) {
    const pos = new THREE.Vector3().setFromMatrixPosition(part.matrix);
    let quadrant = 0;
    if (maxSpatialChunks === 4) {
      const qx = pos.x >= centerX ? 1 : 0;
      const qz = pos.z >= centerZ ? 2 : 0;
      quadrant = qx + qz;
    } else if (maxSpatialChunks === 2) {
      quadrant = pos.x >= centerX ? 1 : 0;
    }

    const key = `${quadrant}:${part.materialId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { matId: part.materialId, quadrant, geos: [] };
      buckets.set(key, bucket);
    }

    const g = part.geometry.clone();
    g.applyMatrix4(part.matrix);
    const nonIndexed = g.index ? g.toNonIndexed() : g;
    if (!nonIndexed.getAttribute('uv')) {
      const vCount = nonIndexed.getAttribute('position').count;
      nonIndexed.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vCount * 2), 2));
    }
    bucket.geos.push(nonIndexed);
    if (nonIndexed !== g) g.dispose();
  }

  let drawCalls = 0;
  let triangles = 0;
  const activeQuadrants = new Set<number>();

  for (const bucket of buckets.values()) {
    if (bucket.geos.length === 0) continue;
    const merged = mergeGeometries(bucket.geos, false);
    for (const g of bucket.geos) g.dispose();
    if (!merged) continue;

    merged.computeBoundingSphere();
    const posAttr = merged.getAttribute('position');
    triangles += Math.floor(posAttr.count / 3);
    drawCalls++;
    activeQuadrants.add(bucket.quadrant);

    const mesh = new THREE.Mesh(merged, mats.get(bucket.matId));
    mesh.name = `${placeId}:q${bucket.quadrant}:${bucket.matId}`;
    mesh.castShadow = bucket.matId !== 'paperWindow' && bucket.matId !== 'lava';
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  return {
    group: root,
    stats: {
      chunkCount: activeQuadrants.size,
      drawCalls,
      triangles,
    },
  };
}
