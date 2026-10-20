/**
 * Deterministic seeded noise library for Arkvoid.
 * Uses WORLD_SEED = 0xA4C01D. Zero Math.random() calls anywhere.
 * Runs identically on the main thread, Web Workers, and Node unit tests.
 */

export const WORLD_SEED = 0xa4c01d;

/**
 * Fast 32-bit integer hash for 2D grid coordinates + seed, returning [0, 1].
 */
export function hash2(ix: number, iz: number, seed: number = WORLD_SEED): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

/**
 * Fast 32-bit integer hash for 3D grid coordinates + seed, returning [0, 1].
 */
export function hash3(ix: number, iy: number, iz: number, seed: number = WORLD_SEED): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

/**
 * Deterministic 1D index hash returning [0, 1] for Poisson-disc and procedural placement.
 */
export function seededUnit(index: number, seed: number = WORLD_SEED): number {
  let h = (index * 747796405 + seed * 2891336453 + 1013904223) | 0;
  h = Math.imul((h >>> ((h >>> 28) + 4)) ^ h, 277803737);
  h = h ^ (h >>> 22);
  return (h >>> 0) / 4294967295;
}

/**
 * Smooth 2D value noise returning [-1, 1].
 */
export function valueNoise2D(x: number, z: number, seed: number = WORLD_SEED): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);

  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);

  const v = a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
  return v * 2 - 1;
}

const GRAD2: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.70710678, 0.70710678],
  [-0.70710678, 0.70710678],
  [0.70710678, -0.70710678],
  [-0.70710678, -0.70710678],
];

function gradDot2(ix: number, iz: number, dx: number, dz: number, seed: number): number {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  const g = GRAD2[(h >>> 24) & 7];
  return g[0] * dx + g[1] * dz;
}

/**
 * Quintic-interpolated 2D Perlin gradient noise returning [-1, 1].
 */
export function gradientNoise2D(x: number, z: number, seed: number = WORLD_SEED): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);

  const n00 = gradDot2(ix, iz, fx, fz, seed);
  const n10 = gradDot2(ix + 1, iz, fx - 1, fz, seed);
  const n01 = gradDot2(ix, iz + 1, fx, fz - 1, seed);
  const n11 = gradDot2(ix + 1, iz + 1, fx - 1, fz - 1, seed);

  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return (nx0 + (nx1 - nx0) * uz) * 1.4142;
}

/**
 * Single-octave 2D ridged noise returning [0, 1] with sharp mountain crests.
 */
export function ridgedNoise2D(x: number, z: number, seed: number = WORLD_SEED): number {
  const n = 1 - Math.abs(gradientNoise2D(x, z, seed));
  return n * n;
}

/**
 * Multi-octave fractional Brownian motion (fBm) returning roughly [-1, 1].
 */
export function fbm2D(
  x: number,
  z: number,
  octaves = 4,
  seed: number = WORLD_SEED
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * gradientNoise2D(x * freq, z * freq, seed + i * 101);
    freq *= 2.03;
    amp *= 0.49;
  }
  return sum;
}

/**
 * Multi-octave ridged multifractal noise returning [0, 1].
 */
export function ridgedFbm2D(
  x: number,
  z: number,
  octaves = 4,
  seed: number = WORLD_SEED
): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let signal = 1 - Math.abs(gradientNoise2D(x * freq, z * freq, seed + i * 197));
    signal = signal * signal * weight;
    weight = Math.min(1, Math.max(0, signal * 1.8));
    sum += signal * amp;
    freq *= 2.07;
    amp *= 0.5;
  }
  return sum;
}

/**
 * Domain-warps 2D coordinates `(x, z)` so valleys and mountain ridges curve organically.
 */
export function domainWarp2D(
  x: number,
  z: number,
  strength: number,
  freq: number,
  seed: number = WORLD_SEED
): [number, number] {
  const wx = fbm2D(x * freq, z * freq, 3, seed + 31);
  const wz = fbm2D(x * freq + 19.7, z * freq - 11.3, 3, seed + 67);
  return [x + wx * strength, z + wz * strength];
}
