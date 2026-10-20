import * as THREE from 'three';
import { WORLD } from '../../world/bible.ts';
import { heightAt, normalAt, surfaceAt, waterLevelAt } from '../../world/terrainFn.ts';
import { isHeadlessBrowser, QUALITY, type QualityTier } from '../Quality.ts';
import { PathField } from './PathField.ts';
import {
  buildTerrainChunkData,
  type TerrainChunkRequest,
  type TerrainChunkResult,
} from './terrain.worker.ts';
import { createTerrainMaterial } from './TerrainMaterial.ts';
import { createTerrainTextures, type TerrainTextureSet } from './TerrainTextures.ts';

export const CHUNK_SIZE = 128;

interface ActiveChunk {
  key: string;
  cx: number;
  cz: number;
  worldX: number;
  worldZ: number;
  lod: 0 | 1 | 2;
  segments: number;
  mesh: THREE.Mesh;
  boundingBox: THREE.Box3;
  triangles: number;
}

export interface TerrainStats {
  activeChunks: number;
  visibleChunks: number;
  visibleTriangles: number;
  pendingJobs: number;
}

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();

/**
 * Manages 128 m terrain chunk streaming, 3-level LOD with hysteresis (LOD0 = 128, LOD1 = 32, LOD2 = 8),
 * 6 m vertical skirts, frustum + distance culling, Web Worker generation with a 2-chunk-per-frame upload budget,
 * and heightfield raycasting (`terrain.raycast(origin, dir)`).
 */
export class TerrainManager {
  public readonly group = new THREE.Group();
  public readonly pathField: PathField;
  public readonly textures: TerrainTextureSet;
  public readonly material: THREE.MeshStandardMaterial;
  public readonly ready: Promise<void>;

  private tier: QualityTier;
  private readonly isHeadless: boolean;
  private worker: Worker | null = null;
  private readonly chunks = new Map<string, ActiveChunk>();
  private readonly inFlightKeys = new Set<string>();
  private readonly pendingQueue: Array<TerrainChunkRequest & { priorityDist: number }> = [];
  private readonly completedResults: TerrainChunkResult[] = [];
  private readyResolved = false;
  private resolveReady!: () => void;

  private lastStreamCheckPos = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private visibleChunkCount = 0;
  private visibleTriangleCount = 0;

