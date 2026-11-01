// Round 4: a real-size world pyramid (synthetic ~1,230 clubs): lazy squads, multi-group promotion, closed leagues,
// budgets (generation, quick week, save size), the Israeli start, offers across the pyramid, and QA round-2 items.
import { describe, expect, it } from 'vitest';
import { fixtureContent, largeContent } from './_content';
import { apply, buildView, newGame, potentialRange } from '../../src/core/game';
import { makeRng } from '../../src/core/rng';
import { ovr, userClub, userPlayer } from '../../src/core/helpers';
import { promoteRelegate, sortedTable } from '../../src/core/schedule';
import { simFixture } from '../../src/core/matchSim';
import { applyResult } from '../../src/core/schedule';
import { spawnOffer } from '../../src/core/transfers';
import { moveUser, negotiateRound, openNegotiation } from '../../src/core/negotiation';
import { autoOptionId } from '../../src/core/events';
import { deserialize, serialize } from '../../src/core/save';
import { applyTraining, nearAttrGoals, trackAttrProgress } from '../../src/core/development';
import { dematerializeStale, materializeClub } from '../../src/core/worldGen';
import type { Content } from '../../src/core/content';
import type { Command, World } from '../../src/core/types';

const large: Content = largeContent();
const gen = (seed: number, content = large): World => newGame({ type: 'newCareer', seed, pos: 'ST', firstName: 'א', lastName: 'ב' }, content);

function step(w: World, content: Content): World {
  const run = (c: Command): World => apply(w, c, content).world;
  switch (w.phase) {
    case 'plan': return run({ type: 'quickWeek' });
    case 'event': return run({ type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) });
    case 'prematch': return run({ type: 'startMatch' });
    case 'match': return run({ type: 'simRestOfMatch' });
    case 'negotiation': return run({ type: 'acceptNegotiation' });
    default: return run({ type: 'finishWeek' });
  }
}

/** Play every fixture of the season directly (no user), then promote/relegate. */
function finishSeasonDirect(w: World): void {
  const rng = makeRng(w.rngState);
  for (const lg of w.leagues) for (const f of w.season.fixtures[lg.id]) if (!f.played) { simFixture(w, f, rng, false); applyResult(w, lg.id, f); }
}

