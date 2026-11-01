// Balance guard: ~40 careers on the real content with loose bounds (tight targets live in tools/simRunner.ts).
import { describe, expect, it } from 'vitest';
import { realContent } from './_content';
import { runMany, summary } from '../../tools/simRunner';

// Slow (~minutes): runs only with BALANCE=1 (npm run test:balance).
declare const process: { env: Record<string, string | undefined> };
describe.skipIf(!process.env.BALANCE)('balance (real content)', () => {
  it('40 careers land in sane ranges', async () => {
    const content = await realContent();
    if (!content) return;
    const { outs, agg } = runMany(content, 40, 1000, 24);
    const s = summary(outs);
    // match averages
    expect(agg.goals / agg.matches).toBeGreaterThan(2.4);
    expect(agg.goals / agg.matches).toBeLessThan(2.8);
    expect(agg.homeWins / agg.matches).toBeGreaterThan(0.41);
    expect(agg.homeWins / agg.matches).toBeLessThan(0.49);
    // careers
    expect(s.peakMedian).toBeGreaterThanOrEqual(63);
    expect(s.peakMedian).toBeLessThanOrEqual(77);
    expect(s.peakP10).toBeLessThan(s.peakMedian);
    expect(s.abroad).toBeGreaterThan(0.25);
    expect(s.abroad).toBeLessThan(0.75);
    expect(s.bigLeague).toBeLessThan(0.3);
    expect(s.capped).toBeGreaterThan(0.12);
    expect(s.capped).toBeLessThan(0.65);
    expect(s.clubsMedian).toBeGreaterThanOrEqual(2);
    expect(s.clubsMedian).toBeLessThanOrEqual(8);
    expect(s.retireMedian).toBeGreaterThanOrEqual(32);
    expect(s.retireMedian).toBeLessThanOrEqual(38);
    expect(s.stGoalsMedian).toBeGreaterThan(60);
    expect(s.stGoalsMedian).toBeLessThan(320);
  }, 900_000);
});
