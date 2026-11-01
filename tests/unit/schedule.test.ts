import { describe, expect, it } from 'vitest';
import { fixtureContent } from './_content';
import { newGame } from '../../src/core/game';
import { makeRng, seedState } from '../../src/core/rng';
import { applyResult, doubleRoundRobin, emptyRow, legsFor, promoteRelegate, SEASON_EXTRA_WEEKS, sortedTable } from '../../src/core/schedule';
import { simFixture } from '../../src/core/matchSim';

const content = fixtureContent();

describe('schedule', () => {
  for (const n of [8, 9, 10, 20]) {
    it(`double round robin with ${n} clubs: every ordered pair exactly once`, () => {
      const ids = Array.from({ length: n }, (_, i) => i + 100);
      const rounds = doubleRoundRobin(ids, makeRng(seedState(n)));
      expect(rounds.length).toBe(n % 2 ? n * 2 : (n - 1) * 2);
      const seen = new Map<string, number>();
      for (const round of rounds) {
        const inRound = new Set<number>();
        for (const [h, a] of round) {
          expect(h).not.toBe(a);
          expect(inRound.has(h) || inRound.has(a)).toBe(false);
          inRound.add(h); inRound.add(a);
          seen.set(`${h}-${a}`, (seen.get(`${h}-${a}`) ?? 0) + 1);
        }
      }
      for (const h of ids) for (const a of ids) if (h !== a) expect(seen.get(`${h}-${a}`), `${h}-${a}`).toBe(1);
    });
  }

  it('season fixtures: each pair meets twice (home and away), small leagues 3-4 times', () => {
    const w = newGame({ type: 'newCareer', seed: 3, pos: 'ST', firstName: 'א', lastName: 'ב' }, content);
    for (const lg of w.leagues) {
      const fx = w.season.fixtures[lg.id];
      const n = lg.clubIds.length;
      const legs = legsFor(n);
      expect(fx.length).toBe((n * (n - 1) * legs) / 2);
      for (const a of lg.clubIds) for (const b of lg.clubIds) if (a !== b) {
        const ab = fx.filter((f) => f.home === a && f.away === b).length, ba = fx.filter((f) => f.home === b && f.away === a).length;
        expect(ab + ba).toBe(legs);
        expect(ab).toBeGreaterThanOrEqual(1);
        expect(ba).toBeGreaterThanOrEqual(1);
      }
    }
    // season length = the user's league rounds + break weeks; every league fits inside it
    const ul = w.leagues[w.clubs[(w.people[w.career.playerId] as { clubId: number }).clubId].leagueId];
    expect(w.season.totalWeeks).toBe(((ul.clubIds.length - (ul.clubIds.length % 2 ? 0 : 1)) * legsFor(ul.clubIds.length)) + SEASON_EXTRA_WEEKS);
    for (const lg of w.leagues) for (const f of w.season.fixtures[lg.id]) expect(f.week).toBeLessThan(w.season.totalWeeks);
    // the user's league never plays twice in a week, and has no long run of empty weeks at the end
    const weeks = w.season.fixtures[ul.id].map((f) => f.week);
    for (const c of ul.clubIds) {
      const mine = w.season.fixtures[ul.id].filter((f) => f.home === c || f.away === c).map((f) => f.week);
      expect(new Set(mine).size).toBe(mine.length);
    }
    expect(w.season.totalWeeks - 1 - Math.max(...weeks)).toBeLessThanOrEqual(2);
  });

  it('table tiebreaks: points, goal difference, goals for', () => {
    const rows = [emptyRow(1), emptyRow(2), emptyRow(3)];
    rows[0].pts = 10; rows[0].gf = 10; rows[0].ga = 5;
    rows[1].pts = 10; rows[1].gf = 12; rows[1].ga = 7;
    rows[2].pts = 10; rows[2].gf = 8; rows[2].ga = 2;
    expect(sortedTable(rows).map((r) => r.clubId)).toEqual([3, 2, 1]);
  });

  it('results update tables and promotion/relegation swaps clubs between linked leagues', () => {
    const w = newGame({ type: 'newCareer', seed: 4, pos: 'CM', firstName: 'א', lastName: 'ב' }, content);
    const rng = makeRng(w.rngState);
    for (const lg of w.leagues) for (const f of w.season.fixtures[lg.id]) { simFixture(w, f, rng, false); applyResult(w, lg.id, f); }
    for (const lg of w.leagues) {
      const t = w.season.tables[lg.id];
      const n = lg.clubIds.length;
      for (const r of t) { expect(r.p).toBe((n - 1) * legsFor(n)); expect(r.w + r.d + r.l).toBe(r.p); }
      expect(t.reduce((s, r) => s + r.gf, 0)).toBe(t.reduce((s, r) => s + r.ga, 0));
    }
    const il1 = w.leagues.find((l) => l.key === 'il1')!, il2 = w.leagues.find((l) => l.key === 'il2')!;
    const sizes = [il1.clubIds.length, il2.clubIds.length];
    const down = sortedTable(w.season.tables[il1.id]).slice(-2).map((r) => r.clubId);
    const up = sortedTable(w.season.tables[il2.id]).slice(0, 2).map((r) => r.clubId);
    const res = promoteRelegate(w);
    expect(res.lines.length).toBe(4);
    expect([il1.clubIds.length, il2.clubIds.length]).toEqual(sizes);
    for (const id of down) { expect(il2.clubIds).toContain(id); expect(w.clubs[id].leagueId).toBe(il2.id); }
    for (const id of up) { expect(il1.clubIds).toContain(id); expect(w.clubs[id].leagueId).toBe(il1.id); }
  });
});
