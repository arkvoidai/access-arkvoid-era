import { get as idbGet, set as idbSet } from 'idb-keyval';
import * as THREE from 'three';
import { WORLD } from '../../world/bible.ts';
import type { QualityTier } from '../Quality.ts';
import { U } from '../uniforms.ts';

export const WEAR_STORAGE_KEY = 'arkvoid:v1:wear';

interface StoredWearPayload {
  version: 1;
  width: number;
  height: number;
  encoding: 'gzip-base64' | 'rle';
  payload: string | number[];
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === 'function' ? btoa(binary) : Buffer.from(bytes).toString('base64');
}

function base64ToUint8(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/**
 * Fast run-length encoding fallback for environments without `CompressionStream('gzip')`
 * or when storing sparse wear arrays synchronously.
 */
export function rleEncode(data: Uint8Array): number[] {
  const out: number[] = [];
  if (data.length === 0) return out;
  let prev = data[0];
  let count = 1;
  for (let i = 1; i < data.length; i++) {
    const v = data[i];
    if (v === prev && count < 65535) {
      count++;
    } else {
      out.push(prev, count);
      prev = v;
      count = 1;
    }
  }
  out.push(prev, count);
  return out;
}

export function rleDecode(encoded: readonly number[], targetLength: number): Uint8Array {
  const out = new Uint8Array(targetLength);
  let writeIdx = 0;
  for (let i = 0; i < encoded.length - 1 && writeIdx < targetLength; i += 2) {
    const val = encoded[i] & 0xff;
    const count = encoded[i + 1];
    const end = Math.min(targetLength, writeIdx + count);
    out.fill(val, writeIdx, end);
    writeIdx = end;
  }
  return out;
}

async function compressWearBytes(data: Uint8Array): Promise<StoredWearPayload['payload'] & { encoding: StoredWearPayload['encoding'] }> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(data as unknown as BufferSource);
      writer.close();
      const resp = new Response(cs.readable);
      const buf = await resp.arrayBuffer();
      const b64 = uint8ToBase64(new Uint8Array(buf));
      return Object.assign(b64, { encoding: 'gzip-base64' as const });
    } catch {
      // Fall back to RLE
    }
  }
  const rle = rleEncode(data);
  return Object.assign(rle, { encoding: 'rle' as const });
}

