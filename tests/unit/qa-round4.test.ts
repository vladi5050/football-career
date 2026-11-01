// QA round 4 (core): parent and reserve never share a league (BUG-29), reserve teams are not a career ceiling, decision odds.
import { describe, expect, it } from 'vitest';
import { realContent } from './_content';
import { newGame } from '../../src/core/game';
import { makeRng, seedState } from '../../src/core/rng';
import { applyResult, promoteRelegate, sortedTable } from '../../src/core/schedule';
import { simFixture } from '../../src/core/matchSim';
import type { Content } from '../../src/core/content';
import type { Attributes, Command, MomentKind, MomentSpec, World } from '../../src/core/types';
import { apply } from '../../src/core/game';
import { autoOptionId } from '../../src/core/events';
import { userPlayer } from '../../src/core/helpers';
import { moveUser, openNegotiation } from '../../src/core/negotiation';
import { reserveCallUp, spawnOffer } from '../../src/core/transfers';
import { LIBRARY } from '../../src/match/decision/scenarios';
import { buildOptions, FIT_LINE, successChance } from '../../src/match/decision/resolve';

function playSeasonDirect(w: World): void {
  const rng = makeRng(w.rngState);
  for (const lg of w.leagues) for (const f of w.season.fixtures[lg.id]) if (!f.played) { simFixture(w, f, rng, false); applyResult(w, lg.id, f); }
}
const gen = (content: Content, seed = 3): World => newGame({ type: 'newCareer', seed, pos: 'ST', firstName: 'א', lastName: 'ב' }, content);
/** Puts `clubId` at the bottom of its table. */
function sink(w: World, clubId: number): void {
  const row = w.season.tables[w.clubs[clubId].leagueId].find((r) => r.clubId === clubId)!;
  row.pts = -100;
}
function noClash(w: World): void {
  for (const c of w.clubs) {
    if (c.reserveOf == null) continue;
    const rl = w.leagues[c.leagueId], pl = w.leagues[w.clubs[c.reserveOf].leagueId];
    expect(rl.countryCode === pl.countryCode && (rl.id === pl.id || rl.tier < pl.tier), `${c.name} / ${w.clubs[c.reserveOf].name}`).toBe(false);
  }
}

describe('QA round 4: BUG-29 parent and reserve team', () => {
  const cases: [string, string, (w: World, parent: number, reserve: number, sizes: number[]) => void][] = [
    // no tier below the Greek groups: the B team moves to the other regional group
    ['gr1', 'אסטראס טריפוליס', (w, parent, reserve) => {
      expect(w.leagues[w.clubs[parent].leagueId].key).toBe('gr2s');
      expect(w.leagues[w.clubs[reserve].leagueId].key).toBe('gr2n');
    }],
    // es2 has a tier below: the B team drops to it (to its own regional group unless it was already in the drop zone)
    ['es1', 'ריאל סוסיאדד', (w, parent, reserve) => {
      expect(w.leagues[w.clubs[parent].leagueId].key).toBe('es2');
      expect(w.leagues[w.clubs[reserve].leagueId].key).toMatch(/^es3/);
    }],
    // single second tier with no tier below: the parent stays up and the next club goes down
    ['nl1', 'אייאקס', (w, parent) => { expect(w.leagues[w.clubs[parent].leagueId].key).toBe('nl1'); }],
    ['pt1', 'פורטו', (w, parent) => { expect(w.leagues[w.clubs[parent].leagueId].key).toBe('pt1'); }],
  ];
  for (const [lgKey, name, check] of cases) {
    it(`${lgKey}: relegated ${name} never shares a league with its reserve team`, async () => {
      const content = await realContent();
      if (!content) return;
      for (const seed of [20261031, 7]) {
        const w = gen(content, seed);
        playSeasonDirect(w);
        const parent = w.clubs.find((c) => c.name === name)!;
        const reserve = w.clubs.find((c) => c.reserveOf === parent.id)!;
        expect(w.leagues[parent.leagueId].key).toBe(lgKey);
        sink(w, parent.id);
        const sizes = w.leagues.map((l) => l.clubIds.length);
        const res = promoteRelegate(w);
        expect(w.leagues.map((l) => l.clubIds.length)).toEqual(sizes);
        noClash(w);
        check(w, parent.id, reserve.id, sizes);
        // the drop zone still sends the same number down
        const up = w.leagues.find((l) => l.key === lgKey)!;
        expect(res.relegated.filter((id) => sortedTable(w.season.tables[up.id]).some((r) => r.clubId === id)).length).toBe(up.relegateSpots);
        for (const c of w.clubs) expect(w.leagues[c.leagueId].clubIds).toContain(c.id);
      }
    });
  }
});

