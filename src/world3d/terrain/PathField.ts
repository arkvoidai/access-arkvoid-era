import * as THREE from 'three';
import { WORLD } from '../../world/bible.ts';
import { pathInfluenceAt } from '../../world/terrainFn.ts';

/**
 * Bakes a 2D path distance & cut-and-fill weight field across the playable `WORLD` rectangle
 * so terrain shaders and workers can sample path proximity in O(1) time.
 */
export class PathField {
  public readonly width: number;
  public readonly height: number;
  public readonly data: Uint8Array;
  public readonly texture: THREE.DataTexture;

  constructor(width = 512, height = 360) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);

    const spanX = WORLD.maxX - WORLD.minX;
    const spanZ = WORLD.maxZ - WORLD.minZ;

    for (let iz = 0; iz < height; iz++) {
      const z = WORLD.minZ + ((iz + 0.5) / height) * spanZ;
      const rowOffset = iz * width;
      for (let ix = 0; ix < width; ix++) {
        const x = WORLD.minX + ((ix + 0.5) / width) * spanX;
        // Include town courtyard/plazas in the path field
        const courtyardDist = Math.hypot(x - 32, z);
        let w = pathInfluenceAt(x, z).weight;
        if (courtyardDist < 38) {
          const cw = 1 - Math.max(0, (courtyardDist - 26) / 12);
          if (cw > w) w = cw;
        }
        this.data[rowOffset + ix] = Math.min(255, Math.max(0, Math.round(w * 255)));
      }
    }

    this.texture = new THREE.DataTexture(
      this.data as Uint8Array<ArrayBuffer>,
      width,
      height,
      THREE.RedFormat,
      THREE.UnsignedByteType
    );
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.unpackAlignment = 1;
    this.texture.needsUpdate = true;
  }

  /**
   * Samples the baked path field weight in `[0, 1]` at world coordinates `(x, z)`.
   */
  public sample(x: number, z: number): number {
    const u = (x - WORLD.minX) / (WORLD.maxX - WORLD.minX);
    const v = (z - WORLD.minZ) / (WORLD.maxZ - WORLD.minZ);
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const ix = Math.min(this.width - 1, Math.max(0, Math.floor(u * this.width)));
    const iz = Math.min(this.height - 1, Math.max(0, Math.floor(v * this.height)));
    return this.data[iz * this.width + ix] / 255;
  }

  public dispose(): void {
    this.texture.dispose();
  }
}
