// Seeded sfc32 RNG. The 4-word state lives in world.rngState so a save restores the exact stream.
// makeRng(state) mutates the given array in place.

export type RngState = [number, number, number, number];

export interface Rng {
  state: RngState;
  next(): number; // [0,1)
  int(min: number, max: number): number; // inclusive
  float(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  weightedPick<T>(items: readonly T[], weight: (t: T) => number): T | undefined;
  normal(mean?: number, sd?: number): number;
  shuffle<T>(arr: T[]): T[];
}

/** FNV-1a 32 bit string hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedState(seed: number): RngState {
  // splitmix32 to spread the seed
  let s = seed >>> 0;
  const sm = (): number => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st: RngState = [sm(), sm(), sm(), sm()];
  const r = makeRng(st);
  for (let i = 0; i < 15; i++) r.next(); // warm up
  return st;
}

export function makeRng(state: RngState): Rng {
  const next = (): number => {
    let a = state[0], b = state[1], c = state[2], d = state[3];
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    state[0] = a >>> 0; state[1] = b >>> 0; state[2] = c >>> 0; state[3] = d >>> 0;
    return (t >>> 0) / 4294967296;
  };
  const rng: Rng = {
    state,
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    weightedPick: <T>(items: readonly T[], weight: (t: T) => number): T | undefined => {
      let total = 0;
      for (const it of items) total += Math.max(0, weight(it));
      if (total <= 0) return undefined;
      let r = next() * total;
      for (const it of items) {
        r -= Math.max(0, weight(it));
        if (r < 0) return it;
      }
      return items[items.length - 1];
    },
    // no cached spare value: all state must live in `state` for save determinism
    normal: (mean = 0, sd = 1) => {
      let u = 0, v = 0, s = 0;
      do { u = next() * 2 - 1; v = next() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      const m = Math.sqrt((-2 * Math.log(s)) / s);
      return mean + sd * u * m;
    },
    shuffle: <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
  };
  return rng;
}

/** Poisson sample (Knuth), fine for small lambdas. */
export function poisson(rng: Rng, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng.next(); } while (p > L);
  return k - 1;
}