describe('QA round 4: decision moments are fair for an average player', () => {
  const CTX0 = { lateClose: false, hostileCrowd: false, rivalInvolved: false, rain: false, derby: false };
  const attrs = (v: number): Attributes => ({ finishing: v, passing: v, dribbling: v, pace: v, stamina: v, defending: v, heading: v, vision: v, gk: v });
  // moment mix per position (core KINDS_BY_POS) and the in-career difficulty QA saw (W ≈ 0.55, CB ≈ 0.46)
  const MIX: Record<string, [MomentKind, number][]> = {
    W: [['dribble', 4], ['shot', 3], ['one_on_one', 2], ['cross', 2.5], ['header', 0.6], ['free_kick', 0.4]],
    CB: [['tackle', 4], ['block', 3], ['clearance', 3], ['header', 1.2], ['interception', 1]],
    GK: [['save', 5], ['rush_out', 3]],
  };
  const odds = (pos: string, difficulty: number): { best: number; all: number } => {
    let best = 0, all = 0, wsum = 0;
    for (const [kind, wt] of MIX[pos]) {
      const def = LIBRARY[kind];
      for (const v of def.variants) {
        const spec: MomentSpec = { id: 1, kind, minute: 40, difficulty, attackerSkill: 55, opponentId: 1, opponentName: 'x', context: { ...CTX0 }, scoreBefore: [0, 0], stakes: '' };
        const opts = buildOptions(def, v, spec, attrs(55));
        const w = wt / def.variants.length;
        best += w * Math.max(...opts.map((o) => (o.fit === Math.max(...opts.map((x) => x.fit)) ? o.chance : 0)));
        all += w * opts.reduce((s, o) => s + o.chance, 0) / opts.length;
        wsum += w;
      }
    }
    return { best: best / wsum, all: all / wsum };
  };
  it('winger and centre-back: the read ≈ 55-65%, all choices ≈ 35-40%', () => {
    for (const [pos, d] of [['W', 0.55], ['CB', 0.46], ['W', 0.5], ['CB', 0.5]] as const) {
      const r = odds(pos, d);
      expect(r.best, `${pos} best @${d}`).toBeGreaterThanOrEqual(0.55);
      expect(r.best, `${pos} best @${d}`).toBeLessThanOrEqual(0.65);
      expect(r.all, `${pos} all @${d}`).toBeGreaterThanOrEqual(0.35);
      expect(r.all, `${pos} all @${d}`).toBeLessThanOrEqual(0.41);
    }
  });
  it('goalkeepers keep their round-3 odds', () => {
    expect(FIT_LINE.keeper).toEqual([0.064, 0.545]);
    const r = odds('GK', 0.47);
    expect(r.best).toBeGreaterThan(0.5);
    expect(r.best).toBeLessThan(0.6);
    // the keeper flag (penalty saves) uses the keeper line too
    const s: MomentSpec = { id: 1, kind: 'penalty', minute: 40, difficulty: 0.5, attackerSkill: 55, opponentId: 1, opponentName: 'x', context: { ...CTX0 }, scoreBefore: [0, 0], stakes: '' };
    expect(successChance(0.75, 55, 2, s, true)).toBeCloseTo(0.064 + 0.545 * 0.75, 6);
  });
});

