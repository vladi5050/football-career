// Headless balance runner.
//   npm run sim -- --careers 200 --seasons 24 --seed 1
// Prints league averages, a sample final table and the career outcome distribution.
// Content: src/content/*.json when present (missing files fall back to tests/fixtures/content.min.json).
// The player policy is "human-like": moves only for a clearly better deal, at most once per window,
// sometimes stays out of loyalty after a good season, retires between 33 and 38.
import type { Content } from '../src/core/content';
import type { Command, Footballer, Position, SquadRole, TransferOffer, World } from '../src/core/types';
import { normalizeContent } from '../src/core/contentLoad';
import { apply, newGame } from '../src/core/game';
import { makeRng, seedState, type Rng } from '../src/core/rng';
import { avg, ovr } from '../src/core/helpers';
import { sortedTable, windowName } from '../src/core/schedule';
import { selectXI } from '../src/core/matchSim';

declare const process: { argv: string[]; cwd(): string; env: Record<string, string | undefined> };

type FsLike = { existsSync(p: string): boolean; readFileSync(p: string, enc: string): string };

export async function loadContent(root?: string): Promise<{ content: Content; source: string }> {
  const modName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ modName)) as FsLike;
  const base = root ?? process.cwd();
  const fixture = JSON.parse(fs.readFileSync(`${base}/tests/fixtures/content.min.json`, 'utf8')) as Content;
  const parts: Record<string, unknown> = {};
  const used: string[] = [];
  for (const k of ['leagues', 'names', 'wages', 'themes', 'events'] as const) {
    const p = `${base}/src/content/${k}.json`;
    if (fs.existsSync(p)) { parts[k] = JSON.parse(fs.readFileSync(p, 'utf8')); used.push(`src/${k}`); }
    else { parts[k] = (fixture as unknown as Record<string, unknown>)[k]; used.push(`fixture/${k}`); }
  }
  return { content: normalizeContent(parts as never), source: used.join(', ') };
}

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

export interface CareerOutcome {
  pos: Position; peakOverall: number; clubs: number; abroad: boolean; goals: number; apps: number; seasons: number; caps: number;
  trophies: number; retiredAge: number; startKind: string; bigLeague: boolean; maxStrength: number; stalledIL2: boolean;
}

export interface LeagueAgg { matches: number; goals: number; homeWins: number; draws: number }

const ROLE_RANK: Record<SquadRole, number> = { backup: 0, prospect: 1, rotation: 2, starter: 3, star: 4 };

/** Would a sensible human take this offer? */
function wantsOffer(world: World, o: TransferOffer, pr: Rng): boolean {
  const u = world.people[world.career.playerId] as Footballer;
  const cur = u.clubId != null ? world.clubs[u.clubId] : null;
  if (!cur) return true;
  const to = world.clubs[o.fromClubId];
  const curLg = world.leagues[cur.leagueId], toLg = world.leagues[to.leagueId];
  const curRole = u.contract?.role ?? 'backup';
  const curWage = u.contract?.monthlyWage ?? 0;
  const expiring = !!u.contract && u.contract.endSeason <= world.season.number;
  const mins = world.career.recentMinutes ?? [];
  const benched = mins.length >= 3 && avg(mins) < 35 && u.age >= 19;
  const homesick = toLg.countryCode !== curLg.countryCode && toLg.countryCode !== 'IL' && pr.chance(0.3);
  if (homesick && !expiring) return false;
  // clearly higher level, and a real role there
  if (toLg.strength >= curLg.strength + 4 && ROLE_RANK[o.role] >= ROLE_RANK.rotation) return true;
  // a starting role and +20% money
  if (ROLE_RANK[o.role] >= ROLE_RANK.starter && ROLE_RANK[curRole] < ROLE_RANK.starter && o.wage >= curWage * 1.2) return true;
  // not playing: take minutes elsewhere
  if (benched && ROLE_RANK[o.role] >= ROLE_RANK.rotation) return true;
  if (expiring && o.wage >= curWage) return true;
  return false;
}

