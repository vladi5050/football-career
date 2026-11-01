// Training depends on the club (facilities) and on the player (persistence, potential).
import { describe, expect, it } from 'vitest';
import { fixtureContent, realContent } from './_content';
import { apply, buildView, newGame } from '../../src/core/game';
import {
  applyTraining, changePersistence, clubFacilities, facilityMult, facilityScore, persistenceMult, persistenceOf, rollPersistence, trainingWhy, weeklyPersistence,
} from '../../src/core/development';
import { applyEffects, parseEffect } from '../../src/core/events';
import { makeRng } from '../../src/core/rng';
import { userPlayer } from '../../src/core/helpers';
import { deserialize, serialize } from '../../src/core/save';
import type { Content } from '../../src/core/content';
import type { WeekPlan, World } from '../../src/core/types';

const gen = (content: Content, seed = 5): World => newGame({ type: 'newCareer', seed, pos: 'W', firstName: 'א', lastName: 'ב' }, content);
const clone = (w: World): World => structuredClone(w);
const PLAN: WeekPlan = ['train_dribbling', 'train_pace', 'train_passing'];

function weekGain(w: World): number {
  const u = userPlayer(w);
  const before = Object.values(u.attr).reduce((a, b) => a + b, 0);
  applyTraining(w, PLAN, makeRng([1, 2, 3, 4]));
  return Object.values(u.attr).reduce((a, b) => a + b, 0) - before;
}

describe('training facilities (מתקני אימון)', () => {
  it('big clubs get 4-5 stars, lower-league clubs 1-2; deterministic', async () => {
    const content = await realContent();
    if (!content) return;
    const w = gen(content);
    const byKey = (k: string) => w.leagues.find((l) => l.key === k)!;
    const best = (k: string) => Math.max(...byKey(k).clubIds.map((id) => clubFacilities(w, id)));
    const worst = (k: string) => Math.min(...byKey(k).clubIds.map((id) => clubFacilities(w, id)));
    expect(best('en1')).toBe(5);
    expect(worst('en1')).toBeGreaterThanOrEqual(4);
    for (const k of ['es1', 'it1', 'de1']) expect(worst(k)).toBeGreaterThanOrEqual(4);
    for (const k of ['il3n', 'il4na']) expect(best(k)).toBeLessThanOrEqual(2);
    expect(best('il1')).toBeGreaterThanOrEqual(3);
    expect(best('il1')).toBeLessThanOrEqual(4);
    for (const c of w.clubs) {
      const s = clubFacilities(w, c.id);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(5);
    }
    expect(clubFacilities(gen(content), 0)).toBe(clubFacilities(w, 0));
    // score: more reputation, more strength, more money -> never fewer stars
    expect(facilityScore({ reputation: 80 }, { strength: 70, wageFactor: 3 })).toBeGreaterThan(facilityScore({ reputation: 60 }, { strength: 70, wageFactor: 3 }));
  });

  it('multiplier runs about 0.8 at 1 star up to 1.25 at 5, and the club changes the weekly gain', () => {
    expect(facilityMult(1)).toBeCloseTo(0.8, 2);
    expect(facilityMult(5)).toBeCloseTo(1.25, 2);
    expect(facilityMult(3)).toBeGreaterThan(facilityMult(2));
    const content = fixtureContent();
    const w = gen(content);
    const u = userPlayer(w);
    const club = w.clubs[u.clubId!];
    const lg = w.leagues[club.leagueId];
    const rich = clone(w), poor = clone(w);
    rich.clubs[club.id].reputation = 99; rich.leagues[lg.id].strength = 95; rich.leagues[lg.id].wageFactor = 15;
    poor.clubs[club.id].reputation = 5; poor.leagues[lg.id].strength = 10; poor.leagues[lg.id].wageFactor = 0.05;
    expect(clubFacilities(rich, club.id)).toBe(5);
    expect(clubFacilities(poor, club.id)).toBe(1);
    const gr = weekGain(rich), gp = weekGain(poor);
    expect(gr / gp).toBeGreaterThan(1.4);
    expect(gr / gp).toBeLessThan(1.7);
    // the view carries it for the Club screen, offers and contracts
    expect(buildView(w).club?.facilities).toBe(clubFacilities(w, club.id));
  });
});

