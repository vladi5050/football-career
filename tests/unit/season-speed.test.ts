// Season speed (מהירות עונה): full / balanced / key, and the fast-forward to the next stop.
import { describe, expect, it } from 'vitest';
import { fixtureContent, realContent } from './_content';
import { apply, buildView, isMajorEvent, newGame } from '../../src/core/game';
import { importantMatch, isStopEvent, racesOf, seasonSpeed } from '../../src/core/seasonSpeed';
import { userClub } from '../../src/core/helpers';
import { fixtureFor, sortedTable } from '../../src/core/schedule';
import { autoOptionId } from '../../src/core/events';
import { deserialize, serialize } from '../../src/core/save';
import type { Content } from '../../src/core/content';
import type { Command, SeasonSpeed, World } from '../../src/core/types';

const gen = (content: Content, seed = 7, seasonSpeed?: SeasonSpeed): World =>
  newGame({ type: 'newCareer', seed, pos: 'ST', firstName: 'א', lastName: 'ב', ...(seasonSpeed ? { seasonSpeed } : {}) }, content);

/** Drive the world like a player who answers everything with the default and never moves. */
function step(w: World, content: Content): World {
  const run = (c: Command): World => apply(w, c, content).world;
  switch (w.phase) {
    case 'plan': return run({ type: 'quickWeek' });
    case 'event': return run({ type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) });
    case 'prematch': return run({ type: 'startMatch' });
    case 'match': return run({ type: 'simRestOfMatch' });
    case 'negotiation': return run({ type: 'walkAway' });
    default: return run({ type: 'finishWeek' });
  }
}

/** Play until the current week's plan phase after the first match (first_match_done). */
function pastFirstMatch(w: World, content: Content): World {
  let guard = 0;
  while ((!w.history.flags.first_match_done || w.phase !== 'plan') && guard++ < 200) w = step(w, content);
  return w;
}

/** Make the user's match this week (if any) a plain, unimportant one. */
function userFixture(w: World) {
  const c = userClub(w)!;
  return { c, f: fixtureFor(w, c.id, w.season.week) };
}

describe('season speed: setting', () => {
  it('defaults to full, is chosen at career start, changes in settings and survives a save', () => {
    const content = fixtureContent();
    expect(seasonSpeed(gen(content))).toBe('full');
    expect(gen(content).settings.seasonSpeed).toBeUndefined(); // old save shape stays as it was
    const w = gen(content, 7, 'key');
    expect(seasonSpeed(w)).toBe('key');
    expect(buildView(w).settings?.seasonSpeed).toBe('key');
    apply(w, { type: 'setSeasonSpeed', value: 'balanced' }, content);
    expect(seasonSpeed(deserialize(serialize(w)))).toBe('balanced');
    apply(w, { type: 'setSeasonSpeed', value: 'full' }, content);
    expect(w.settings.seasonSpeed).toBeUndefined();
  });

  it('full: finishing a week moves exactly one week, nothing runs by itself', () => {
    const content = fixtureContent();
    let w = pastFirstMatch(gen(content), content);
    for (let i = 0; i < 6; i++) {
      const before = w.absWeek;
      while (w.phase !== 'postmatch' && w.phase !== 'weekend' && w.phase !== 'offseason') w = step(w, content);
      w = apply(w, { type: 'finishWeek' }, content).world;
      expect(w.absWeek).toBe(before + 1);
      expect(buildView(w).skip ?? null).toBeNull();
    }
  });
});

