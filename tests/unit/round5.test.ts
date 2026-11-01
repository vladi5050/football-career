// QA round 3 (core): regional relegation, reserve teams, Hebrew counts, teenager roles, "המועדון יחליט" terms, small leagues.
import { describe, expect, it } from 'vitest';
import { fixtureContent, realContent } from './_content';
import { apply, newGame } from '../../src/core/game';
import { makeRng } from '../../src/core/rng';
import { normRegion, ovr, userPlayer } from '../../src/core/helpers';
import { applyResult, legsFor, promoteRelegate, sortedTable } from '../../src/core/schedule';
import { simFixture } from '../../src/core/matchSim';
import { updateGoals, nearGoals } from '../../src/core/goals';
import { clubViewRole, clubXiLevel } from '../../src/core/negotiation';
import { autoOptionId } from '../../src/core/events';
import { deserialize, serialize } from '../../src/core/save';
import type { Content } from '../../src/core/content';
import type { Command, World } from '../../src/core/types';

function playSeasonDirect(w: World): void {
  const rng = makeRng(w.rngState);
  for (const lg of w.leagues) for (const f of w.season.fixtures[lg.id]) if (!f.played) { simFixture(w, f, rng, false); applyResult(w, lg.id, f); }
}
const gen = (content: Content, seed = 3): World => newGame({ type: 'newCareer', seed, pos: 'ST', firstName: 'א', lastName: 'ב' }, content);

