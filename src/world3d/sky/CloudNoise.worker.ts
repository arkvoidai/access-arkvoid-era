/**
 * Tileable 3D Perlin-Worley cloud noise generator.
 * Runs inside a Web Worker (`new Worker(new URL('./CloudNoise.worker.ts', import.meta.url), { type: 'module' })`)
 * to build the 96x96x96 3D volume off the main thread, and also exports `generateCloudVolumeBytes`
 * for an instant 16x16x16 seed texture on frame 0.
 */

function modPeriod(n: number, p: number): number {
  return ((n % p) + p) % p;
}

function hash3Tile(ix: number, iy: number, iz: number, period: number, seed: number): number {
  const x = modPeriod(ix, period);
  const y = modPeriod(iy, period);
  const z = modPeriod(iz, period);
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1664525) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function tileableValueNoise3D(
  x: number,
  y: number,
  z: number,
  period: number,
  seed: number
): number {
  const px = x * period;
  const py = y * period;
  const pz = z * period;

  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);

  const fx = px - ix;
  const fy = py - iy;
  const fz = pz - iz;

  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const n000 = hash3Tile(ix, iy, iz, period, seed);
  const n100 = hash3Tile(ix + 1, iy, iz, period, seed);
  const n010 = hash3Tile(ix, iy + 1, iz, period, seed);
  const n110 = hash3Tile(ix + 1, iy + 1, iz, period, seed);
  const n001 = hash3Tile(ix, iy, iz + 1, period, seed);
  const n101 = hash3Tile(ix + 1, iy, iz + 1, period, seed);
  const n011 = hash3Tile(ix, iy + 1, iz + 1, period, seed);
  const n111 = hash3Tile(ix + 1, iy + 1, iz + 1, period, seed);

  const nx00 = n000 + (n100 - n000) * ux;
  const nx10 = n010 + (n110 - n010) * ux;
  const nx01 = n001 + (n101 - n001) * ux;
  const nx11 = n011 + (n111 - n011) * ux;

  const nxy0 = nx00 + (nx10 - nx00) * uy;
  const nxy1 = nx01 + (nx11 - nx01) * uy;

  return nxy0 + (nxy1 - nxy0) * uz;
}

function tileableWorley3D(
  x: number,
  y: number,
  z: number,
  cells: number,
  seed: number
): number {
  const px = x * cells;
  const py = y * cells;
  const pz = z * cells;

  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);

  let minDistSq = 99.0;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        const cz = iz + dz;

        const rx = cx + hash3Tile(cx, cy, cz, cells, seed + 11);
        const ry = cy + hash3Tile(cx, cy, cz, cells, seed + 37);
        const rz = cz + hash3Tile(cx, cy, cz, cells, seed + 73);

        const ddx = rx - px;
        const ddy = ry - py;
        const ddz = rz - pz;
        const dSq = ddx * ddx + ddy * ddy + ddz * ddz;
        if (dSq < minDistSq) {
          minDistSq = dSq;
        }
      }
    }
  }

  return Math.max(0, 1 - Math.sqrt(minDistSq));
}

export function generateCloudVolumeBytes(size: number): Uint8Array {
  const total = size * size * size;
  const data = new Uint8Array(total);
  const inv = 1 / size;

  let ptr = 0;
  for (let z = 0; z < size; z++) {
    const fz = z * inv;
    for (let y = 0; y < size; y++) {
      const fy = y * inv;
      for (let x = 0; x < size; x++) {
        const fx = x * inv;

        // Perlin FBM base
        const p1 = tileableValueNoise3D(fx, fy, fz, 4, 101);
        const p2 = tileableValueNoise3D(fx, fy, fz, 8, 202);
        const p3 = tileableValueNoise3D(fx, fy, fz, 16, 303);
        const perlinFbm = p1 * 0.55 + p2 * 0.30 + p3 * 0.15;

        // Worley billow cells
        const w1 = tileableWorley3D(fx, fy, fz, 4, 404);
        const w2 = tileableWorley3D(fx, fy, fz, 8, 505);
        const worleyFbm = w1 * 0.65 + w2 * 0.35;

        // Soft Perlin-Worley remap for cumulus tops & wispy edges
        const blended = perlinFbm * 0.58 + worleyFbm * 0.42;
        data[ptr++] = Math.max(0, Math.min(255, Math.round(blended * 255)));
      }
    }
  }

  return data;
}

// Web Worker message handler
if (
  typeof self !== 'undefined' &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === 'function' &&
  typeof document === 'undefined'
) {
  self.onmessage = (e: MessageEvent<{ size?: number }>) => {
    const size = e.data?.size ?? 96;
    const bytes = generateCloudVolumeBytes(size);
    (self as unknown as Worker).postMessage(
      { size, buffer: bytes.buffer },
      [bytes.buffer]
    );
  };
}