describe('world pyramid (round 4)', () => {
  it('generates ~1,230 clubs fast, with result-only leagues lazy', () => {
    gen(1);
    const t0 = performance.now();
    const w = gen(2);
    const ms = performance.now() - t0;
    expect(w.clubs.length).toBeGreaterThan(1200);
    expect(ms).toBeLessThan(800);
    const lazy = w.clubs.filter((c) => c.lazy);
    expect(lazy.length).toBeGreaterThan(900);
    for (const c of lazy) expect(w.leagues[c.leagueId].simLevel).not.toBe('full');
    // the user's league is always real
    for (const id of w.leagues[userClub(w)!.leagueId].clubIds) expect(w.clubs[id].lazy).toBeFalsy();
  });

  it('a quick week stays under 60ms and the save under 2MB (UTF-8) after 3 seasons', () => {
    let w = gen(3);
    let maxWeek = 0, total = 0, weeks = 0, g = 0;
    while (w.career.seasonsPlayed < 3 && g++ < 5000) {
      const t = performance.now();
      const ph = w.phase;
      w = step(w, large);
      if (ph === 'plan') { const d = performance.now() - t; total += d; weeks++; maxWeek = Math.max(maxWeek, d); }
    }
    expect(total / weeks).toBeLessThan(60);
    const bytes = new TextEncoder().encode(serialize(w)).length;
    expect(bytes).toBeLessThan(2 * 1024 * 1024);
    // and it round-trips
    const back = deserialize(serialize(w));
    expect(serialize(back).replace(/"savedAt":\d+/, '')).toBe(serialize(w).replace(/"savedAt":\d+/, ''));
  }, 120_000);

  it('multi-group promotion: winners + best runner-up go up, relegated clubs fill the vacated group slots, sizes stay', () => {
    const w = gen(4);
    finishSeasonDirect(w);
    const key = (k: string) => w.leagues.find((l) => l.key === k)!;
    const sizes = w.leagues.map((l) => l.clubIds.length);
    const it2 = key('it2');
    const groups = ['itca', 'itcb', 'itcc'].map(key);
    const winners = groups.map((g) => sortedTable(w.season.tables[g.id])[0].clubId);
    const it2Bottom = sortedTable(w.season.tables[it2.id]).slice(-4).map((r) => r.clubId);
    const mls = key('us1');
    const mlsBefore = mls.clubIds.slice().sort();
    const r = promoteRelegate(w);
    expect(w.leagues.map((l) => l.clubIds.length)).toEqual(sizes);
    for (const id of winners) expect(it2.clubIds).toContain(id);
    // 3 group winners + the best runner-up = 4 up for 4 down
    expect(r.promoted.filter((id) => w.clubs[id].leagueId === it2.id && !winners.includes(id)).length).toBe(1);
    for (const id of it2Bottom) expect(groups.map((g) => g.id)).toContain(w.clubs[id].leagueId);
    expect(r.promoted.length).toBeGreaterThan(0);
    // closed leagues never change
    expect(mls.clubIds.slice().sort()).toEqual(mlsBefore);
    // Israel: tier-2 relegations go to the regional tier-3 groups, tier-4 group winners go up to their own region
    const il3 = ['il3n', 'il3s'].map(key);
    for (const g of il3) for (const id of g.clubIds) expect(w.clubs[id].leagueId).toBe(g.id);
    for (const k of ['il4a', 'il4b']) for (const id of key(k).clubIds) expect(w.clubs[id].region).toBe('צפון');
  });

  it('Israeli starts: mostly tier 1-2 academies, some tier 3; foreign academies abroad', () => {
    const tiers: Record<number, number> = {};
    const academy: Record<string, number> = {};
    for (let s = 0; s < 150; s++) {
      const w = gen(100 + s);
      const c = userClub(w)!;
      const lg = w.leagues[c.leagueId];
      if (w.career.startKind === 'israel') tiers[lg.tier] = (tiers[lg.tier] ?? 0) + 1;
      if (w.career.startKind === 'foreign_academy') academy[lg.countryCode] = (academy[lg.countryCode] ?? 0) + 1;
    }
    const il = Object.values(tiers).reduce((a, b) => a + b, 0);
    expect(((tiers[1] ?? 0) + (tiers[2] ?? 0)) / il).toBeGreaterThan(0.65);
    expect(tiers[3] ?? 0).toBeGreaterThan(0);
    expect(Object.keys(academy).length).toBeGreaterThan(2);
  });

  it('offers come from anywhere in the pyramid, lazy clubs are generated on demand, Israelis go to the usual places', () => {
    const w = gen(5);
    const u = userPlayer(w);
    u.age = 24;
    for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] = 60;
    const rng = makeRng(w.rngState);
    const by: Record<string, number> = {};
    for (let i = 0; i < 120; i++) {
      w.career.offers = [];
      const o = spawnOffer(w, large, rng, 'abroad');
      if (!o) continue;
      const c = w.clubs[o.fromClubId];
      expect(c.lazy).toBeFalsy(); // materialised when it asked
      expect(c.squad.length).toBeGreaterThanOrEqual(22);
      by[c.countryCode] = (by[c.countryCode] ?? 0) + 1;
    }
    const usual = ['BE', 'NL', 'CY', 'GR', 'AT', 'PL', 'US'].reduce((s, k) => s + (by[k] ?? 0), 0);
    const total = Object.values(by).reduce((a, b) => a + b, 0);
    expect(usual / total).toBeGreaterThan(0.35);
    // a veteran at a top Israeli club gets offers from lower tiers too
    moveUser(w, large, w.leagues.find((l) => l.key === 'il1')!.clubIds[3], 0);
    w.history.flags.last_move_week = -100;
    for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] = 55;
    u.age = 33;
    let low = 0;
    for (let i = 0; i < 80; i++) {
      w.career.offers = [];
      const o = spawnOffer(w, large, rng, 'lower');
      if (o && w.leagues[w.clubs[o.fromClubId].leagueId].tier >= 2) low++;
    }
    expect(low).toBeGreaterThan(5);
  });

  it('a move materialises the whole new league', () => {
    const w = gen(6);
    const lazyLeague = w.leagues.find((l) => l.clubIds.every((id) => w.clubs[id].lazy))!;
    const rng = makeRng(w.rngState);
    const offer = { id: 999999, fromClubId: lazyLeague.clubIds[0], fee: 0, wage: 9000, role: 'starter' as const, years: 2, expiresWeek: 99, viaAgentNote: '' };
    w.career.offers = [offer];
    const r = openNegotiation(w, large, rng, offer.fromClubId, offer, 'plan');
    expect(typeof r).not.toBe('string');
    w.phase = 'negotiation';
    const back = apply(w, { type: 'acceptNegotiation' }, large).world;
    expect(userPlayer(back).clubId).toBe(offer.fromClubId);
    for (const id of lazyLeague.clubIds) expect(back.clubs[id].lazy).toBeFalsy();
  });
});