/** Run one career to retirement (or maxSeasons) with a human-like policy. */
export function runCareer(content: Content, seed: number, maxSeasons: number, agg?: LeagueAgg, onSeasonEnd?: (w: World) => void, pos?: Position): CareerOutcome {
  const pr = makeRng(seedState(seed ^ 0x5bd1e995));
  const positions: Position[] = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];
  const p0 = pos ?? pr.pick(positions);
  let world = newGame({ type: 'newCareer', seed, pos: p0, firstName: 'דני', lastName: 'בדיקה' }, content);
  const clubs = new Set<number>();
  let peak = 0, abroad = false, maxStrength = 0, maxILTier = 99;
  let guard = 0, counted = 0;
  let movedWindow = '';
  let loyalSeason = -1;
  let retireChecked = -1;
  const run = (cmd: Command): void => { world = apply(world, cmd, content).world; };
  const track = (): void => {
    const u = world.people[world.career.playerId] as Footballer;
    peak = Math.max(peak, ovr(u));
    if (u.clubId == null) return;
    clubs.add(u.clubId);
    const lg = world.leagues[world.clubs[u.clubId].leagueId];
    if (lg.countryCode !== 'IL') abroad = true;
    else maxILTier = Math.min(maxILTier, lg.tier);
    if ((u.stats.apps > 0 || world.season.week > 5) && lg.strength > maxStrength) maxStrength = lg.strength;
  };
  const windowKey = (): string => `${world.season.number}-${windowName(world) ?? 'none'}`;
  while (!world.career.retired && world.career.seasonsPlayed < maxSeasons && guard++ < 20000) {
    track();
    const u = world.people[world.career.playerId] as Footballer;
    switch (world.phase) {
      case 'plan': case 'event': run({ type: 'quickWeek' }); break;
      case 'prematch': run({ type: 'startMatch' }); break;
      case 'match': run({ type: 'simRestOfMatch' }); break;
      case 'postmatch':
      case 'weekend': {
        const offer = world.career.offers[0];
        if (offer) {
          const take = movedWindow !== windowKey() && wantsOffer(world, offer, pr);
          run({ type: 'respondOffer', offerId: offer.id, action: take ? 'negotiate' : 'reject' });
          break;
        }
        run({ type: 'finishWeek' });
        break;
      }
      case 'negotiation': {
        const n = world.career.negotiation!;
        if (n.round === 1 && pr.chance(0.5)) {
          const [lo, hi] = n.agentRange;
          run({ type: 'negotiate', demand: { wage: Math.round(pr.float(lo, (lo + hi) / 2)), role: n.currentOffer.role as SquadRole, years: n.currentOffer.years, releaseClause: null } });
        } else {
          const before = u.clubId;
          run({ type: 'acceptNegotiation' });
          if ((world.people[world.career.playerId] as Footballer).clubId !== before) movedWindow = windowKey();
        }
        break;
      }
      case 'offseason': {
        if (counted !== world.season.number) {
          counted = world.season.number;
          onSeasonEnd?.(world);
          if (agg) for (const lg of world.leagues) for (const f of world.season.fixtures[lg.id] ?? []) {
            if (!f.played) continue;
            agg.matches++; agg.goals += f.hg + f.ag;
            if (f.hg > f.ag) agg.homeWins++; else if (f.hg === f.ag) agg.draws++;
          }
          // a good season sometimes buys loyalty
          const last = world.career.history[world.career.history.length - 1];
          if (last && last.avgRating >= 6.9 && last.apps >= 20 && pr.chance(0.45)) loyalSeason = world.season.number;
        }
        if (retireChecked !== world.season.number && u.age >= 33) {
          retireChecked = world.season.number;
          const club = u.clubId != null ? world.clubs[u.clubId] : null;
          const fading = club ? ovr(u) < selectXI(world, club.id, u.id).overall - 5 : false;
          const p = [0.2, 0.3, 0.45, 0.6, 0.75][Math.min(4, u.age - 33)] + (fading ? 0.25 : 0);
          if (pr.chance(p)) { run({ type: 'retire' }); break; }
        }
        const offer = world.career.offers[0];
        if (offer) {
          const take = loyalSeason !== world.season.number && movedWindow !== windowKey() && wantsOffer(world, offer, pr);
          run({ type: 'respondOffer', offerId: offer.id, action: take ? 'negotiate' : 'reject' });
          break;
        }
        run({ type: 'finishWeek' });
        break;
      }
      default: run({ type: 'finishWeek' });
    }
  }
  track();
  const u = world.people[world.career.playerId] as Footballer;
  return {
    pos: p0, peakOverall: Math.round(peak), clubs: clubs.size, abroad, goals: u.careerStats.goals, apps: u.careerStats.apps, seasons: world.career.seasonsPlayed,
    caps: world.career.nationalCaps, trophies: world.career.trophies.length, retiredAge: u.age, startKind: world.career.startKind,
    bigLeague: maxStrength >= 75, maxStrength, stalledIL2: !abroad && maxILTier >= 2,
  };
}

export interface BatchResult { outs: CareerOutcome[]; agg: LeagueAgg; sampleTable: string[]; ms: number }

