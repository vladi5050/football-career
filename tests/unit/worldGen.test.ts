import { describe, expect, it } from 'vitest';
import { bigContent, fixtureContent, realContent } from './_content';
import { generateWorld } from '../../src/core/worldGen';
import { apply, newGame } from '../../src/core/game';
import { ovr, userPlayer } from '../../src/core/helpers';
import type { Footballer, Position } from '../../src/core/types';

describe('worldGen', () => {
  it('builds clubs, 22+ squads, staff, user, rival, family', () => {
    const w = generateWorld(fixtureContent(), 1, { pos: 'W', firstName: 'דני', lastName: 'כהן' });
    expect(w.clubs.length).toBe(26);
    for (const c of w.clubs) {
      expect(c.squad.length).toBeGreaterThanOrEqual(22);
      expect(w.people[c.managerId].role).toBe('coach');
      expect(w.people[c.managerId].traits.length).toBe(3);
      expect(w.people[c.chairmanId].role).toBe('chairman');
      expect(c.crest[0]).toBeLessThan(6); expect(c.crest[1]).toBeLessThan(10); expect(c.crest[2]).toBeLessThan(14); expect(c.crest[3]).toBeLessThan(11);
      const gks = c.squad.filter((id) => (w.people[id] as Footballer).pos === 'GK').length;
      expect(gks).toBeGreaterThanOrEqual(2);
    }
    const u = userPlayer(w);
    expect(u.name).toBe('דני כהן');
    expect(u.age).toBe(16);
    expect(ovr(u)).toBeGreaterThanOrEqual(34);
    expect(ovr(u)).toBeLessThanOrEqual(46);
    expect(u.potential).toBeGreaterThanOrEqual(60);
    expect(u.potential).toBeLessThanOrEqual(92);
    const rival = w.people[w.career.rivalId] as Footballer;
    expect(rival.age).toBeLessThanOrEqual(17);
    expect(rival.clubId).not.toBe(u.clubId);
    const agent = w.people[w.career.agentId];
    expect(['shark', 'mentor', 'uncle']).toContain(agent.archetype);
    expect(w.career.circle?.father).toBeTruthy();
    expect(w.career.startStory?.length).toBeGreaterThan(10);
    // rival club is the derby club when there is one
    const uc = w.clubs[u.clubId!];
    if (uc.rivalClubId != null) expect(rival.clubId).toBe(uc.rivalClubId);
  });

  it('start roll: mostly Israel, some academies abroad', () => {
    const kinds: Record<string, number> = {};
    for (let s = 0; s < 120; s++) {
      const w = generateWorld(fixtureContent(), s, { pos: 'CM' as Position, firstName: 'א', lastName: 'ב' });
      kinds[w.career.startKind] = (kinds[w.career.startKind] ?? 0) + 1;
      if (w.career.startKind === 'israel') {
        const c = w.clubs[userPlayer(w).clubId!];
        expect(w.leagues[c.leagueId].countryCode).toBe('IL');
        expect(w.leagues[c.leagueId].tier).toBeGreaterThanOrEqual(2);
      }
    }
    expect(kinds.israel / 120).toBeGreaterThan(0.45);
    expect(kinds.israel / 120).toBeLessThan(0.75);
    expect((kinds.foreign_academy ?? 0) + (kinds.raised_abroad ?? 0)).toBeGreaterThan(20);
  });

  it('~400 clubs generate in under 2 seconds', () => {
    const big = bigContent(20, 20);
    const t0 = performance.now();
    const w = newGame({ type: 'newCareer', seed: 77, pos: 'ST', firstName: 'א', lastName: 'ב' }, big);
    const ms = performance.now() - t0;
    expect(w.clubs.length).toBe(400);
    expect(ms).toBeLessThan(2000);
  });

  it('a full quick week with ~400 clubs takes < 50ms', () => {
    const big = bigContent(20, 20);
    let w = newGame({ type: 'newCareer', seed: 78, pos: 'ST', firstName: 'א', lastName: 'ב' }, big);
    const weekCycle = () => {
      w = apply(w, { type: 'quickWeek' }, big).world;
      if (w.phase === 'prematch') w = apply(w, { type: 'startMatch' }, big).world;
      if (w.phase === 'match') w = apply(w, { type: 'simRestOfMatch' }, big).world;
      w = apply(w, { type: 'finishWeek' }, big).world;
    };
    weekCycle(); weekCycle(); // warm up
    const t0 = performance.now();
    const n = 10;
    for (let i = 0; i < n; i++) weekCycle();
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(50);
  });

  it('real content generates (if present)', async () => {
    const c = await realContent();
    if (!c) return;
    const t0 = performance.now();
    const w = generateWorld(c, 5, { pos: 'GK', firstName: 'א', lastName: 'ב' });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(w.clubs.length).toBe(c.leagues.reduce((s, l) => s + l.clubs.length, 0));
    const linked = w.leagues.filter((l) => l.relegatesTo != null);
    for (const l of linked) expect(w.leagues[l.relegatesTo!].promotesTo).toBe(l.id);
  });
});
