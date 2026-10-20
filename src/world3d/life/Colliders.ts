/**
 * Spatial hash of circular (tree trunks, boulders, pillars) and axis-aligned/oriented box
 * (walls, gate piers) colliders with 16 m cells.
 * Zero per-frame heap allocations during collision queries.
 */

export interface CircleCollider {
  kind: 'circle';
  id: string;
  x: number;
  z: number;
  radius: number;
  tag?: string;
}

export interface BoxCollider {
  kind: 'box';
  id: string;
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  rotationY?: number;
  tag?: string;
}

export type WorldCollider = CircleCollider | BoxCollider;

const CELL_SIZE = 16;

function cellKey(ix: number, iz: number): number {
  // Pack signed 16-bit cell indices into a single 32-bit integer key
  return ((ix & 0xffff) << 16) | (iz & 0xffff);
}

export class ColliderGrid {
  private readonly cells = new Map<number, WorldCollider[]>();
  private readonly byOwner = new Map<string, { keys: number[]; colliders: WorldCollider[] }>();

  /**
   * Registers a batch of colliders under `ownerKey` (e.g. a chunk key `"cx:cz"` or `"landmarks"`)
   * so they can be cleanly removed when a chunk leaves the view radius.
   */
  public addBatch(ownerKey: string, colliders: readonly WorldCollider[]): void {
    this.removeBatch(ownerKey);
    const touchedKeys: number[] = [];
    const stored: WorldCollider[] = [];

    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      stored.push(c);
      let minX: number;
      let maxX: number;
      let minZ: number;
      let maxZ: number;

      if (c.kind === 'circle') {
        minX = c.x - c.radius;
        maxX = c.x + c.radius;
        minZ = c.z - c.radius;
        maxZ = c.z + c.radius;
      } else {
        const extent = Math.hypot(c.halfX, c.halfZ);
        minX = c.cx - extent;
        maxX = c.cx + extent;
        minZ = c.cz - extent;
        maxZ = c.cz + extent;
      }

      const ix0 = Math.floor(minX / CELL_SIZE);
      const ix1 = Math.floor(maxX / CELL_SIZE);
      const iz0 = Math.floor(minZ / CELL_SIZE);
      const iz1 = Math.floor(maxZ / CELL_SIZE);

      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const k = cellKey(ix, iz);
          let bucket = this.cells.get(k);
          if (!bucket) {
            bucket = [];
            this.cells.set(k, bucket);
          }
          bucket.push(c);
          touchedKeys.push(k);
        }
      }
    }

    this.byOwner.set(ownerKey, { keys: touchedKeys, colliders: stored });
  }

  public removeBatch(ownerKey: string): void {
    const rec = this.byOwner.get(ownerKey);
    if (!rec) return;
    const set = new Set(rec.colliders);
    for (let i = 0; i < rec.keys.length; i++) {
      const k = rec.keys[i];
      const bucket = this.cells.get(k);
      if (!bucket) continue;
      for (let j = bucket.length - 1; j >= 0; j--) {
        if (set.has(bucket[j])) {
          bucket.splice(j, 1);
        }
      }
      if (bucket.length === 0) {
        this.cells.delete(k);
      }
    }
    this.byOwner.delete(ownerKey);
  }

  /**
   * Resolves horizontal movement of a circle with `agentRadius` at `(x, z)` against all nearby
   * circle and box colliders, mutating `outPos` in place with zero heap allocation.
   */
  public resolveCircle(
    x: number,
    z: number,
    agentRadius: number,
    outPos: { x: number; z: number }
  ): boolean {
    outPos.x = x;
    outPos.z = z;
    let collided = false;

    const ix0 = Math.floor((x - agentRadius - 4) / CELL_SIZE);
    const ix1 = Math.floor((x + agentRadius + 4) / CELL_SIZE);
    const iz0 = Math.floor((z - agentRadius - 4) / CELL_SIZE);
    const iz1 = Math.floor((z + agentRadius + 4) / CELL_SIZE);

    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const bucket = this.cells.get(cellKey(ix, iz));
        if (!bucket) continue;

        for (let i = 0; i < bucket.length; i++) {
          const c = bucket[i];
          if (c.kind === 'circle') {
            const dx = outPos.x - c.x;
            const dz = outPos.z - c.z;
            const minDist = agentRadius + c.radius;
            const distSq = dx * dx + dz * dz;
            if (distSq < minDist * minDist && distSq > 1e-8) {
              const dist = Math.sqrt(distSq);
              const push = minDist - dist;
              outPos.x += (dx / dist) * push;
              outPos.z += (dz / dist) * push;
              collided = true;
            }
          } else {
            const rot = c.rotationY ?? 0;
            const cosR = Math.cos(-rot);
            const sinR = Math.sin(-rot);
            const relX = outPos.x - c.cx;
            const relZ = outPos.z - c.cz;
            const localX = relX * cosR - relZ * sinR;
            const localZ = relX * sinR + relZ * cosR;

            const clampedX = Math.max(-c.halfX, Math.min(c.halfX, localX));
            const clampedZ = Math.max(-c.halfZ, Math.min(c.halfZ, localZ));
            const diffX = localX - clampedX;
            const diffZ = localZ - clampedZ;
            const dSq = diffX * diffX + diffZ * diffZ;

            if (dSq < agentRadius * agentRadius && dSq > 1e-8) {
              const d = Math.sqrt(dSq);
              const push = agentRadius - d;
              const nxLocal = diffX / d;
              const nzLocal = diffZ / d;
              const cosInv = Math.cos(rot);
              const sinInv = Math.sin(rot);
              const nxWorld = nxLocal * cosInv - nzLocal * sinInv;
              const nzWorld = nxLocal * sinInv + nzLocal * cosInv;
              outPos.x += nxWorld * push;
              outPos.z += nzWorld * push;
              collided = true;
            }
          }
        }
      }
    }

    return collided;
  }

  public getColliderCount(): number {
    let total = 0;
    for (const rec of this.byOwner.values()) {
      total += rec.colliders.length;
    }
    return total;
  }

  public clear(): void {
    this.cells.clear();
    this.byOwner.clear();
  }
}
