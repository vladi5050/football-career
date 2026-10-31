import { describe, expect, it } from 'vitest';
import { fixtureContent } from './_content';
import { newGame } from '../../src/core/game';
import { makeRng, seedState } from '../../src/core/rng';
import { applyResult, doubleRoundRobin, emptyRow, promoteRelegate, sortedTable } from '../../src/core/schedule';
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

  it('season fixtures: each pair plays twice, home and away', () => {
    const w = newGame({ type: 'newCareer', seed: 3, pos: 'ST', firstName: 'א', lastName: 'ב' }, content);
    for (const lg of w.leagues) {
      const fx = w.season.fixtures[lg.id];
      const n = lg.clubIds.length;
      expect(fx.length).toBe(n * (n - 1));
      for (const a of lg.clubIds) for (const b of lg.clubIds) if (a !== b) {
        expect(fx.filter((f) => f.home === a && f.away === b).length).toBe(1);
      }
    }
    expect(w.season.totalWeeks).toBe(Math.max(...w.leagues.map((l) => (l.clubIds.length - 1) * 2)));
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
      for (const r of t) { expect(r.p).toBe((n - 1) * 2); expect(r.w + r.d + r.l).toBe(r.p); }
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
