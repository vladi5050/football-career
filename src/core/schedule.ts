// Fixtures (double round-robin), season calendar, transfer windows, tables, promotion/relegation.
import { pre } from './helpers';
import type { Fixture, League, Season, TableRow, World } from './types';
import type { Rng } from './rng';

/** Circle-method double round robin. Returns rounds of [home, away] pairs. */
export function doubleRoundRobin(clubIds: number[], rng: Rng): [number, number][][] {
  return roundsFromOrder(rng.shuffle(clubIds.slice()));
}

/** Rounds for a fixed (already shuffled) club order. Deterministic: the save stores only the order. */
export function roundsFromOrder(order: number[]): [number, number][][] {
  const ids = order.slice();
  const BYE = -1;
  if (ids.length % 2) ids.push(BYE);
  const n = ids.length;
  const rounds: [number, number][][] = [];
  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const round: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      // alternate home/away so no club is always home
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    // rotate all but the first
    arr.splice(1, 0, arr.pop()!);
  }
  const second = rounds.map((round) => round.map(([h, a]) => [a, h] as [number, number]));
  return rounds.concat(second);
}

/** Fixture list of a league for a season calendar (match-week slots). */
export function fixturesFromRounds(rounds: [number, number][][], slots: number[]): Fixture[] {
  const list: Fixture[] = [];
  rounds.forEach((round, r) => {
    const w = slots[Math.min(slots.length - 1, Math.floor((r * slots.length) / rounds.length))];
    for (const [home, away] of round) list.push({ week: w, home, away, played: false, hg: 0, ag: 0 });
  });
  return list;
}

export function emptyRow(clubId: number): TableRow {
  return { clubId, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] };
}

/** Season calendar: the user's league rounds plus a few break weeks (national-team breaks, preseason). */
export const SEASON_EXTRA_WEEKS = 3;

/** True when a season week is a national-team break (no league round for the user's league). */
export function isBreakWeek(week: number): boolean {
  return (week + 1) % 9 === 0;
}

/** Weeks that carry league rounds, for a season of `total` weeks with `extra` break weeks. */
export function matchWeeks(total: number, extra: number): number[] {
  const breaks = new Set<number>();
  for (let w = 0; w < total && breaks.size < extra; w++) if (isBreakWeek(w)) breaks.add(w);
  // not enough national breaks in a short season: the spare week goes at the very end (the first week always has a match)
  for (let w = total - 1; breaks.size < extra && w > 0; w--) breaks.add(w);
  const out: number[] = [];
  for (let w = 0; w < total; w++) if (!breaks.has(w)) out.push(w);
  return out;
}

export function buildSeason(world: World, rng: Rng, number: number, year: number, themes: string[], userLeagueId?: number | null): Season {
  const fixtures: Record<number, Fixture[]> = {};
  const tables: Record<number, TableRow[]> = {};
  const orders: Record<number, number[]> = {};
  const roundsBy: Record<number, [number, number][][]> = {};
  let maxRounds = 1;
  for (const lg of world.leagues) {
    orders[lg.id] = rng.shuffle(lg.clubIds.slice());
    roundsBy[lg.id] = roundsFromOrder(orders[lg.id]);
    maxRounds = Math.max(maxRounds, roundsBy[lg.id].length);
  }
  // season length follows the user's league; other leagues fit their rounds into the same match weeks (2 rounds in some weeks)
  const userRounds = userLeagueId != null && roundsBy[userLeagueId] ? roundsBy[userLeagueId].length : maxRounds;
  const totalWeeks = Math.max(1, userRounds + SEASON_EXTRA_WEEKS);
  const slots = matchWeeks(totalWeeks, SEASON_EXTRA_WEEKS);
  for (const lg of world.leagues) {
    fixtures[lg.id] = fixturesFromRounds(roundsBy[lg.id], slots);
    tables[lg.id] = lg.clubIds.map(emptyRow);
  }
  return { number, year, week: 0, totalWeeks, fixtures, tables, themes, startAbsWeek: world.absWeek, orders };
}