async function decompressWearBytes(
  stored: StoredWearPayload
): Promise<Uint8Array | null> {
  try {
    if (stored.encoding === 'gzip-base64' && typeof stored.payload === 'string' && typeof DecompressionStream !== 'undefined') {
      const compressed = base64ToUint8(stored.payload);
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(compressed as unknown as BufferSource);
      writer.close();
      const resp = new Response(ds.readable);
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf);
    }
    if (stored.encoding === 'rle' && Array.isArray(stored.payload)) {
      return rleDecode(stored.payload, stored.width * stored.height);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The Footpath Wear Map (`WearMap`):
 * - `R8` `DataTexture` covering `WORLD`: 4096 x 2880 on high/mid (~0.68 m/texel), 2048 x 1440 on low.
 * - Bound to `U.uWear.value`.
 * - Every 0.4 m the player walks, stamps a soft disc (radius ~0.9 m) adding ~0.08 up to 1.0.
 *   NPCs walking their routes add a tenth of that (0.008).
 * - Tracks a dirty rectangle on the CPU and uploads only the dirty sub-region once per second
 *   via `renderer.copyTextureToTexture` using a reusable small patch texture.
 * - Persists to `arkvoid:v1:wear` in IndexedDB every 20 seconds and on `pagehide`.
 */
export class WearMap {
  public readonly width: number;
  public readonly height: number;
  public readonly data: Uint8Array;
  public readonly texture: THREE.DataTexture;

  private dirtyMinX = Number.POSITIVE_INFINITY;
  private dirtyMinY = Number.POSITIVE_INFINITY;
  private dirtyMaxX = -1;
  private dirtyMaxY = -1;
  private needsFullUpload = false;
  private persistenceDirty = false;
  private totalStepsRecorded = 0;

  private lastGpuUploadTime = 0;
  private lastPersistTime = 0;
  private lastPlayerStampPos = new THREE.Vector2(Number.NaN, Number.NaN);
  private readonly dstPos = new THREE.Vector2();

  private boundPageHide: () => void;
  private boundVisibilityChange: () => void;

  constructor(tier: QualityTier = 'high') {
    const isLow = tier === 'low';
    this.width = isLow ? 2048 : 4096;
    this.height = isLow ? 1440 : 2880;
    this.data = new Uint8Array(this.width * this.height);

    this.texture = new THREE.DataTexture(
      this.data as Uint8Array<ArrayBuffer>,
      this.width,
      this.height,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;

    // Bind to shared uniform uWear
    U.uWear.value = this.texture;

    this.boundPageHide = () => {
      void this.saveToStorage();
    };
    this.boundVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        void this.saveToStorage();
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.boundPageHide);
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
      void this.loadFromStorage();
    }
  }

  private worldToTexel(x: number, z: number): [number, number] {
    const u = (x - WORLD.minX) / (WORLD.maxX - WORLD.minX);
    const v = (z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ);
    const tx = Math.floor(u * this.width);
    const ty = Math.floor(v * this.height);
    return [tx, ty];
  }

  /**
   * Stamps a soft circular footprint at world `(x, z)` with `radiusMeters` (~0.9 m)
   * and `strength01` (`0.08` for player, `0.008` for NPCs).
   */
  public stampDisc(x: number, z: number, radiusMeters = 0.9, strength01 = 0.08): void {
    const [cx, cy] = this.worldToTexel(x, z);
    if (cx < 0 || cx >= this.width || cy < 0 || cy >= this.height) return;

    const metersPerTexelX = (WORLD.maxX - WORLD.minX) / this.width;
    const metersPerTexelZ = (WORLD.maxZ - WORLD.minZ) / this.height;
    const rx = Math.max(1, Math.ceil(radiusMeters / metersPerTexelX));
    const ry = Math.max(1, Math.ceil(radiusMeters / metersPerTexelZ));

    const x0 = Math.max(0, cx - rx);
    const x1 = Math.min(this.width - 1, cx + rx);
    const y0 = Math.max(0, cy - ry);
    const y1 = Math.min(this.height - 1, cy + ry);

    const maxDelta = strength01 * 255;

    for (let ty = y0; ty <= y1; ty++) {
      const dy = (ty - cy) / ry;
      const rowOffset = ty * this.width;
      for (let tx = x0; tx <= x1; tx++) {
        const dx = (tx - cx) / rx;
        const distSq = dx * dx + dy * dy;
        if (distSq >= 1) continue;
        const falloff = (1 - distSq) * (1 - distSq);
        const add = Math.max(1, Math.round(maxDelta * falloff));
        const idx = rowOffset + tx;
        const nextVal = Math.min(255, this.data[idx] + add);
        if (nextVal !== this.data[idx]) {
          this.data[idx] = nextVal;
        }
      }
    }

    if (x0 < this.dirtyMinX) this.dirtyMinX = x0;
    if (y0 < this.dirtyMinY) this.dirtyMinY = y0;
    if (x1 > this.dirtyMaxX) this.dirtyMaxX = x1;
    if (y1 > this.dirtyMaxY) this.dirtyMaxY = y1;
    this.persistenceDirty = true;
    this.totalStepsRecorded++;
  }

  /**
   * Records player movement: every 0.4 m the player walks on the ground, stamps a soft disc
   * (radius 0.9 m, adding 0.08 up to 1.0).
   */
  public recordPlayerPosition(x: number, z: number, isGrounded = true): void {
    if (!isGrounded) return;
    if (Number.isNaN(this.lastPlayerStampPos.x)) {
      this.lastPlayerStampPos.set(x, z);
      this.stampDisc(x, z, 0.9, 0.08);
      return;
    }

    const dx = x - this.lastPlayerStampPos.x;
    const dz = z - this.lastPlayerStampPos.y;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) return;

    // If the player teleported (> 18 m in a single step), reset anchor without drawing a line across the map
    if (dist > 18) {
      this.lastPlayerStampPos.set(x, z);
      this.stampDisc(x, z, 0.9, 0.08);
      return;
    }

    const steps = Math.min(24, Math.floor(dist / 0.4));
    const ux = dx / dist;
    const uz = dz / dist;
    for (let s = 1; s <= steps; s++) {
      const sx = this.lastPlayerStampPos.x + ux * (s * 0.4);
      const sz = this.lastPlayerStampPos.y + uz * (s * 0.4);
      this.stampDisc(sx, sz, 0.9, 0.08);
    }
    this.lastPlayerStampPos.x += ux * (steps * 0.4);
    this.lastPlayerStampPos.y += uz * (steps * 0.4);
  }

  /**
   * Records an NPC step along their routine route (1/10th strength of player: 0.008).
   */
  public recordNpcStep(x: number, z: number): void {
    this.stampDisc(x, z, 0.85, 0.008);
  }

  /**
   * Samples the current wear value in `[0, 1]` at world coordinates `(x, z)`.
   */
  public sample(x: number, z: number): number {
    const [tx, ty] = this.worldToTexel(x, z);
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) return 0;
    return this.data[ty * this.width + tx] / 255;
  }

  public getTotalStepsRecorded(): number {
    return this.totalStepsRecorded;
  }

  /**
   * Once per second, uploads only the dirty rectangle to the GPU via `renderer.copyTextureToTexture`
   * using a small patch texture, and persists to IndexedDB every 20 seconds.
   */
  public update(renderer: THREE.WebGLRenderer, realSeconds: number): void {
    if (this.needsFullUpload) {
      this.texture.needsUpdate = true;
      this.needsFullUpload = false;
      this.dirtyMinX = Number.POSITIVE_INFINITY;
      this.dirtyMinY = Number.POSITIVE_INFINITY;
      this.dirtyMaxX = -1;
      this.dirtyMaxY = -1;
      this.lastGpuUploadTime = realSeconds;
    } else if (
      this.dirtyMaxX >= this.dirtyMinX &&
      this.dirtyMaxY >= this.dirtyMinY &&
      realSeconds - this.lastGpuUploadTime >= 1.0
    ) {
      this.lastGpuUploadTime = realSeconds;
      const patchW = this.dirtyMaxX - this.dirtyMinX + 1;
      const patchH = this.dirtyMaxY - this.dirtyMinY + 1;

      if (patchW * patchH > this.width * this.height * 0.25) {
        this.texture.needsUpdate = true;
      } else {
        const patchBytes = new Uint8Array(patchW * patchH);
        for (let row = 0; row < patchH; row++) {
          const srcStart = (this.dirtyMinY + row) * this.width + this.dirtyMinX;
          patchBytes.set(this.data.subarray(srcStart, srcStart + patchW), row * patchW);
        }
        const patchTex = new THREE.DataTexture(
          patchBytes as Uint8Array<ArrayBuffer>,
          patchW,
          patchH,
          THREE.RedFormat,
          THREE.UnsignedByteType
        );
        patchTex.unpackAlignment = 1;
        patchTex.needsUpdate = true;
        this.dstPos.set(this.dirtyMinX, this.dirtyMinY);
        try {
          renderer.copyTextureToTexture(patchTex, this.texture, null, this.dstPos, 0);
        } catch {
          this.texture.needsUpdate = true;
        }
        patchTex.dispose();
      }

      this.dirtyMinX = Number.POSITIVE_INFINITY;
      this.dirtyMinY = Number.POSITIVE_INFINITY;
      this.dirtyMaxX = -1;
      this.dirtyMaxY = -1;
    }

    if (this.persistenceDirty && realSeconds - this.lastPersistTime >= 20.0) {
      this.lastPersistTime = realSeconds;
      void this.saveToStorage();
    }
  }

  public async saveToStorage(): Promise<void> {
    if (!this.persistenceDirty) return;
    this.persistenceDirty = false;

    const rle = rleEncode(this.data);
    const stored: StoredWearPayload = {
      version: 1,
      width: this.width,
      height: this.height,
      encoding: 'rle',
      payload: rle,
    };

    // Save fast RLE snapshot immediately so synchronous reloads never miss recent footsteps
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(WEAR_STORAGE_KEY, JSON.stringify(stored));
      }
    } catch {
      // Ignore quota errors
    }

    try {
      const compressed = await compressWearBytes(this.data);
      const idbPayload: StoredWearPayload = {
        version: 1,
        width: this.width,
        height: this.height,
        encoding: compressed.encoding,
        payload: compressed.encoding === 'gzip-base64' ? String(compressed) : (compressed as unknown as number[]),
      };
      if (typeof indexedDB !== 'undefined') {
        await idbSet(WEAR_STORAGE_KEY, idbPayload);
      }
    } catch {
      // Fallback already written
    }
  }

  public async loadFromStorage(): Promise<boolean> {
    let stored: StoredWearPayload | null = null;
    try {
      if (typeof indexedDB !== 'undefined') {
        const idbVal = await idbGet<StoredWearPayload>(WEAR_STORAGE_KEY);
        if (idbVal && idbVal.version === 1) {
          stored = idbVal;
        }
      }
    } catch {
      // Fall through to localStorage
    }

    if (!stored && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(WEAR_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as StoredWearPayload;
          if (parsed && parsed.version === 1) {
            stored = parsed;
          }
        }
      } catch {
        // Ignore
      }
    }

    if (!stored) return false;
    const decoded = await decompressWearBytes(stored);
    if (!decoded) return false;

    if (stored.width === this.width && stored.height === this.height) {
      this.data.set(decoded.subarray(0, this.data.length));
    } else {
      // Resample if loaded across different quality tiers (2048x1440 <-> 4096x2880)
      for (let ty = 0; ty < this.height; ty++) {
        const sy = Math.min(stored.height - 1, Math.floor((ty / this.height) * stored.height));
        const dstRow = ty * this.width;
        const srcRow = sy * stored.width;
        for (let tx = 0; tx < this.width; tx++) {
          const sx = Math.min(stored.width - 1, Math.floor((tx / this.width) * stored.width));
          this.data[dstRow + tx] = decoded[srcRow + sx];
        }
      }
    }

    this.needsFullUpload = true;
    return true;
  }

  public clear(): void {
    this.data.fill(0);
    this.totalStepsRecorded = 0;
    this.lastPlayerStampPos.set(Number.NaN, Number.NaN);
    this.needsFullUpload = true;
    this.persistenceDirty = false;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(WEAR_STORAGE_KEY);
      }
      if (typeof indexedDB !== 'undefined') {
        void idbSet(WEAR_STORAGE_KEY, null);
      }
    } catch {
      // Ignore
    }
  }

  public dispose(): void {
    void this.saveToStorage();
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.boundPageHide);
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
    this.texture.dispose();
  }
}

let activeWearInstance: WearMap | null = null;

export function getActiveWearMap(): WearMap | null {
  return activeWearInstance;
}

export function setActiveWearMap(instance: WearMap | null): void {
  activeWearInstance = instance;
}

export async function clearPersistedWearMap(): Promise<void> {
  if (activeWearInstance) {
    activeWearInstance.clear();
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(WEAR_STORAGE_KEY);
    }
    if (typeof indexedDB !== 'undefined') {
      await idbSet(WEAR_STORAGE_KEY, null);
    }
  } catch {
    // Ignore
  }
}