describe('QA round 4: a reserve team is a step, not a ceiling', () => {
  /**
   * Seasons a career spends at a reserve team. The player reaches one at 16-19 (start or a move) and is stubborn:
   * he rejects every offer and lets the club decide when his contract ends (the e2e career that stayed 17 seasons).
   */
  function reserveStay(content: Content, i: number): number {
    const positions = ['ST', 'W', 'CB', 'CM', 'FB', 'DM', 'AM', 'GK'] as const;
    let w = newGame({ type: 'newCareer', seed: 5000 + i, pos: positions[i % positions.length], firstName: 'א', lastName: 'ב' }, content);
    const enterAfter = i % 4; // seasons before he reaches the B team (0 = he starts there)
    const enter = (): void => {
      const u = userPlayer(w);
      if (w.clubs[u.clubId!].reserveOf != null) return;
      const rs = w.clubs.filter((c) => c.reserveOf != null);
      const target = rs[(i * 7) % rs.length];
      moveUser(w, content, target.id, 0);
      u.contract = { ...u.contract!, clubId: target.id, endSeason: w.season.number + 3 };
    };
    if (enterAfter === 0) enter();
    const run = (cmd: Command): void => { w = apply(w, cmd, content).world; };
    let seasons = 0, counted = -1, guard = 0, entered = enterAfter === 0;
    while (!w.career.retired && w.career.seasonsPlayed < 16 && guard++ < 30000) {
      if (w.phase === 'offseason' && counted !== w.season.number) {
        counted = w.season.number;
        if (entered) {
          if (w.clubs[userPlayer(w).clubId!].reserveOf == null) return seasons;
          seasons++;
        } else if (w.career.seasonsPlayed >= enterAfter) { enter(); entered = true; }
      }
      switch (w.phase) {
        case 'plan': run({ type: 'quickWeek' }); break;
        case 'event': run({ type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) }); break;
        case 'prematch': run({ type: 'startMatch' }); break;
        case 'match': run({ type: 'simRestOfMatch' }); break;
        case 'negotiation': run({ type: 'acceptNegotiation' }); break;
        default: {
          const o = w.career.offers[0];
          if (o) run({ type: 'respondOffer', offerId: o.id, action: 'reject' });
          else run({ type: 'finishWeek' });
        }
      }
    }
    return seasons;
  }

  it('over 50 careers that start in or reach a reserve team, the median stay is under 4 seasons', async () => {
    const content = await realContent();
    if (!content) return;
    const stays = Array.from({ length: 50 }, (_, i) => reserveStay(content, i)).sort((a, b) => a - b);
    expect(stays[Math.floor(stays.length / 2)], stays.join(',')).toBeLessThan(4);
    // nobody spends a career there: the B team lets him go at 21 (a 16-year-old there is out by his 6th summer at most)
    expect(stays[stays.length - 1], stays.join(',')).toBeLessThanOrEqual(6);
  }, 300_000);

  it('a good enough reserve player is called up to the parent first team at season end', async () => {
    const content = await realContent();
    if (!content) return;
    const w = gen(content, 11);
    const reserve = w.clubs.find((c) => c.reserveOf != null && w.leagues[c.leagueId].countryCode === 'BE')!;
    const u = userPlayer(w);
    moveUser(w, content, reserve.id, 0);
    u.contract!.clubId = reserve.id;
    expect(reserveCallUp(w, content)).toBeNull(); // a 16-year-old at 35-45 is not ready
    for (const k of Object.keys(u.attr) as (keyof Attributes)[]) u.attr[k] = 75;
    u.age = 19;
    const wage = u.contract!.monthlyWage;
    const line = reserveCallUp(w, content);
    expect(line).toMatch(/^עלית לקבוצה הבוגרת: /);
    expect(u.clubId).toBe(reserve.reserveOf);
    expect(u.contract!.clubId).toBe(reserve.reserveOf);
    expect(u.contract!.monthlyWage).toBeGreaterThanOrEqual(wage);
  });

  it('start rolls rarely put a 16-year-old in a reserve team', async () => {
    const content = await realContent();
    if (!content) return;
    let n = 0;
    for (let s = 0; s < 120; s++) {
      const w = gen(content, 9000 + s);
      if (w.clubs[userPlayer(w).clubId!].reserveOf != null) n++;
    }
    expect(n).toBeLessThanOrEqual(4);
  }, 120_000);

  it('reserve teams do not renew players from 23, and do not sign grown players', async () => {
    const content = await realContent();
    if (!content) return;
    const w = gen(content, 12);
    const reserve = w.clubs.find((c) => c.reserveOf != null)!;
    const u = userPlayer(w);
    moveUser(w, content, reserve.id, 0);
    u.contract!.clubId = reserve.id;
    u.contract!.endSeason = w.season.number;
    u.age = 23;
    expect(openNegotiation(w, content, makeRng(seedState(1)), reserve.id, null, 'plan')).toMatch(/לא מחדשת/);
    w.career.offers = [];
    const rng = makeRng(seedState(2));
    for (let k = 0; k < 30; k++) {
      const o = spawnOffer(w, content, rng, 'any');
      if (o) { expect(w.clubs[o.fromClubId].reserveOf).toBeUndefined(); w.career.offers = []; }
    }
  });
});
