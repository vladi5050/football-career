import { describe, expect, it } from 'vitest';
import { fixtureContent, realContent } from './_content';
import { apply, buildView, newGame } from '../../src/core/game';
import { ovr, userPlayer } from '../../src/core/helpers';
import { deserialize, serialize } from '../../src/core/save';
import type { Content } from '../../src/core/content';
import type { Command, GamePhase, World } from '../../src/core/types';

/** Drive a career with quick weeks. Returns phases seen. */
function drive(world: World, content: Content, maxSeasons: number, onWeek?: (w: World) => void): { world: World; phases: Set<GamePhase> } {
  let w = world;
  const phases = new Set<GamePhase>();
  let guard = 0;
  const run = (cmd: Command): void => { w = apply(w, cmd, content).world; };
  while (!w.career.retired && w.career.seasonsPlayed < maxSeasons && guard++ < 20000) {
    phases.add(w.phase);
    switch (w.phase) {
      case 'plan': case 'event': run({ type: 'quickWeek' }); break;
      case 'prematch': run({ type: 'startMatch' }); break;
      case 'match': run({ type: 'simRestOfMatch' }); break;
      case 'postmatch': case 'weekend': onWeek?.(w); run({ type: 'finishWeek' }); break;
      case 'negotiation': run({ type: 'acceptNegotiation' }); break;
      case 'offseason': {
        const o = w.career.offers[0];
        if (o && w.career.seasonsPlayed % 3 === 1) run({ type: 'respondOffer', offerId: o.id, action: 'negotiate' });
        else run({ type: 'finishWeek' });
        break;
      }
      default: run({ type: 'finishWeek' });
    }
  }
  phases.add(w.phase);
  return { world: w, phases };
}

function sane(w: World, seasons: number): void {
  const u = userPlayer(w);
  expect(w.career.seasonsPlayed).toBeGreaterThanOrEqual(Math.min(seasons, 22));
  expect(u.careerStats.apps).toBeGreaterThan(100);
  expect(ovr(u)).toBeGreaterThan(35);
  expect(u.age).toBeGreaterThanOrEqual(16 + Math.min(seasons, 22));
  expect(w.career.history.length).toBe(w.career.seasonsPlayed);
  for (const h of w.career.history) { expect(h.apps).toBeGreaterThanOrEqual(0); expect(h.position).toBeGreaterThan(0); }
  for (const c of w.clubs) { expect(c.squad.length).toBeGreaterThanOrEqual(19); expect(c.squad.length).toBeLessThanOrEqual(27); }
  const v = buildView(w);
  expect(v.player.overall).toBeGreaterThan(0);
  expect(JSON.stringify(v).length).toBeLessThan(200_000);
}

describe('full career', () => {
  it('20 seasons via quick week, no exceptions, sane outcome', () => {
    const content = fixtureContent();
    const start = newGame({ type: 'newCareer', seed: 2024, pos: 'ST', firstName: 'אלון', lastName: 'שושן' }, content);
    let reports = 0, notable = 0, loops = 0;
    const { world, phases } = drive(start, content, 20, (w) => {
      const r = w.lastWeekReport!;
      reports++;
      if (r.notable) notable++;
      loops += r.openLoops.length;
      expect(r.openLoops.length).toBeLessThanOrEqual(3);
    });
    sane(world, 20);
    expect(phases.has('offseason')).toBe(true);
    expect(phases.has('prematch')).toBe(true);
    expect(notable).toBeGreaterThan(5);
    expect(notable).toBeLessThan(reports);
    expect(loops / reports).toBeGreaterThan(1);
    // nothing in the world's text uses an em dash
    expect(JSON.stringify(world.news)).not.toMatch(/\u2014|\u2013/);
  }, 120_000);

  it('a career ends by 39 at the latest', () => {
    const content = fixtureContent();
    const { world } = drive(newGame({ type: 'newCareer', seed: 99, pos: 'CB', firstName: 'א', lastName: 'ב' }, content), content, 40);
    expect(world.career.retired).toBe(true);
    expect(userPlayer(world).age).toBeLessThanOrEqual(39);
    expect(world.phase).toBe('retired');
    expect(apply(world, { type: 'quickWeek' }, content).toast?.[0]).toBe('הקריירה הסתיימה');
  }, 120_000);

  it('save/load mid-career is deterministic', () => {
    const content = fixtureContent();
    const { world } = drive(newGame({ type: 'newCareer', seed: 5, pos: 'AM', firstName: 'א', lastName: 'ב' }, content), content, 1);
    const json = serialize(world);
    const a = drive(deserialize(json), content, 3).world;
    const b = drive(deserialize(json), content, 3).world;
    expect(serialize(a).replace(/"savedAt":\d+/, '')).toBe(serialize(b).replace(/"savedAt":\d+/, ''));
    expect(() => deserialize('{"nope":1}')).toThrow();
  }, 120_000);

  it('real content: 12 seasons (if present)', async () => {
    const content = await realContent();
    if (!content) return;
    const { world } = drive(newGame({ type: 'newCareer', seed: 7, pos: 'W', firstName: 'א', lastName: 'ב' }, content), content, 12);
    sane(world, 12);
  }, 180_000);
});

describe('phase machine', () => {
  it('plan -> event/prematch -> match -> postmatch -> plan with moments played by hand', () => {
    const content = fixtureContent();
    let w = newGame({ type: 'newCareer', seed: 12, pos: 'W', firstName: 'א', lastName: 'ב' }, content);
    expect(w.phase).toBe('plan');
    w = apply(w, { type: 'setPlan', plan: ['train_dribbling', 'talk_coach', 'rest'] }, content).world;
    expect(['event', 'prematch', 'weekend']).toContain(w.phase);
    while (w.phase === 'event') w = apply(w, { type: 'resolveEvent', uid: w.inbox[0].uid, optionId: w.inbox[0].options[1].id }, content).world;
    expect(w.phase).toBe('prematch');
    w = apply(w, { type: 'startMatch' }, content).world;
    expect(['match', 'postmatch']).toContain(w.phase);
    let guard = 0;
    while (w.phase === 'match' && guard++ < 10) {
      const m = w.live!.moments[w.live!.pendingMomentIndex];
      w = apply(w, { type: 'momentResult', result: { momentId: m.id, success: true, quality: 0.9, skipped: false } }, content).world;
    }
    expect(w.phase).toBe('postmatch');
    expect(w.lastWeekReport).toBeTruthy();
    const v = buildView(w);
    expect(v.live?.finished).toBe(true);
    expect(v.table.length).toBeGreaterThan(0);
    w = apply(w, { type: 'finishWeek' }, content).world;
    expect(w.phase).toBe('plan');
    expect(w.season.week).toBe(1);
    expect(w.live).toBeNull();
    // wrong-phase commands are rejected with a toast, not an exception
    expect(apply(w, { type: 'startMatch' }, content).toast?.length).toBe(1);
  });
});
