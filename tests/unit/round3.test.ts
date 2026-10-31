// Round 3 (QA fixes): pre-match truth, moment counts, final offer, no auto-decisions, autosave phases, near goals, Hebrew, calendar.
import { describe, expect, it } from 'vitest';
import { fixtureContent } from './_content';
import { apply, buildView, newGame } from '../../src/core/game';
import { makeRng } from '../../src/core/rng';
import { count, fmtMoney, pre, userClub, userPlayer } from '../../src/core/helpers';
import { negotiateRound, openNegotiation } from '../../src/core/negotiation';
import { startLiveMatch } from '../../src/core/matchSim';
import { nearGoals } from '../../src/core/goals';
import { autoOptionId, makeEnv } from '../../src/core/events';
import { parseCondition, testCondition } from '../../src/core/conditions';
import { deserialize, serialize } from '../../src/core/save';
import { wageFor } from '../../src/core/wages';
import type { Content } from '../../src/core/content';
import type { Command, World } from '../../src/core/types';

const content: Content = fixtureContent();
const start = (seed: number, pos: 'ST' | 'CB' | 'W' = 'ST'): World => newGame({ type: 'newCareer', seed, pos, firstName: 'א', lastName: 'ב' }, content);
const run = (w: World, cmd: Command): World => apply(w, cmd, content).world;

/** Manual week up to the pre-match screen (or the week end when there is no match). */
function toPrematch(w: World): World {
  w = run(w, { type: 'setPlan', plan: ['train_finishing', 'rest', 'train_pace'] });
  while (w.phase === 'event') w = run(w, { type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) });
  return w;
}

function finishWeek(w: World): World {
  if (w.phase === 'prematch') w = run(w, { type: 'startMatch' });
  if (w.phase === 'match') w = run(w, { type: 'simRestOfMatch' });
  if (w.phase === 'negotiation') w = run(w, { type: 'walkAway' });
  return run(w, { type: 'finishWeek' });
}

