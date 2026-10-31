import { describe, expect, it } from 'vitest';
import { fixtureContent, realContent } from './_content';
import { newGame } from '../../src/core/game';
import { makeRng } from '../../src/core/rng';
import { autoSuccessChance, quickScore, resolveMomentAuto, startLiveMatch, advanceLive, applyMomentResult, finalizeLive } from '../../src/core/matchSim';
import type { Content } from '../../src/core/content';
import type { World } from '../../src/core/types';
import { userPlayer } from '../../src/core/helpers';

function averages(w: World, n: number) {
  const rng = makeRng(w.rngState);
  let goals = 0, home = 0, draw = 0;
  for (let i = 0; i < n; i++) {
    const lg = w.leagues[i % w.leagues.length];
    const h = lg.clubIds[rng.int(0, lg.clubIds.length - 1)];
    let a = h;
    while (a === h) a = lg.clubIds[rng.int(0, lg.clubIds.length - 1)];
    const [hg, ag] = quickScore(w, h, a, rng);
    goals += hg + ag;
    if (hg > ag) home++; else if (hg === ag) draw++;
  }
  return { gpm: goals / n, home: home / n, draw: draw / n };
}

describe('match sim', () => {
  it('2000 matches: realistic averages (fixture content)', () => {
    const w = newGame({ type: 'newCareer', seed: 21, pos: 'ST', firstName: 'א', lastName: 'ב' }, fixtureContent());
    const r = averages(w, 2000);
    expect(r.gpm).toBeGreaterThan(2.3);
    expect(r.gpm).toBeLessThan(2.95);
    expect(r.home).toBeGreaterThan(0.4);
    expect(r.home).toBeLessThan(0.51);
    expect(r.draw).toBeGreaterThan(0.21);
    expect(r.draw).toBeLessThan(0.33);
  });

  it('2000 matches: realistic averages (real content, if present)', async () => {
    const c = await realContent();
    if (!c) return;
    const w = newGame({ type: 'newCareer', seed: 22, pos: 'ST', firstName: 'א', lastName: 'ב' }, c);
    const r = averages(w, 2000);
    expect(r.gpm).toBeGreaterThan(2.3);
    expect(r.gpm).toBeLessThan(2.95);
    expect(r.home).toBeGreaterThan(0.4);
    expect(r.home).toBeLessThan(0.51);
  });

  it('live match: 3-5 moments, no two same kind in a row, context + stakes filled', () => {
    const content: Content = fixtureContent();
    let checked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const w = newGame({ type: 'newCareer', seed, pos: (['ST', 'CM', 'CB', 'GK'] as const)[seed % 4], firstName: 'א', lastName: 'ב' }, content);
      const rng = makeRng(w.rngState);
      const u = userPlayer(w);
      // make him a regular so he starts
      for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] = 75;
      const live = startLiveMatch(w, rng);
      if (!live) continue;
      expect(live.started).toBe(true);
      expect(live.moments.length).toBeGreaterThanOrEqual(3);
      expect(live.moments.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < live.moments.length; i++) {
        expect(live.moments[i].kind).not.toBe(live.moments[i - 1].kind);
        expect(live.moments[i].minute).toBeGreaterThanOrEqual(live.moments[i - 1].minute);
      }
      let guard = 0;
      advanceLive(w, live, rng);
      while (!live.finished && guard++ < 10) {
        const m = live.moments[live.pendingMomentIndex];
        expect(m.stakes).toMatch(/^דקה \d+, \d+-\d+/);
        expect(m.difficulty).toBeGreaterThan(0);
        expect(m.difficulty).toBeLessThan(1);
        expect(m.scoreBefore[0] + m.scoreBefore[1]).toBe(live.score[0] + live.score[1]);
        applyMomentResult(w, live, resolveMomentAuto(m, rng, u.pos), rng);
        advanceLive(w, live, rng);
      }
      const r = finalizeLive(w, live, rng);
      expect(r).not.toBeNull();
      expect(r!).toBeGreaterThanOrEqual(4);
      expect(r!).toBeLessThanOrEqual(10);
      expect(live.fixture.played).toBe(true);
      expect(live.fixture.hg).toBe(live.score[0]);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('context makes moments harder', () => {
    const base = { id: 1, kind: 'shot' as const, minute: 30, difficulty: 0.4, attackerSkill: 60, opponentId: null, opponentName: '', scoreBefore: [0, 0] as [number, number], stakes: '',
      context: { lateClose: false, hostileCrowd: false, rivalInvolved: false, rain: false, derby: false } };
    expect(autoSuccessChance({ ...base, difficulty: 0.7 })).toBeLessThan(autoSuccessChance(base));
    expect(autoSuccessChance({ ...base, kind: 'penalty' }, 'GK')).toBeLessThan(autoSuccessChance({ ...base, kind: 'penalty' }, 'ST'));
  });

  it('a weak youngster is often out of the senior XI, and then plays youth football', () => {
    let youth = 0, total = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const w = newGame({ type: 'newCareer', seed, pos: 'CB', firstName: 'א', lastName: 'ב' }, fixtureContent());
      const u = userPlayer(w);
      for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] = 30;
      const live = startLiveMatch(w, makeRng(w.rngState));
      if (!live) continue;
      total++;
      if (live.youth) { youth++; expect(live.moments.length).toBeGreaterThan(0); expect(live.fixture).not.toBe(w.season.fixtures[live.leagueId].find((f) => f === live.fixture)); }
    }
    expect(youth).toBeGreaterThan(total * 0.3);
  });
});
