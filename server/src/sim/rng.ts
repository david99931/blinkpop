/**
 * Deterministic PRNG: xmur3 string hash seeding mulberry32.
 * Same seed string → identical number stream, every run, every machine.
 */

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private next01: () => number;

  constructor(seed: string) {
    this.next01 = mulberry32(xmur3(seed)());
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.next01();
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next01() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next01() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!;
  }

  /** Skewed toward min (square of uniform) — good for "most tracks are small". */
  rangeLow(min: number, max: number): number {
    const u = this.next01();
    return min + u * u * (max - min);
  }
}