describe('season speed: which matches are important', () => {
  it('first career match always stops; a derby stops at both faster speeds', () => {
    const content = fixtureContent();
    const w = gen(content, 9);
    expect(importantMatch(w, 'key')).toBe('המשחק הראשון בקריירה');
    w.history.flags.first_match_done = 1;
    const { c, f } = userFixture(w);
    if (!f) return;
    const opp = f.home === c.id ? f.away : f.home;
    c.rivalClubId = opp;
    expect(importantMatch(w, 'balanced')).toMatch(/^דרבי/);
    expect(importantMatch(w, 'key')).toMatch(/^דרבי/);
    expect(importantMatch(w, 'full')).toBe('כל משחק');
  });

  it('balanced: close table neighbours and top/bottom 2 (neighbours within 1) play, mid-table far away runs; one in three plays anyway', async () => {
    const content = (await realContent()) ?? fixtureContent();
    let w = pastFirstMatch(gen(content, 21), content);
    // walk to a week with a fixture
    let guard = 0;
    while (!userFixture(w).f && guard++ < 10) { w = step(w, content); while (w.phase !== 'plan') w = step(w, content); }
    const { c, f } = userFixture(w);
    if (!f) return;
    c.rivalClubId = null;
    for (const cl of w.clubs) if (cl.rivalClubId === c.id) cl.rivalClubId = null;
    w.career.matchClubId = c.id;
    w.career.ffAutoMatches = 0;
    (w.people[w.career.playerId] as { injury: unknown }).injury = null;
    const oppId = f.home === c.id ? f.away : f.home;
    const rows = w.season.tables[c.leagueId];
    if (rows.length < 12) return; // needs room for "far away, mid-table"
    // rank by points: us 1st... rebuild a clean table so the order is ours to set
    const order = [c.id, ...rows.map((r) => r.clubId).filter((id) => id !== c.id && id !== oppId)];
    const place = (oppRank: number): void => {
      const ids = order.slice();
      ids.splice(oppRank, 0, oppId);
      ids.forEach((id, i) => { const r = rows.find((x) => x.clubId === id)!; r.p = 4; r.pts = 100 - i * 10; });
    };
    // us 1st: an opponent at 2nd is a direct neighbour (and top 2)
    place(1);
    expect(importantMatch(w, 'balanced')).not.toBeNull();
    // us 1st, opponent at the 7th row (index 6): more than 1 place, not top 2, not bottom 2 (n >= 12), no race at week 1
    place(6);
    const n = rows.length;
    expect(6 < n - 2).toBe(true);
    expect(sortedTable(rows).findIndex((r) => r.clubId === oppId)).toBe(6);
    // the title race: we lead by 10, more than 6 points: not a race
    expect(racesOf(w, c.id)).not.toContain('title');
    expect(importantMatch(w, 'balanced')).toBeNull();
    expect(importantMatch(w, 'key')).toBeNull();
    // bottom two
    place(n - 1);
    expect(importantMatch(w, 'balanced')).toMatch(/השתיים התחתונות/);
    place(6);
    w.career.ffAutoMatches = 2;
    expect(importantMatch(w, 'balanced')).toMatch(/משחק אחד מכל שלושה/);
    expect(importantMatch(w, 'key')).toBeNull();
    // key: the first match at a new club
    w.career.matchClubId = c.id + 1;
    expect(importantMatch(w, 'key')).toBe('המשחק הראשון במועדון החדש');
    // injured: nothing to play from the stands
    w.career.matchClubId = c.id;
    w.career.ffAutoMatches = 0;
    (w.people[w.career.playerId] as { injury: unknown }).injury = { kind: 'מתיחה', weeksLeft: 2 };
    place(1);
    expect(importantMatch(w, 'balanced')).toBeNull();
  });

  it('decisions that always wait for the player: transfer, national team, injury, contract', () => {
    const content = fixtureContent();
    const ev = (category: string) => ({ templateId: 'x_unknown', category });
    for (const cat of ['transfer', 'national', 'army', 'injury']) expect(isStopEvent(content, ev(cat), isMajorEvent)).toBe(true);
    for (const cat of ['team', 'media', 'fans']) expect(isStopEvent(content, ev(cat), isMajorEvent)).toBe(false);
  });
});

describe('season speed: fast-forward', () => {
  it('"שבוע מהיר עד המשחק הבא" runs weeks to the next stop, with a summary, and never leaves a match open', async () => {
    const content = (await realContent()) ?? fixtureContent();
    let w = pastFirstMatch(gen(content, 31, 'key'), content);
    let checked = 0;
    for (let i = 0; i < 12 && checked < 4; i++) {
      if (w.phase !== 'plan') { w = step(w, content); continue; }
      const before = w.absWeek;
      w = apply(w, { type: 'quickWeek', untilNext: true }, content).world;
      expect(w.phase).not.toBe('match');
      expect(w.phase).not.toBe('prematch');
      const v = buildView(w);
      if (!v.skip) continue;
      checked++;
      expect(v.skip.weeks).toBeGreaterThan(0);
      expect(w.absWeek - before).toBeGreaterThanOrEqual(v.skip.weeks - 1);
      expect(v.skip.stopReason.length).toBeGreaterThan(2);
      expect(['plan', 'event', 'weekend']).toContain(v.skip.at);
      if (v.skip.at === 'plan') expect(w.phase).toBe('plan');
      if (v.skip.at === 'event') expect(['event', 'negotiation']).toContain(w.phase);
      for (const m of v.skip.matches) {
        expect(m.us).toBeGreaterThanOrEqual(0);
        expect(m.oppName.length).toBeGreaterThan(0);
        if (m.rating != null) expect(m.rating).toBeGreaterThan(2);
      }
      expect(v.skip.posBefore).toBeGreaterThanOrEqual(0);
      // the moments setting is the player's again
      expect(w.settings.autoMoments).toBe(false);
      // play out whatever stopped us, back to a plan phase
      let g = 0;
      while (w.phase !== 'plan' && g++ < 40) w = step(w, content);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('balanced/key: finishing a week runs the next unimportant weeks by itself', async () => {
    const content = (await realContent()) ?? fixtureContent();
    let w = gen(content, 44, 'key');
    let jumped = 0;
    for (let i = 0; i < 60; i++) {
      if (w.phase === 'postmatch' || w.phase === 'weekend') {
        const before = w.absWeek;
        w = apply(w, { type: 'finishWeek' }, content).world;
        if (w.absWeek - before > 1) jumped++;
      } else w = step(w, content);
    }
    expect(jumped).toBeGreaterThan(0);
  });

  it('is fast: a 6-week skip on the real content stays well under 400 ms', async () => {
    const content = await realContent();
    if (!content) return;
    let w = pastFirstMatch(gen(content, 52, 'key'), content);
    let weeks = 0, ms = 0;
    for (let i = 0; i < 30 && weeks < 18; i++) {
      if (w.phase !== 'plan') { w = step(w, content); continue; }
      const t = performance.now();
      w = apply(w, { type: 'quickWeek', untilNext: true }, content).world;
      buildView(w);
      ms += performance.now() - t;
      weeks += buildView(w).skip?.weeks ?? 1;
    }
    const per6 = (ms / Math.max(1, weeks)) * 6;
    console.log(`fast-forward: ${weeks} weeks in ${ms.toFixed(0)} ms, ${per6.toFixed(0)} ms per 6 weeks`);
    expect(weeks).toBeGreaterThanOrEqual(6);
    expect(per6).toBeLessThan(400);
  }, 60_000);
});