describe('training persistence (התמדה באימון)', () => {
  it('is rolled at career start with a wide spread, and is part of the player view', () => {
    const vals = Array.from({ length: 200 }, (_, i) => rollPersistence(i * 7919 + 1));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...vals)).toBeLessThanOrEqual(100);
    expect(Math.min(...vals)).toBeLessThan(25);
    expect(Math.max(...vals)).toBeGreaterThan(80);
    expect(sd).toBeGreaterThan(14);
    const content = fixtureContent();
    const w = gen(content, 77);
    expect(userPlayer(w).persistence).toBe(rollPersistence(77));
    expect(buildView(w).player.persistence).toBe(Math.round(rollPersistence(77)));
  });

  it('multiplier about 0.85 low to 1.2 high, and it changes the weekly gain', () => {
    expect(persistenceMult(1)).toBeCloseTo(0.85, 2);
    expect(persistenceMult(100)).toBeCloseTo(1.2, 2);
    const w = gen(fixtureContent());
    const hi = clone(w), lo = clone(w);
    userPlayer(hi).persistence = 100;
    userPlayer(lo).persistence = 1;
    const r = weekGain(hi) / weekGain(lo);
    expect(r).toBeGreaterThan(1.3);
    expect(r).toBeLessThan(1.5);
  });

  it('moves slowly with the week: training builds it, rest / team nights / media erode it, rehab weeks leave it', () => {
    const w = gen(fixtureContent());
    userPlayer(w).persistence = 50;
    weeklyPersistence(w, ['train_pace', 'train_dribbling', 'rest']);
    const up2 = persistenceOf(w) - 50;
    expect(up2).toBeGreaterThan(0);
    expect(up2).toBeLessThan(0.5);
    userPlayer(w).persistence = 50;
    weeklyPersistence(w, ['train_pace', 'train_dribbling', 'extra_gym']);
    expect(persistenceOf(w) - 50).toBeGreaterThan(up2);
    userPlayer(w).persistence = 50;
    weeklyPersistence(w, ['rest', 'team_night', 'media']);
    expect(persistenceOf(w)).toBeLessThan(50);
    userPlayer(w).persistence = 50;
    weeklyPersistence(w, ['train_pace', 'family', 'talk_coach']);
    expect(persistenceOf(w)).toBe(50);
    userPlayer(w).injury = { kind: 'מתיחה', weeksLeft: 2 };
    weeklyPersistence(w, ['rest', 'rest', 'rest']);
    expect(persistenceOf(w)).toBe(50);
    // a full season of the default two-training-slot plan: a few points, not a jump
    userPlayer(w).injury = null;
    for (let i = 0; i < 35; i++) weeklyPersistence(w, ['train_pace', 'train_dribbling', 'rest']);
    expect(persistenceOf(w)).toBeGreaterThan(52);
    expect(persistenceOf(w)).toBeLessThan(60);
    changePersistence(w, 500);
    expect(persistenceOf(w)).toBe(100);
  });

  it('events: `persistence += n` / `-= n` is in the closed effect list; discipline incidents cost a little', () => {
    const content = fixtureContent();
    const w = gen(content);
    expect(parseEffect('persistence += 3')).toEqual({ k: 'stat', key: 'persistence', d: 3 });
    expect(parseEffect('persistence -= 2')).toEqual({ k: 'stat', key: 'persistence', d: -2 });
    userPlayer(w).persistence = 40;
    applyEffects(w, content, [parseEffect('persistence += 3')], {}, makeRng([1, 2, 3, 4]), 'x');
    expect(persistenceOf(w)).toBe(43);
  });

  it('real content: a few events use it (extra practice up, defiance down)', async () => {
    const content = await realContent();
    if (!content) return;
    const uses = content.events.flatMap((e) => e.options.flatMap((o) => o.effects.filter((x) => /^persistence\s*[+-]=/.test(x))));
    expect(uses.length).toBeGreaterThanOrEqual(10);
    expect(uses.some((x) => x.includes('+='))).toBe(true);
    expect(uses.some((x) => x.includes('-='))).toBe(true);
  });

  it('older saves get a persistence on load (from the seed)', () => {
    const w = gen(fixtureContent(), 123);
    delete userPlayer(w).persistence;
    const back = deserialize(serialize(w));
    expect(userPlayer(back).persistence).toBe(rollPersistence(123));
    // and a normal save keeps the value
    userPlayer(back).persistence = 61.5;
    expect(userPlayer(deserialize(serialize(back))).persistence).toBe(61.5);
  });
});

describe('weekly report: why gains were big or small', () => {
  it('names facilities, persistence and the ceiling', () => {
    const content = fixtureContent();
    let w = gen(content);
    const why = trainingWhy(w);
    expect(why).toMatch(/^מתקנים [★☆]{5} · התמדה /);
    const u = userPlayer(w);
    const p0 = u.potential;
    u.potential = Math.floor(Object.values(u.attr).reduce((a, b) => Math.max(a, b), 0)); // at or near the ceiling
    expect(trainingWhy(w)).toMatch(/תקרה/);
    u.potential = p0;
    // a played week carries the line in the report
    let guard = 0;
    while (!w.lastWeekReport && guard++ < 20) {
      const cmd = w.phase === 'plan' ? { type: 'setPlan' as const, plan: PLAN } : w.phase === 'event' ? { type: 'resolveEvent' as const, uid: w.inbox[0].uid, optionId: w.inbox[0].options[0].id } : w.phase === 'prematch' ? { type: 'startMatch' as const } : { type: 'simRestOfMatch' as const };
      w = apply(w, cmd, content).world;
    }
    expect(w.lastWeekReport?.trainingWhy ?? '').toMatch(/מתקנים/);
    expect(w.lastWeekReport?.trainingWhy ?? '').not.toMatch(/—/);
  });
});