describe('QA round 3 (core)', () => {
  it('BUG-23: relegated Israeli clubs go to their own regional group; group clubs carry the group region', async () => {
    const content = await realContent();
    if (!content) return;
    for (const seed of [3, 4, 5, 6]) {
      const w = gen(content, seed);
      const il2 = w.leagues.find((l) => l.key === 'il2')!;
      const n3 = w.leagues.find((l) => l.key === 'il3n')!, s3 = w.leagues.find((l) => l.key === 'il3s')!;
      for (const id of n3.clubIds) expect(w.clubs[id].region).toBe('צפון');
      playSeasonDirect(w);
      const rows = sortedTable(w.season.tables[il2.id]);
      const [a, b] = rows.slice(-2).map((r) => w.clubs[r.clubId]);
      // content says 'north' / 'south'; the club with no region must not take the slot the regional club needs
      delete a.region;
      b.region = normRegion(seed % 2 ? 'south' : 'north');
      promoteRelegate(w);
      const want = seed % 2 ? s3 : n3;
      expect(want.clubIds).toContain(b.id);
      expect(il2.clubIds).not.toContain(a.id);
      expect(n3.clubIds.length).toBe(16);
      expect(s3.clubIds.length).toBe(16);
    }
  });

  it('BUG-23: two relegated clubs from different regions both land at home', async () => {
    const content = await realContent();
    if (!content) return;
    const w = gen(content, 8);
    const il2 = w.leagues.find((l) => l.key === 'il2')!;
    playSeasonDirect(w);
    const [a, b] = sortedTable(w.season.tables[il2.id]).slice(-2).map((r) => w.clubs[r.clubId]);
    a.region = 'דרום'; b.region = 'צפון';
    promoteRelegate(w);
    expect(w.leagues[a.leagueId].key).toBe('il3s');
    expect(w.leagues[b.leagueId].key).toBe('il3n');
  });

  it('BUG-24: a reserve team never goes up into its parent league; the next eligible club does', () => {
    const content = fixtureContent();
    const w = gen(content, 4);
    const il1 = w.leagues.find((l) => l.key === 'il1')!, il2 = w.leagues.find((l) => l.key === 'il2')!;
    playSeasonDirect(w);
    const top = sortedTable(w.season.tables[il2.id]).map((r) => r.clubId);
    const reserve = w.clubs[top[0]];
    reserve.reserveOf = il1.clubIds.find((id) => !sortedTable(w.season.tables[il1.id]).slice(-il1.relegateSpots).some((r) => r.clubId === id))!;
    const sizes = [il1.clubIds.length, il2.clubIds.length];
    const res = promoteRelegate(w);
    expect(res.promoted).not.toContain(reserve.id);
    expect(il2.clubIds).toContain(reserve.id);
    for (const id of top.slice(1, 1 + il2.promoteSpots)) expect(res.promoted).toContain(id);
    expect([il1.clubIds.length, il2.clubIds.length]).toEqual(sizes);
    // the save keeps the link
    expect(deserialize(serialize(w)).clubs[reserve.id].reserveOf).toBe(reserve.reserveOf);
  });

  it('BUG-26: "שער אחד העונה", and one bar when the first goal and the season goal ask for the same goal', () => {
    const w = gen(fixtureContent(), 5);
    const u = userPlayer(w);
    u.pos = 'FB';
    u.careerStats.apps = 6;
    w.career.goals = [];
    updateGoals(w);
    expect(w.career.goals.some((g) => g.id.startsWith('season_goals_'))).toBe(false); // no career goal yet: only "first goal"
    u.careerStats.goals = 1;
    w.career.goals = [];
    updateGoals(w);
    const sg = w.career.goals.find((g) => g.id.startsWith('season_goals_'));
    expect(sg?.text).toBe('שער אחד העונה');
    for (const n of nearGoals(w)) expect(n.text).not.toMatch(/(^|\D)1 (שערים|הופעות|שבועות|חודשים)/);
    const texts = nearGoals(w).map((n) => n.text);
    expect(texts.filter((t) => /עוד שער אחד/.test(t)).length).toBeLessThanOrEqual(1);
  });

  it('teenagers at senior clubs are prospects or rotation unless far above the XI', () => {
    const w = gen(fixtureContent(), 6);
    const u = userPlayer(w);
    const club = w.clubs.find((c) => c.id !== u.clubId && c.squad.length)!;
    const lvl = clubXiLevel(w, club.id, u.id);
    const setOvr = (target: number): void => { for (let i = 0; i < 40 && Math.abs(ovr(u) - target) > 0.3; i++) for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] += (target - ovr(u)) / 2; };
    u.age = 17;
    setOvr(lvl + 6);
    expect(clubViewRole(w, club.id, u)).toBe('starter');
    setOvr(lvl + 1);
    expect(clubViewRole(w, club.id, u)).toBe('rotation');
    setOvr(lvl - 8);
    expect(clubViewRole(w, club.id, u)).toBe('prospect');
    setOvr(lvl + 14);
    expect(clubViewRole(w, club.id, u)).toBe('starter'); // a teenager is never the club's star
    u.age = 24;
    setOvr(lvl + 6);
    expect(clubViewRole(w, club.id, u)).toBe('star');
  });

  it('"המועדון יחליט" says what was signed: club, wage, role, years', () => {
    const content = fixtureContent();
    let w = gen(content, 17);
    const run = (c: Command): { world: World; toast?: string[] } => apply(w, c, content);
    let g = 0;
    while (w.phase !== 'offseason' && g++ < 400) {
      if (w.phase === 'plan') w = run({ type: 'quickWeek' }).world;
      else if (w.phase === 'event') w = run({ type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) }).world;
      else if (w.phase === 'negotiation') w = run({ type: 'walkAway' }).world;
      else if (w.phase === 'prematch') w = run({ type: 'startMatch' }).world;
      else if (w.phase === 'match') w = run({ type: 'simRestOfMatch' }).world;
      else w = run({ type: 'finishWeek' }).world;
    }
    userPlayer(w).contract!.endSeason = w.season.number;
    const out = run({ type: 'finishWeek' });
    const t = (out.toast ?? []).join(' | ');
    expect(t).toMatch(/המועדון החליט: .+, ₪[\d,]+ לחודש, (כוכב|הרכב|רוטציה|כישרון צעיר|ספסל), ל(שנה אחת|-\d+ שנים)|אף אחד לא סגר איתך/);
  }, 60_000);

  it('small leagues play 3-4 round robins and the save regenerates them', async () => {
    expect([legsFor(8), legsFor(10), legsFor(11), legsFor(12), legsFor(14), legsFor(20)]).toEqual([4, 4, 3, 3, 2, 2]);
    const content = await realContent();
    if (!content) return;
    const w = gen(content, 9);
    const small = w.leagues.filter((l) => l.clubIds.length <= 12);
    expect(small.length).toBeGreaterThan(0);
    for (const lg of small) {
      const n = lg.clubIds.length;
      expect(w.season.fixtures[lg.id].length).toBe((n * (n - 1) * legsFor(n)) / 2);
    }
    playSeasonDirect(w);
    const back = deserialize(serialize(w));
    for (const lg of small) expect(back.season.fixtures[lg.id].map((f) => [f.week, f.home, f.away, f.hg, f.ag])).toEqual(w.season.fixtures[lg.id].map((f) => [f.week, f.home, f.away, f.hg, f.ag]));
    // an older save (seasons built before multi-leg) still decodes as a double round robin
    const old = JSON.parse(serialize(w));
    delete old.world.season.multiLeg;
    for (const lg of small) old.world.season.fixtures[lg.id] = '';
    const ob = deserialize(JSON.stringify(old));
    for (const lg of small) expect(ob.season.fixtures[lg.id].length).toBe(lg.clubIds.length * (lg.clubIds.length - 1));
  });
});