describe('round 3: match day', () => {
  it('BUG-01: the pre-match lineup is decided before the match and the match honours it', () => {
    let checked = 0;
    for (let seed = 1; seed <= 6; seed++) {
      let w = start(seed, (['ST', 'CB', 'W'] as const)[seed % 3]);
      for (let week = 0; week < 8 && !w.career.retired; week++) {
        w = toPrematch(w);
        if (w.phase === 'prematch') {
          const v = buildView(w);
          expect(v.prematch).toBeTruthy();
          expect(v.prematch!.reason).toMatch(/[א-ת]/);
          w = run(w, { type: 'startMatch' });
          const live = w.live!;
          const actual = live.youth ? 'youth' : live.started ? 'starter' : live.subMinute != null ? 'bench' : 'out';
          expect(actual).toBe(v.prematch!.lineup);
          checked++;
        }
        w = finishWeek(w);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('quick week goes straight into the match, never stops on pre-match', () => {
    for (let seed = 1; seed <= 6; seed++) {
      let w = start(seed);
      for (let week = 0; week < 6; week++) {
        w = run(w, { type: 'quickWeek' });
        while (w.phase === 'event') w = run(w, { type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) });
        expect(w.phase).not.toBe('prematch');
        expect(['match', 'postmatch', 'weekend', 'negotiation']).toContain(w.phase);
        w = finishWeek(w);
      }
    }
  });

  it('BUG-02: first career match has exactly 3 moments with a scoring chance; a starter gets 3-5, a sub at least 2', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let w = toPrematch(start(seed, seed % 2 ? 'ST' : 'W'));
      expect(w.phase).toBe('prematch');
      w = run(w, { type: 'startMatch' });
      expect(w.live!.moments.length).toBe(3);
      expect(w.live!.moments.some((m) => ['shot', 'one_on_one', 'header', 'long_shot', 'free_kick'].includes(m.kind))).toBe(true);
    }
    for (let seed = 20; seed <= 30; seed++) {
      const w = start(seed);
      w.history.flags.first_match_done = 1;
      const dec = { absWeek: w.absWeek, subMinute: 75, reason: 'x', firstMatch: false };
      const sub = startLiveMatch(w, makeRng(w.rngState), { ...dec, lineup: 'bench' })!;
      expect(sub.moments.length).toBeGreaterThanOrEqual(2);
      const st = startLiveMatch(w, makeRng(w.rngState), { ...dec, lineup: 'starter', subMinute: null })!;
      expect(st.moments.length).toBeGreaterThanOrEqual(3);
      expect(st.moments.length).toBeLessThanOrEqual(5);
    }
  });
});

describe('round 3: contracts', () => {
  const fresh = (seed = 31): World => {
    const w = start(seed);
    const u = userPlayer(w);
    u.age = 22;
    for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] = 62;
    u.contract!.endSeason = 1;
    return w;
  };

  it('BUG-03: rounds 1..3, the last counter is marked final, and another ask does not blow up the talks', () => {
    let finals = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const w = fresh(seed);
      const rng = makeRng(w.rngState);
      if (typeof openNegotiation(w, content, rng, userClub(w)!.id, null, 'plan') === 'string') continue;
      const n = w.career.negotiation!;
      expect(n.round).toBe(1);
      expect(n.final).toBe(false);
      const ask = (): string => negotiateRound(w, content, rng, { wage: Math.round(n.hiddenCeiling * 1.12), role: n.currentOffer.role, years: 3, releaseClause: null });
      ask();
      if (n.status !== 'open') continue;
      ask();
      if (n.status !== 'open' || !n.final) continue;
      finals++;
      expect(n.round).toBe(3);
      expect(n.log[n.log.length - 1]).toContain('זו ההצעה האחרונה');
      const reply = ask();
      expect(reply).toContain('ההצעה האחרונה');
      expect(n.status).toBe('open');
      expect(n.round).toBe(3);
      expect(buildView(w).career.negotiation!.final).toBe(true);
    }
    expect(finals).toBeGreaterThan(0);
  });

  it('BUG-10: a performing player is not offered a pay cut on renewal; a benched one may be, and the agent says why', () => {
    const w = fresh(9);
    const u = userPlayer(w);
    u.contract!.monthlyWage = 40000;
    w.career.recentMinutes = [90, 90, 90, 85, 90];
    w.career.recentRatings = [7, 6.8, 7.1];
    expect(typeof openNegotiation(w, content, makeRng(w.rngState), userClub(w)!.id, null, 'plan')).not.toBe('string');
    expect(w.career.negotiation!.currentOffer.wage).toBeGreaterThanOrEqual(40000 * 0.95);
    const b = fresh(9);
    const ub = userPlayer(b);
    ub.contract!.monthlyWage = 40000;
    b.career.recentMinutes = [0, 0, 0, 0, 10];
    b.season.week = 20;
    expect(typeof openNegotiation(b, content, makeRng(b.rngState), userClub(b)!.id, null, 'plan')).not.toBe('string');
    if (b.career.negotiation!.currentOffer.wage < 40000) expect(b.career.negotiation!.log.join(' ')).toContain('הסוכן');
  });

  it('BUG-04: an expired contract is never auto-renewed; the offseason opens the talks instead', () => {
    let w = start(17);
    let g = 0;
    while (w.phase !== 'offseason' && g++ < 400) {
      if (w.phase === 'plan') w = run(w, { type: 'quickWeek' });
      else if (w.phase === 'event') w = run(w, { type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) });
      else if (w.phase === 'negotiation') w = run(w, { type: 'walkAway' });
      else w = finishWeek(w);
    }
    expect(w.phase).toBe('offseason');
    const u = userPlayer(w);
    u.contract!.endSeason = w.season.number;
    const wage = u.contract!.monthlyWage;
    const season = w.season.number;
    w = run(w, { type: 'finishWeek' });
    expect(w.season.number).toBe(season);
    expect(['negotiation', 'offseason']).toContain(w.phase);
    expect(userPlayer(w).contract!.monthlyWage).toBe(wage);
    // walking away and pressing on never loops forever: a season starts within a few presses
    for (let i = 0; i < 6 && w.season.number === season; i++) w = w.phase === 'negotiation' ? run(w, { type: 'walkAway' }) : run(w, { type: 'finishWeek' });
    expect(w.season.number).toBe(season + 1);
    expect(userPlayer(w).contract!.endSeason).toBeGreaterThan(season);
  });

  it('youth wages are small (IL youth around 2,500-8,000)', () => {
    for (const lg of start(1).leagues.filter((l) => l.countryCode === 'IL')) {
      expect(wageFor(content, lg, 16, 0.15)).toBeGreaterThanOrEqual(2500);
      expect(wageFor(content, lg, 16, 0.5)).toBeLessThanOrEqual(8000);
    }
  });
});

describe('round 3: autosave restores the exact phase', () => {
  it('BUG-05: save in event / prematch / mid-match, reload, same phase, and continuing equals continuing in memory', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 8; seed++) {
      let w = start(seed);
      for (let step = 0; step < 40; step++) {
        const reloaded = deserialize(serialize(w));
        expect(reloaded.phase).toBe(w.phase);
        expect(reloaded.inbox.length).toBe(w.inbox.length);
        seen.add(w.phase);
        const next = (x: World): World => {
          switch (x.phase) {
            case 'plan': return run(x, { type: 'setPlan', plan: ['train_finishing', 'rest', 'train_pace'] });
            case 'event': return run(x, { type: 'resolveEvent', uid: x.inbox[0].uid, optionId: x.inbox[0].options[0].id });
            case 'prematch': return run(x, { type: 'startMatch' });
            case 'match': {
              const m = x.live!.moments[x.live!.pendingMomentIndex];
              return m ? run(x, { type: 'momentResult', result: { momentId: m.id, success: true, quality: 0.7, skipped: false } }) : run(x, { type: 'simRestOfMatch' });
            }
            case 'negotiation': return run(x, { type: 'acceptNegotiation' });
            default: return run(x, { type: 'finishWeek' });
          }
        };
        const a = next(w);
        const b = next(reloaded);
        expect(serialize(b).replace(/"savedAt":\d+/, '')).toBe(serialize(a).replace(/"savedAt":\d+/, ''));
        w = a;
      }
    }
    expect(seen.has('prematch')).toBe(true);
    expect(seen.has('match')).toBe(true);
  });
});

