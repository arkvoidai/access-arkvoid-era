import * as THREE from 'three';
import { hash2, valueNoise2D, WORLD_SEED } from '../../world/noise.ts';
import { isHeadlessBrowser } from '../Quality.ts';

export interface TerrainTextureSet {
  grassAlbedo: THREE.Texture;
  grassNormal: THREE.Texture;
  rockDarkAlbedo: THREE.Texture;
  rockDarkNormal: THREE.Texture;
  rockPaleAlbedo: THREE.Texture;
  rockPaleNormal: THREE.Texture;
  dirtAlbedo: THREE.Texture;
  dirtNormal: THREE.Texture;
  macroNoise: THREE.DataTexture;
  dispose: () => void;
}

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

function buildProceduralTilePair(
  size: number,
  colAHex: string,
  colBHex: string,
  colAccentHex: string,
  freq: number,
  bumpStrength: number,
  seedOffset: number
): { albedo: THREE.DataTexture; normal: THREE.DataTexture } {
  const albedoBytes = new Uint8Array(size * size * 4);
  const normalBytes = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);

  const [rA, gA, bA] = hexToRgb(colAHex);
  const [rB, gB, bB] = hexToRgb(colBHex);
  const [rC, gC, bC] = hexToRgb(colAccentHex);

  const seed = WORLD_SEED + seedOffset;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    // Tileable 2D domain coordinates using periodic wrapping
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const angleU = u * Math.PI * 2;
      const angleV = v * Math.PI * 2;
      const nx = Math.cos(angleU) * freq + Math.sin(angleV) * (freq * 0.5);
      const nz = Math.sin(angleU) * freq + Math.cos(angleV) * (freq * 0.5);

      const n1 = valueNoise2D(nx, nz, seed) * 0.5 + 0.5;
      const n2 = valueNoise2D(nx * 2.3 + 7.1, nz * 2.3 - 4.3, seed + 17) * 0.5 + 0.5;
      const grain = hash2(x, y, seed + 53);

      const h = n1 * 0.62 + n2 * 0.28 + grain * 0.1;
      const idx = y * size + x;
      heights[idx] = h;

      const t = Math.max(0, Math.min(1, h));
      const accentMask = Math.max(0, (grain - 0.82) / 0.18);

      let r = rA + (rB - rA) * t;
      let g = gA + (gB - gA) * t;
      let b = bA + (bB - bA) * t;

      r = r + (rC - r) * accentMask * 0.45;
      g = g + (gC - g) * accentMask * 0.45;
      b = b + (bC - b) * accentMask * 0.45;

      const p4 = idx * 4;
      albedoBytes[p4] = Math.min(255, Math.max(0, Math.round(r)));
      albedoBytes[p4 + 1] = Math.min(255, Math.max(0, Math.round(g)));
      albedoBytes[p4 + 2] = Math.min(255, Math.max(0, Math.round(b)));
      albedoBytes[p4 + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;

      const dX = (heights[y * size + xp] - heights[y * size + xm]) * bumpStrength;
      const dY = (heights[yp * size + x] - heights[ym * size + x]) * bumpStrength;
      const invLen = 1 / Math.hypot(dX, dY, 1);

      const nx = -dX * invLen * 0.5 + 0.5;
      const ny = -dY * invLen * 0.5 + 0.5;
      const nz = invLen * 0.5 + 0.5;

      const p4 = (y * size + x) * 4;
      normalBytes[p4] = Math.min(255, Math.max(0, Math.round(nx * 255)));
      normalBytes[p4 + 1] = Math.min(255, Math.max(0, Math.round(ny * 255)));
      normalBytes[p4 + 2] = Math.min(255, Math.max(0, Math.round(nz * 255)));
      normalBytes[p4 + 3] = 255;
    }
  }

  const albedo = new THREE.DataTexture(albedoBytes, size, size, THREE.RGBAFormat);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.magFilter = THREE.LinearFilter;
  albedo.generateMipmaps = true;
  albedo.needsUpdate = true;

  const normal = new THREE.DataTexture(normalBytes, size, size, THREE.RGBAFormat);
  normal.colorSpace = THREE.NoColorSpace;
  normal.wrapS = THREE.RepeatWrapping;
  normal.wrapT = THREE.RepeatWrapping;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.magFilter = THREE.LinearFilter;
  normal.generateMipmaps = true;
  normal.needsUpdate = true;

  return { albedo, normal };
}