export function fixturesInWeek(world: World, leagueId: number, week: number): Fixture[] {
  const list = world.season.fixtures[leagueId];
  if (!list) return [];
  return list.filter((f) => f.week === week);
}

export function fixtureFor(world: World, clubId: number, week: number): Fixture | null {
  const c = world.clubs[clubId];
  const list = world.season.fixtures[c.leagueId];
  if (!list) return null;
  for (const f of list) if (f.week === week && (f.home === clubId || f.away === clubId)) return f;
  return null;
}

/** Next unplayed fixture of a club from week (inclusive). */
export function nextFixture(world: World, clubId: number, fromWeek: number): Fixture | null {
  const c = world.clubs[clubId];
  const list = world.season.fixtures[c.leagueId];
  if (!list) return null;
  let best: Fixture | null = null;
  for (const f of list) {
    if (f.played || f.week < fromWeek) continue;
    if (f.home !== clubId && f.away !== clubId) continue;
    if (!best || f.week < best.week) best = f;
  }
  return best;
}

export function applyResult(world: World, leagueId: number, f: Fixture): void {
  const table = world.season.tables[leagueId];
  if (!table) return;
  const h = table.find((r) => r.clubId === f.home);
  const a = table.find((r) => r.clubId === f.away);
  if (!h || !a) return;
  h.p++; a.p++;
  h.gf += f.hg; h.ga += f.ag; a.gf += f.ag; a.ga += f.hg;
  if (f.hg > f.ag) { h.w++; h.pts += 3; a.l++; pushForm(h, 'W'); pushForm(a, 'L'); }
  else if (f.hg < f.ag) { a.w++; a.pts += 3; h.l++; pushForm(h, 'L'); pushForm(a, 'W'); }
  else { h.d++; a.d++; h.pts++; a.pts++; pushForm(h, 'D'); pushForm(a, 'D'); }
}

function pushForm(r: TableRow, s: string): void {
  r.form.push(s);
  if (r.form.length > 5) r.form.shift();
}

/** Sorted copy: points, goal difference, goals for, wins, then club id. */
export function sortedTable(rows: TableRow[]): TableRow[] {
  return rows.slice().sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || y.w - x.w || x.clubId - y.clubId);
}

export function tablePosition(world: World, clubId: number): number {
  const c = world.clubs[clubId];
  const rows = sortedTable(world.season.tables[c.leagueId] ?? []);
  return rows.findIndex((r) => r.clubId === clubId) + 1;
}

/** Summer window: offseason + first 3 weeks. January: 2 weeks around mid-season. */
export function isWindowOpen(world: World): boolean {
  if (world.phase === 'offseason') return true;
  const w = world.season.week;
  const mid = Math.floor(world.season.totalWeeks / 2);
  return w < 3 || (w >= mid - 1 && w <= mid);
}
export function windowName(world: World): 'summer' | 'january' | null {
  if (!isWindowOpen(world)) return null;
  return world.phase === 'offseason' || world.season.week < 3 ? 'summer' : 'january';
}

function linksDown(lg: League): number[] {
  return lg.relegatesToIds ?? (lg.relegatesTo != null ? [lg.relegatesTo] : []);
}
function linksUp(lg: League): number[] {
  return lg.promotesToIds ?? (lg.promotesTo != null ? [lg.promotesTo] : []);
}

/**
 * End-of-season moves between linked leagues, including multi-group levels (e.g. one league over 3 regional groups).
 * - Each upper league U relegates its bottom `relegateSpots` into the groups listed in relegatesTo.
 * - The groups that promote into U send the same number up: each group's top `promoteSpots` first (winners), then the best
 *   next-placed clubs by points per game fill (or trim) the total.
 * - Every league keeps its size: promoted clubs fill the uppers' vacancies, relegated clubs fill the groups' vacancies,
 *   placed by region/city when possible, otherwise round-robin.
 * - Spots 0 or no links = a closed league (MLS, USL).
 * Returns Hebrew news lines.
 */
