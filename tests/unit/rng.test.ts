import { describe, expect, it } from 'vitest';
import { hashString, makeRng, poisson, seedState } from '../../src/core/rng';

describe('rng', () => {
  it('same seed gives same stream', () => {
    const a = makeRng(seedState(42)), b = makeRng(seedState(42));
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
  it('different seeds differ', () => {
    const a = makeRng(seedState(1)), b = makeRng(seedState(2));
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });
  it('state lives in the array: copy-and-resume reproduces the stream', () => {
    const st = seedState(7);
    const r = makeRng(st);
    for (let i = 0; i < 37; i++) r.normal();
    const saved = JSON.parse(JSON.stringify(st));
    const tail1 = Array.from({ length: 20 }, () => r.next());
    const r2 = makeRng(saved);
    const tail2 = Array.from({ length: 20 }, () => r2.next());
    expect(tail2).toEqual(tail1);
  });
  it('helpers stay in range', () => {
    const r = makeRng(seedState(3));
    for (let i = 0; i < 2000; i++) {
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
      const f = r.float(1, 2);
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThan(2);
    }
    expect(r.weightedPick([1, 2, 3], (x) => (x === 2 ? 1 : 0))).toBe(2);
    expect(r.weightedPick([1, 2], () => 0)).toBeUndefined();
    const arr = r.shuffle([1, 2, 3, 4, 5]);
    expect(arr.slice().sort()).toEqual([1, 2, 3, 4, 5]);
    let s = 0;
    for (let i = 0; i < 4000; i++) s += r.normal(10, 2);
    expect(s / 4000).toBeGreaterThan(9.8);
    expect(s / 4000).toBeLessThan(10.2);
    let p = 0;
    for (let i = 0; i < 4000; i++) p += poisson(r, 1.3);
    expect(p / 4000).toBeGreaterThan(1.2);
    expect(p / 4000).toBeLessThan(1.4);
  });
  it('hashString is stable', () => {
    expect(hashString('מכבי הכרמל')).toBe(hashString('מכבי הכרמל'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});