  constructor(initialTier: QualityTier) {
    this.tier = initialTier;
    this.isHeadless = isHeadlessBrowser();
    this.group.name = 'ArkvoidTerrainChunks';

    this.pathField = new PathField(512, 360);
    this.textures = createTerrainTextures();
    this.material = createTerrainMaterial(this.textures, this.pathField.texture, initialTier);

    this.ready = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });

    this.initWorker();
  }

  private initWorker(): void {
    if (typeof Worker === 'undefined' || this.isHeadless) {
      return;
    }
    try {
      this.worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.onmessage = (e: MessageEvent<TerrainChunkResult>) => {
        this.inFlightKeys.delete(e.data.id);
        this.completedResults.push(e.data);
        this.dispatchNextWorkerJobs();
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  public heightAt(x: number, z: number): number {
    return heightAt(x, z);
  }

  public normalAt(x: number, z: number, out?: { x: number; y: number; z: number }) {
    return normalAt(x, z, out);
  }

  public surfaceAt(x: number, z: number) {
    return surfaceAt(x, z);
  }

  public waterLevelAt(x: number, z: number) {
    return waterLevelAt(x, z);
  }

  /**
   * Raycasts against the analytical terrain heightfield `heightAt(x, z)` from `origin` along `dir`.
   * Returns hit point and distance, or `null` if no hit within `maxDist`.
   */
  public raycast(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist = 600
  ): { point: THREE.Vector3; distance: number } | null {
    let t = 0.5;
    let step = 1.5;
    let prevDiff = origin.y + dir.y * t - heightAt(origin.x + dir.x * t, origin.z + dir.z * t);

    while (t <= maxDist) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      const h = heightAt(px, pz);
      const diff = py - h;

      if (diff <= 0) {
        // Binary-search refinement over the last step
        let lo = Math.max(0, t - step);
        let hi = t;
        for (let i = 0; i < 6; i++) {
          const mid = 0.5 * (lo + hi);
          const mx = origin.x + dir.x * mid;
          const my = origin.y + dir.y * mid;
          const mz = origin.z + dir.z * mid;
          if (my - heightAt(mx, mz) <= 0) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
        const hitT = 0.5 * (lo + hi);
        const hitPoint = new THREE.Vector3(
          origin.x + dir.x * hitT,
          heightAt(origin.x + dir.x * hitT, origin.z + dir.z * hitT),
          origin.z + dir.z * hitT
        );
        return { point: hitPoint, distance: hitT };
      }

      prevDiff = diff;
      step = Math.max(1.2, Math.min(16, Math.abs(prevDiff) * 0.45 + t * 0.02));
      t += step;
    }

    return null;
  }

  private desiredSegmentsForDistance(
    dist: number,
    currentSegments: number | null
  ): { lod: 0 | 1 | 2; segments: number } {
    const cfg = QUALITY[this.tier];
    const lod0R = this.isHeadless ? 160 : cfg.terrainLod0Radius;
    const lod1R = this.isHeadless ? 450 : 900;

    // 24 m hysteresis margin so chunks never flicker between LODs when the player walks near a boundary
    const hyst = 24;
    const lod0Threshold =
      currentSegments === 128 || currentSegments === 64 ? lod0R + hyst : lod0R - hyst;
    const lod1Threshold =
      currentSegments === 32 ? lod1R + hyst : lod1R - hyst;

    if (dist <= lod0Threshold) {
      // On low tier or headless software rasterizer, cap LOD0 to 32/64 segments to stay well within triangle budgets
      const segs = this.isHeadless ? 32 : this.tier === 'low' ? 64 : 128;
      return { lod: 0, segments: segs };
    }
    if (dist <= lod1Threshold) {
      return { lod: 1, segments: 32 };
    }
    return { lod: 2, segments: 8 };
  }

  public setQualityTier(tier: QualityTier): void {
    if (this.tier === tier) return;
    this.tier = tier;
    this.lastStreamCheckPos.set(Number.NaN, Number.NaN, Number.NaN);
  }

  public update(camera: THREE.PerspectiveCamera, playerPos: THREE.Vector3): void {
    const movedSq = playerPos.distanceToSquared(this.lastStreamCheckPos);
    if (Number.isNaN(movedSq) || movedSq > 36) {
      this.lastStreamCheckPos.copy(playerPos);
      this.reconcileChunkGrid(playerPos);
    }

    // Budget: build at most 2 completed chunks per frame on the main thread
    let builtThisFrame = 0;
    const maxBuilds = this.readyResolved ? 2 : 6;

    while (builtThisFrame < maxBuilds) {
      let result = this.completedResults.shift();
      if (!result && !this.worker && this.pendingQueue.length > 0) {
        const req = this.pendingQueue.shift()!;
        this.inFlightKeys.delete(req.id);
        result = buildTerrainChunkData(req);
      }
      if (!result) break;
      this.instantiateChunkMesh(result);
      builtThisFrame++;
    }

    if (!this.readyResolved && this.chunks.size >= 9) {
      this.readyResolved = true;
      this.resolveReady();
    }

    // Frustum & distance culling
    camera.updateMatrixWorld();
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    const cfg = QUALITY[this.tier];
    const maxDist = Math.min(cfg.viewDistance, 2200);
    const nearShadowRadiusSq = 180 * 180;

    let visChunks = 0;
    let visTris = 0;

    for (const chunk of this.chunks.values()) {
      const dx = chunk.worldX - playerPos.x;
      const dz = chunk.worldZ - playerPos.z;
      const distSq = dx * dx + dz * dz;
      const inRange = distSq <= maxDist * maxDist;
      const inFrustum = inRange && _frustum.intersectsBox(chunk.boundingBox);

      chunk.mesh.visible = inFrustum;
      if (inFrustum) {
        chunk.mesh.receiveShadow = distSq <= nearShadowRadiusSq;
        visChunks++;
        visTris += chunk.triangles;
      }
    }

    this.visibleChunkCount = visChunks;
    this.visibleTriangleCount = visTris;
  }

  private reconcileChunkGrid(playerPos: THREE.Vector3): void {
    const cfg = QUALITY[this.tier];
    const streamRadius = this.isHeadless
      ? 680
      : this.tier === 'low'
        ? 1150
        : Math.min(1650, cfg.viewDistance);

    const minCx = Math.max(
      Math.floor((WORLD.minX - 256) / CHUNK_SIZE),
      Math.floor((playerPos.x - streamRadius) / CHUNK_SIZE)
    );
    const maxCx = Math.min(
      Math.floor((WORLD.maxX + 256) / CHUNK_SIZE),
      Math.floor((playerPos.x + streamRadius) / CHUNK_SIZE)
    );
    const minCz = Math.max(
      Math.floor((WORLD.minZ - 256) / CHUNK_SIZE),
      Math.floor((playerPos.z - streamRadius) / CHUNK_SIZE)
    );
    const maxCz = Math.min(
      Math.floor((WORLD.maxZ + 256) / CHUNK_SIZE),
      Math.floor((playerPos.z + streamRadius) / CHUNK_SIZE)
    );

    const desiredKeys = new Set<string>();

    for (let cz = minCz; cz <= maxCz; cz++) {
      const worldZ = (cz + 0.5) * CHUNK_SIZE;
      for (let cx = minCx; cx <= maxCx; cx++) {
        const worldX = (cx + 0.5) * CHUNK_SIZE;
        const dist = Math.hypot(worldX - playerPos.x, worldZ - playerPos.z);
        if (dist > streamRadius) continue;

        const key = `${cx}:${cz}`;
        desiredKeys.add(key);

        const existing = this.chunks.get(key);
        const target = this.desiredSegmentsForDistance(
          dist,
          existing ? existing.segments : null
        );

        if (!existing || existing.segments !== target.segments) {
          const jobId = `${key}@${target.segments}`;
          if (!this.inFlightKeys.has(jobId)) {
            this.enqueueChunkBuild({
              id: jobId,
              chunkX: worldX,
              chunkZ: worldZ,
              size: CHUNK_SIZE,
              segments: target.segments,
              priorityDist: dist,
            });
          }
        }
      }
    }

    // Dispose chunks that left the streaming radius
    for (const [key, chunk] of this.chunks.entries()) {
      if (!desiredKeys.has(key)) {
        this.group.remove(chunk.mesh);
        chunk.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }

    // Sort pending queue so chunks closest to the player always build first
    this.pendingQueue.sort((a, b) => a.priorityDist - b.priorityDist);
    this.dispatchNextWorkerJobs();
  }

  private enqueueChunkBuild(
    job: TerrainChunkRequest & { priorityDist: number }
  ): void {
    const existingIdx = this.pendingQueue.findIndex((j) => j.id === job.id);
    if (existingIdx !== -1) {
      this.pendingQueue[existingIdx].priorityDist = job.priorityDist;
      return;
    }
    this.pendingQueue.push(job);
  }

  private dispatchNextWorkerJobs(): void {
    if (!this.worker) return;
    while (this.inFlightKeys.size < 4 && this.pendingQueue.length > 0) {
      const nextJob = this.pendingQueue.shift()!;
      this.inFlightKeys.add(nextJob.id);
      this.worker.postMessage({
        id: nextJob.id,
        chunkX: nextJob.chunkX,
        chunkZ: nextJob.chunkZ,
        size: nextJob.size,
        segments: nextJob.segments,
      } satisfies TerrainChunkRequest);
    }
  }

  private instantiateChunkMesh(data: TerrainChunkResult): void {
    const key = data.id.split('@')[0];
    const [cxStr, czStr] = key.split(':');
    const cx = Number(cxStr);
    const cz = Number(czStr);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(data.splat, 4));
    geo.setAttribute('aExtra', new THREE.BufferAttribute(data.extra, 2));
    geo.setAttribute('aCavity', new THREE.BufferAttribute(data.cavity, 1));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));

    const half = CHUNK_SIZE * 0.5;
    const box = new THREE.Box3(
      new THREE.Vector3(data.chunkX - half, data.minY, data.chunkZ - half),
      new THREE.Vector3(data.chunkX + half, data.maxY, data.chunkZ + half)
    );
    geo.boundingBox = box;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

    const prev = this.chunks.get(key);
    if (prev) {
      this.group.remove(prev.mesh);
      prev.mesh.geometry.dispose();
    }

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Enable Layer 2 so the far directional shadow camera includes all terrain chunks
    mesh.layers.enable(2);
    this.group.add(mesh);

    const lod: 0 | 1 | 2 = data.segments >= 64 ? 0 : data.segments === 32 ? 1 : 2;
    this.chunks.set(key, {
      key,
      cx,
      cz,
      worldX: data.chunkX,
      worldZ: data.chunkZ,
      lod,
      segments: data.segments,
      mesh,
      boundingBox: box,
      triangles: Math.floor(data.indices.length / 3),
    });
  }

  public get stats(): TerrainStats {
    return {
      activeChunks: this.chunks.size,
      visibleChunks: this.visibleChunkCount,
      visibleTriangles: this.visibleTriangleCount,
      pendingJobs: this.pendingQueue.length + this.inFlightKeys.size,
    };
  }

  public dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const chunk of this.chunks.values()) {
      this.group.remove(chunk.mesh);
      chunk.mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.material.dispose();
    this.textures.dispose();
    this.pathField.dispose();
  }
}