function buildMacroNoiseTexture(size = 256): THREE.DataTexture {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const n1 =
        valueNoise2D(Math.cos(u) * 3.2, Math.sin(v) * 3.2, WORLD_SEED + 701) * 0.5 + 0.5;
      const n2 =
        valueNoise2D(Math.sin(u) * 6.4 + 3.1, Math.cos(v) * 6.4 - 2.7, WORLD_SEED + 709) *
          0.5 +
        0.5;
      const p4 = (y * size + x) * 4;
      bytes[p4] = Math.round(n1 * 255);
      bytes[p4 + 1] = Math.round(n2 * 255);
      bytes[p4 + 2] = Math.round((0.5 * n1 + 0.5 * n2) * 255);
      bytes[p4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Silently probes an optional texture in `/world/tex/...` and swaps it in if present.
 */
function probeOptionalTexOverride(
  url: string,
  srgb: boolean,
  onLoaded: (tex: THREE.Texture) => void
): void {
  if (typeof window === 'undefined' || typeof fetch === 'undefined' || isHeadlessBrowser()) {
    return;
  }
  fetch(url, { method: 'HEAD' })
    .then((res) => {
      const ct = res.headers.get('content-type') ?? '';
      if (res.ok && ct.startsWith('image/')) {
        const loader = new THREE.TextureLoader();
        loader.load(
          url,
          (tex) => {
            tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            onLoaded(tex);
          },
          undefined,
          () => {}
        );
      }
    })
    .catch(() => {});
}

/**
 * Generates all procedural Ink & Ember terrain layer textures at startup (512 px on desktop,
 * 128 px on headless CPU for instant startup) and silently probes optional overrides in `/world/tex/`.
 */
export function createTerrainTextures(
  onOverrideLoaded?: () => void
): TerrainTextureSet {
  const tileRes = isHeadlessBrowser() ? 128 : 512;

  // 1. Grass: #8E8A55 with #7B7A4A..#A39A63 and dry ivory tufts (#CFC6B4)
  const grass = buildProceduralTilePair(
    tileRes,
    '#7B7A4A',
    '#A39A63',
    '#CFC6B4',
    6.0,
    2.4,
    101
  );

  // 2. Dark Rock (warm ink): #3A322D with #2B2420..#4E443D
  const rockDark = buildProceduralTilePair(
    tileRes,
    '#2B2420',
    '#4B4039',
    '#6B5D53',
    5.0,
    3.6,
    202
  );

  // 3. Pale Rock (ivory limestone): #CFC6B4 with #B8AEA0..#DDD4C3
  const rockPale = buildProceduralTilePair(
    tileRes,
    '#B8AEA0',
    '#DDD4C3',
    '#EFE8DA',
    4.5,
    3.1,
    303
  );

  // 4. Dirt & Path: #9A7B5A with #826649..#B0906E
  const dirt = buildProceduralTilePair(
    tileRes,
    '#826649',
    '#B0906E',
    '#CFC6B4',
    5.5,
    2.8,
    404
  );

  const macroNoise = buildMacroNoiseTexture(128);

  const set: TerrainTextureSet = {
    grassAlbedo: grass.albedo,
    grassNormal: grass.normal,
    rockDarkAlbedo: rockDark.albedo,
    rockDarkNormal: rockDark.normal,
    rockPaleAlbedo: rockPale.albedo,
    rockPaleNormal: rockPale.normal,
    dirtAlbedo: dirt.albedo,
    dirtNormal: dirt.normal,
    macroNoise,
    dispose() {
      this.grassAlbedo.dispose();
      this.grassNormal.dispose();
      this.rockDarkAlbedo.dispose();
      this.rockDarkNormal.dispose();
      this.rockPaleAlbedo.dispose();
      this.rockPaleNormal.dispose();
      this.dirtAlbedo.dispose();
      this.dirtNormal.dispose();
      this.macroNoise.dispose();
    },
  };

  probeOptionalTexOverride('/world/tex/grass_albedo.jpg', true, (t) => {
    set.grassAlbedo.dispose();
    set.grassAlbedo = t;
    onOverrideLoaded?.();
  });
  probeOptionalTexOverride('/world/tex/grass_normal.jpg', false, (t) => {
    set.grassNormal.dispose();
    set.grassNormal = t;
    onOverrideLoaded?.();
  });
  probeOptionalTexOverride('/world/tex/rock_dark_albedo.jpg', true, (t) => {
    set.rockDarkAlbedo.dispose();
    set.rockDarkAlbedo = t;
    onOverrideLoaded?.();
  });
  probeOptionalTexOverride('/world/tex/rock_pale_albedo.jpg', true, (t) => {
    set.rockPaleAlbedo.dispose();
    set.rockPaleAlbedo = t;
    onOverrideLoaded?.();
  });
  probeOptionalTexOverride('/world/tex/dirt_albedo.jpg', true, (t) => {
    set.dirtAlbedo.dispose();
    set.dirtAlbedo = t;
    onOverrideLoaded?.();
  });

  return set;
}
