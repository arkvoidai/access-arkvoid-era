export interface SeededRng {
  next: () => number;
  nextInt: (minInclusive: number, maxInclusive: number) => number;
  pick: <T>(items: readonly T[]) => T;
  getState: () => number;
}

/**
 * Deterministic Mulberry32 PRNG.
 * Same seed and same call sequence always produce identical values.
 */
export function createRng(seed: number): SeededRng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    if (maxInclusive <= minInclusive) return minInclusive;
    const r = next();
    return minInclusive + Math.floor(r * (maxInclusive - minInclusive + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('Cannot pick from an empty array');
    }
    return items[nextInt(0, items.length - 1)];
  };

  const getState = (): number => state;

  return { next, nextInt, pick, getState };
}