describe('QA round 2 items (core)', () => {
  const content = fixtureContent();

  it('BUG-15: career clubs and the career story are in the View', () => {
    let w = gen(7, content);
    let g = 0;
    while (w.career.seasonsPlayed < 2 && g++ < 3000) w = step(w, content);
    const v = buildView(w);
    for (const h of w.career.history) expect(v.careerClubs![h.clubId]).toBeTruthy();
    expect(v.careerClubs![userClub(w)!.id]).toBeTruthy();
    expect(v.careerStory).toBeTruthy();
    expect(v.careerStory!.keyPerson ?? '').toMatch(/^$|[א-ת]/);
  }, 60_000);

  it('BUG-16: the scout range brackets what is reachable and narrows with age', () => {
    const w = gen(8, content);
    const u = userPlayer(w);
    for (const age of [16, 20, 24, 28, 32]) {
      u.age = age;
      const [lo, hi] = potentialRange(w, u);
      expect(lo).toBeLessThanOrEqual(hi);
      expect(hi).toBeLessThanOrEqual(Math.max(Math.floor(ovr(u)), u.potential) + 9);
      if (age >= 28) expect(hi).toBeLessThanOrEqual(Math.floor(ovr(u)) + 4);
    }
  });

  it('BUG-17: two asks inside the agent range never collapse the talks', () => {
    let ok = 0;
    for (let s = 1; s <= 20; s++) {
      const w = gen(s, content);
      const u = userPlayer(w);
      u.age = 22;
      u.contract!.endSeason = 1;
      const rng = makeRng(w.rngState);
      if (typeof openNegotiation(w, content, rng, userClub(w)!.id, null, 'plan') === 'string') continue;
      const n = w.career.negotiation!;
      const top = n.agentRange[1];
      negotiateRound(w, content, rng, { wage: top, role: n.currentOffer.role, years: 3, releaseClause: null });
      negotiateRound(w, content, rng, { wage: top, role: n.currentOffer.role, years: 3, releaseClause: null });
      expect(n.status).not.toBe('walked_away');
      ok++;
    }
    expect(ok).toBeGreaterThan(5);
  });

  it('BUG-19: collapsed renewal talks expose renewalBlockedUntil', () => {
    const w = gen(9, content);
    const u = userPlayer(w);
    u.age = 22;
    u.contract!.endSeason = 1;
    const rng = makeRng(w.rngState);
    if (typeof openNegotiation(w, content, rng, userClub(w)!.id, null, 'plan') === 'string') return;
    const n = w.career.negotiation!;
    negotiateRound(w, content, rng, { wage: n.hiddenCeiling * 5, role: 'star', years: 3, releaseClause: null });
    if (n.status === 'open') negotiateRound(w, content, rng, { wage: n.hiddenCeiling * 5, role: 'star', years: 3, releaseClause: null });
    expect(n.status).toBe('walked_away');
    expect(buildView(w).career.renewalBlockedUntil).toBeGreaterThan(w.absWeek);
  });

  it('BUG-20: a called-up regular collects caps in the international breaks', () => {
    let w = gen(10, content);
    const u = userPlayer(w);
    u.age = 24;
    for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] = 82;
    let g = 0;
    while (w.career.seasonsPlayed < 1 && g++ < 2000) w = step(w, content);
    expect(w.career.nationalCaps).toBeGreaterThanOrEqual(3);
  }, 60_000);

  it('save size stays flat: background clubs drop their squads again, referenced people stay', () => {
    const w = gen(12);
    const lazy = w.clubs.find((c) => c.lazy && c.leagueId !== userClub(w)!.leagueId)!;
    materializeClub(w, large, lazy.id);
    expect(lazy.lazy).toBeUndefined();
    const kept = lazy.squad[0];
    w.career.circle = { ...(w.career.circle ?? {}), friend: kept };
    const dropped = lazy.squad[1];
    expect(dematerializeStale(w)).toBeGreaterThan(0);
    expect(lazy.lazy).toBe(true);
    expect(w.people[kept]).toBeDefined();
    expect(lazy.squad).toContain(kept);
    expect(w.people[dropped]).toBeUndefined();
    expect(userClub(w)!.lazy).toBeUndefined();
  });

  it('training: a 16-year-old sees a visible weekly gain on what he trains', () => {
    const w = gen(13);
    const u = userPlayer(w);
    const rng = makeRng(w.rngState);
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      u.injury = null;
      const before = u.attr.dribbling;
      applyTraining(w, ['train_dribbling', 'train_pace', 'rest'], rng);
      sum += u.attr.dribbling - before;
      w.absWeek++;
    }
    expect(u.age).toBeLessThanOrEqual(17);
    expect(sum / 12).toBeGreaterThanOrEqual(0.25);
    expect(sum / 12).toBeLessThanOrEqual(0.8);
  });

  it('near goals follow what moves: untrained gets a hint, a stalled one rotates out after 3 weeks', () => {
    const w = gen(14);
    const u = userPlayer(w);
    u.pos = 'W';
    u.attr.dribbling = 39.5;
    w.career.lastPlan = ['train_passing', 'train_vision', 'rest'];
    trackAttrProgress(w);
    let g = nearAttrGoals(w).find((n) => n.key === 'dribbling');
    expect(g?.text).toContain('תאמן דריבל השבוע כדי לסגור את זה');
    w.absWeek += 3;
    trackAttrProgress(w);
    expect(nearAttrGoals(w).some((n) => n.key === 'dribbling')).toBe(false);
    // training it brings it back as soon as it moves
    w.career.lastPlan = ['train_dribbling', 'train_pace', 'rest'];
    u.attr.dribbling = 39.8;
    trackAttrProgress(w);
    g = nearAttrGoals(w).find((n) => n.key === 'dribbling');
    expect(g?.trained).toBe(true);
    expect(g?.text).not.toContain('תאמן');
  });
});
