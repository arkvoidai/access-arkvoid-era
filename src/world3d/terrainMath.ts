import * as THREE from 'three';
import {
  heightAt,
  normalAt,
  pathInfluenceAt,
  regionAt,
  slopeAt,
  surfaceAt,
  waterLevelAt,
} from '../world/terrainFn.ts';

export { heightAt, normalAt, pathInfluenceAt, regionAt, slopeAt, surfaceAt, waterLevelAt };

/**
 * Backwards-compatible alias for `heightAt(x, z)`.
 */
export function groundHeightAt(x: number, z: number): number {
  return heightAt(x, z);
}

/**
 * Backwards-compatible Three.Vector3 normal helper wrapping `normalAt(x, z)`.
 */
export function groundNormalAt(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  const n = normalAt(x, z);
  return target.set(n.x, n.y, n.z);
}

/**
 * Returns 0..1 proximity to any carved stone road or town courtyard.
 */
export function roadMaskAt(x: number, z: number): number {
  const courtyardDist = Math.hypot(x - 36, z);
  if (courtyardDist < 36) {
    return 1 - Math.max(0, (courtyardDist - 26) / 10);
  }
  return pathInfluenceAt(x, z).weight;
}