/** Run n careers with positions cycling through all 8 (mix). */
export function runMany(content: Content, n: number, seed: number, seasons = 24): BatchResult {
  const agg: LeagueAgg = { matches: 0, goals: 0, homeWins: 0, draws: 0 };
  const outs: CareerOutcome[] = [];
  let sampleTable: string[] = [];
  const positions: Position[] = ['ST', 'W', 'AM', 'CM', 'DM', 'FB', 'CB', 'GK'];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    outs.push(runCareer(content, seed + i, seasons, agg, (w) => {
      if (i !== 0 || sampleTable.length) return;
      const u = w.people[w.career.playerId] as Footballer;
      const lgId = u.clubId != null ? w.clubs[u.clubId].leagueId : 0;
      sampleTable = [`${w.leagues[lgId].name}, עונה ${w.season.number}`, ...sortedTable(w.season.tables[lgId]).map((r, k) =>
        `${String(k + 1).padStart(2)}. ${w.clubs[r.clubId].name.padEnd(18)} ${r.p} ${r.w}-${r.d}-${r.l} ${r.gf}:${r.ga} ${r.pts}`)];
    }, positions[i % positions.length]));
  }
  return { outs, agg, sampleTable, ms: Date.now() - t0 };
}

export function quantile(vals: number[], p: number): number {
  const s = vals.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export function summary(outs: CareerOutcome[]): Record<string, number> {
  const frac = (f: (o: CareerOutcome) => boolean): number => outs.filter(f).length / Math.max(1, outs.length);
  const st = outs.filter((o) => o.pos === 'ST').map((o) => o.goals);
  const w = outs.filter((o) => o.pos === 'W').map((o) => o.goals);
  return {
    peakP10: quantile(outs.map((o) => o.peakOverall), 0.1), peakMedian: quantile(outs.map((o) => o.peakOverall), 0.5), peakP90: quantile(outs.map((o) => o.peakOverall), 0.9),
    abroad: frac((o) => o.abroad), bigLeague: frac((o) => o.bigLeague), capped: frac((o) => o.caps > 0), stalledIL2: frac((o) => o.stalledIL2),
    clubsMedian: quantile(outs.map((o) => o.clubs), 0.5), stGoalsMedian: st.length ? quantile(st, 0.5) : 0, wGoalsMedian: w.length ? quantile(w, 0.5) : 0,
    retireP25: quantile(outs.map((o) => o.retiredAge), 0.25), retireMedian: quantile(outs.map((o) => o.retiredAge), 0.5), retireP75: quantile(outs.map((o) => o.retiredAge), 0.75),
    trophy: frac((o) => o.trophies > 0),
  };
}

function pct(n: number): string { return `${(100 * n).toFixed(1)}%`; }
function dist(vals: number[]): string {
  return `p10 ${quantile(vals, 0.1)} | p25 ${quantile(vals, 0.25)} | median ${quantile(vals, 0.5)} | p75 ${quantile(vals, 0.75)} | p90 ${quantile(vals, 0.9)}`;
}

async function main(): Promise<void> {
  const careers = arg('careers', 40);
  const seasons = arg('seasons', 24);
  const seed = arg('seed', 1);
  const { content, source } = await loadContent();
  console.log(`content: ${source}`);
  const { outs, agg, sampleTable, ms } = runMany(content, careers, seed, seasons);
  console.log(`\n=== ${careers} careers, ${ms} ms (${(ms / Math.max(1, careers)).toFixed(0)} ms/career) ===`);
  console.log(`\nLeague averages over ${agg.matches} matches:`);
  console.log(`  goals/match ${(agg.goals / Math.max(1, agg.matches)).toFixed(2)} | home win ${pct(agg.homeWins / agg.matches)} | draw ${pct(agg.draws / agg.matches)} | away win ${pct((agg.matches - agg.homeWins - agg.draws) / agg.matches)}`);
  console.log('\nSample final table:');
  for (const l of sampleTable) console.log('  ' + l);
  const s = summary(outs);
  console.log('\nCareer outcomes:');
  console.log(`  peak overall:  ${dist(outs.map((o) => o.peakOverall))}`);
  console.log(`  clubs:         ${dist(outs.map((o) => o.clubs))}`);
  console.log(`  apps:          ${dist(outs.map((o) => o.apps))}`);
  console.log(`  retire age:    ${dist(outs.map((o) => o.retiredAge))}`);
  for (const p of ['ST', 'W', 'AM', 'CM', 'CB', 'GK'] as Position[]) {
    const g = outs.filter((o) => o.pos === p).map((o) => o.goals);
    if (g.length) console.log(`  goals ${p.padEnd(3)}     ${dist(g)}`);
  }
  console.log(`  abroad ${pct(s.abroad)} | league strength>=75 ${pct(s.bigLeague)} | capped ${pct(s.capped)} | stalled in IL tier 2+ ${pct(s.stalledIL2)} | any trophy ${pct(s.trophy)}`);
  const byStart: Record<string, number> = {};
  for (const o of outs) byStart[o.startKind] = (byStart[o.startKind] ?? 0) + 1;
  console.log(`  start kinds: ${Object.entries(byStart).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`\nSUMMARY ${JSON.stringify(s)}`);
}

const isMain = typeof process !== 'undefined' && !process.env.SIM_NO_MAIN && (process.argv.some((a) => a.endsWith('simRunner.ts')) || (process.argv[1] ?? '').includes('vite-node'));
if (isMain) void main();