export function promoteRelegate(world: World): { lines: string[]; promoted: number[]; relegated: number[] } {
  const lines: string[] = [];
  const promoted: number[] = [];
  const relegated: number[] = [];
  const moves: { clubId: number; from: League; to: League }[] = [];
  const rowsOf = new Map<number, TableRow[]>();
  const rows = (lg: League): TableRow[] => {
    let r = rowsOf.get(lg.id);
    if (!r) { r = sortedTable(world.season.tables[lg.id] ?? []); rowsOf.set(lg.id, r); }
    return r;
  };
  const ppg = (r: TableRow): number => (r.p ? r.pts / r.p : 0) + (r.gf - r.ga) / Math.max(1, r.p) / 100;
  const moved = new Set<number>();
  // one link set per upper league
  for (const upper of world.leagues) {
    const downTo = linksDown(upper).map((id) => world.leagues[id]).filter(Boolean);
    if (!downTo.length || upper.relegateSpots <= 0) continue;
    const groups = world.leagues.filter((g) => g.id !== upper.id && linksUp(g).includes(upper.id) && g.promoteSpots > 0);
    if (!groups.length) continue;
    const ur = rows(upper);
    let n = Math.min(upper.relegateSpots, Math.max(0, ur.length - 2));
    if (groups.length === 1) n = Math.min(n, groups[0].promoteSpots, Math.max(0, rows(groups[0]).length - 2));
    if (n <= 0) continue;
    // who goes up: winners (top promoteSpots per group), then the best of the rest by points per game
    const guaranteed: { r: TableRow; g: League; place: number }[] = [];
    const rest: { r: TableRow; g: League; place: number }[] = [];
    for (const g of groups) {
      rows(g).forEach((r, i) => {
        if (moved.has(r.clubId) || i >= Math.max(1, rows(g).length - 2)) return;
        (i < g.promoteSpots ? guaranteed : rest).push({ r, g, place: i });
      });
    }
    const byRank = (a: { r: TableRow; place: number }, b: { r: TableRow; place: number }): number => a.place - b.place || ppg(b.r) - ppg(a.r);
    guaranteed.sort(byRank);
    rest.sort(byRank);
    const up = guaranteed.concat(rest).slice(0, n);
    if (up.length < n) n = up.length;
    const down = ur.slice(ur.length - n).map((r) => r.clubId);
    // relegated clubs fill the slots the promoted clubs leave, by region/city when possible
    const vacancies = up.map((u) => u.g);
    const allowed = new Set(downTo.map((l) => l.id));
    for (const id of down) {
      const c = world.clubs[id];
      let bestI = -1, bestS = -Infinity;
      vacancies.forEach((g, i) => {
        let sc = allowed.has(g.id) ? 10 : 0;
        if (c.region && (g.region === c.region || g.clubIds.some((x) => world.clubs[x].region === c.region))) sc += 5;
        if (c.city && g.clubIds.some((x) => world.clubs[x].city === c.city)) sc += 3;
        sc -= i * 0.01; // round-robin order on ties
        if (sc > bestS) { bestS = sc; bestI = i; }
      });
      const to = vacancies.splice(bestI, 1)[0] ?? downTo[0];
      moves.push({ clubId: id, from: upper, to });
      relegated.push(id);
      moved.add(id);
    }
    for (const u of up) {
      moves.push({ clubId: u.r.clubId, from: u.g, to: upper });
      promoted.push(u.r.clubId);
      moved.add(u.r.clubId);
    }
  }
  for (const m of moves) {
    const i = m.from.clubIds.indexOf(m.clubId);
    if (i >= 0) m.from.clubIds.splice(i, 1);
    m.to.clubIds.push(m.clubId);
    world.clubs[m.clubId].leagueId = m.to.id;
    const name = world.clubs[m.clubId].name;
    lines.push(m.to.tier < m.from.tier ? `${name} עולה ${pre('ל', m.to.name)}` : `${name} יורדת ${pre('ל', m.to.name)}`);
  }
  return { lines, promoted, relegated };
}