describe('round 3: week end', () => {
  it('BUG-07/09: at most 2 near goals, progress and target in the same unit; UX-3: gains only when visible', () => {
    let w = start(5, 'W');
    let empty = 0;
    for (let week = 0; week < 20; week++) {
      w = finishWeek(toPrematch(w));
      const r = w.lastWeekReport!;
      expect(r.nearGoals.length).toBeLessThanOrEqual(2);
      for (const n of r.nearGoals) { expect(n.progress).toBeLessThan(n.target); expect(n.progress).toBeGreaterThanOrEqual(0); expect(n.text).not.toMatch(/להשער/); }
      for (const g of r.gains) expect(Math.abs(Math.round(g.after * 10) - Math.round(g.before * 10))).toBeGreaterThanOrEqual(1);
      if (!r.gains.length) { empty++; expect(r.gainsNote).toBeTruthy(); }
    }
    void empty;
    const u = userPlayer(w);
    u.attr.pace = 49.6;
    const ng = nearGoals(w).find((n) => n.text.includes('49.6'));
    if (ng) { expect(ng.progress).toBe(49.6); expect(ng.target).toBe(50); }
  });

  it('UX-4: open loops change from week to week', () => {
    let w = start(8);
    const lists: string[] = [];
    for (let week = 0; week < 12; week++) {
      w = finishWeek(toPrematch(w));
      if (w.phase !== 'plan') break;
      const loops = w.lastWeekReport!.openLoops;
      expect(loops.length).toBeGreaterThanOrEqual(1);
      expect(loops.length).toBeLessThanOrEqual(3);
      lists.push(loops.join('|'));
    }
    expect(new Set(lists).size).toBeGreaterThan(lists.length / 2);
  });

  it('UX-1: the season is as long as the user league plus a few break weeks', () => {
    const w = start(3);
    const lg = w.leagues[userClub(w)!.leagueId];
    const rounds = (lg.clubIds.length - (lg.clubIds.length % 2 ? 0 : 1)) * 2;
    expect(w.season.totalWeeks).toBeLessThanOrEqual(rounds + 3);
    for (const l of w.leagues) for (const f of w.season.fixtures[l.id]) expect(f.week).toBeLessThan(w.season.totalWeeks);
  });

  it('UX-2: events in about 2/3 of weeks', () => {
    let weeks = 0, withEvent = 0;
    for (let seed = 1; seed <= 4; seed++) {
      let w = start(seed);
      for (let i = 0; i < 20; i++) {
        w = run(w, { type: 'setPlan', plan: ['train_finishing', 'rest', 'train_pace'] });
        weeks++;
        if (w.phase === 'event') withEvent++;
        while (w.phase === 'event') w = run(w, { type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) });
        w = finishWeek(w);
        if (w.phase !== 'plan') break;
      }
    }
    expect(withEvent / weeks).toBeGreaterThan(0.45);
  });
});

describe('round 3: Hebrew and conditions', () => {
  it('BUG-11: counts, prefixes with a maqaf, money as ₪7,400', () => {
    expect(count(1, 'שער', 'שערים')).toBe('שער אחד');
    expect(count(2, 'שער', 'שערים')).toBe('2 שערים');
    expect(count(1, 'הופעה', 'הופעות', true)).toBe('הופעה אחת');
    expect(pre('ב', 3)).toBe('ב-3');
    expect(pre('ל', fmtMoney(7400))).toBe('ל-₪7,400');
    expect(pre('ל', 'מכבי')).toBe('למכבי');
    expect(fmtMoney(7400)).toBe('₪7,400');
  });

  it('rivalScoredLast and rivalGoalsSeason are condition values', () => {
    const w = start(4);
    const env = makeEnv(w, {});
    const unknown: string[] = [];
    expect(testCondition(parseCondition('rivalScoredLast == 0'), env, (m) => unknown.push(m))).toBe(true);
    expect(testCondition(parseCondition('rivalGoalsSeason >= 0'), env, (m) => unknown.push(m))).toBe(true);
    w.history.flags.rival_scored_last = 1;
    expect(testCondition(parseCondition('rivalScoredLast == 1'), makeEnv(w, {}), (m) => unknown.push(m))).toBe(true);
    expect(unknown).toEqual([]);
  });
});
