// Save format v3: JSON { format, version, savedAt, world }. v1 (plain) and v2 (players/fixtures tuples) still load.
// v3 adds staff and club tuples, and stores other leagues' fixtures as results only (the list is rebuilt from season.orders).
// NPC footballers are stored as compact tuples and fixtures as arrays; everything else as plain objects.
// The encoding round-trips exactly (NPC numbers are kept at 1 decimal by the engine).
import type { Attributes, Club, Fixture, Footballer, Person, Position, SeasonStats, TableRow, World } from './types';
import { ATTR_KEYS } from './helpers';
import { SAVE_VERSION } from './worldGen';
import { SEASON_EXTRA_WEEKS, fixturesFromRounds, matchWeeks, roundsFromOrder } from './schedule';

export const SAVE_FORMAT = 'football-career-save';

export interface SaveFile { format: string; version: number; savedAt: number; world: World | CompactWorld }

type StatT = [number, number, number, number, number];
type PlayerT = [number, string, number, string, number | null, Position, number[], number, number, number, number, StatT, StatT, Record<string, unknown>?];
type FixtureT = [number, number, number, number, number, number, Fixture['scorers']?];
/** Staff without relations (coaches, chairmen, journalists far from the user). */
type StaffT = [number, string, Person['role'], number, string, Person['traits'], number | null];
/** Club: [id, name, short, city, country, league, reputation, budget, colors, crest, manager, chairman, squad, rival, stadium, extra?] */
type ClubT = [number, string, string, string, string, number, number, number, Club['colors'], Club['crest'], number, number, number[], number | null, string, { lazy?: true; region?: string }?];
/** v3: a league's fixtures as the results of its played prefix ("hg ag" base-36 pairs); the list itself comes from season.orders. */
type FixturesT = FixtureT[] | string;
interface CompactWorld extends Omit<World, 'people' | 'season' | 'clubs'> {
  people: Record<number, Person>;
  players: PlayerT[];
  staff?: StaffT[];
  clubs: (Club | ClubT)[];
  season: Omit<World['season'], 'fixtures' | 'tables'> & { fixtures: Record<number, FixturesT>; tables: Record<number, (TableRow | RowT)[]> };
}

/** Table row: [club, p, w, d, l, gf, ga, pts, form ("WDL")] */
type RowT = [number, number, number, number, number, number, number, number, string];
const encRow = (r: TableRow): TableRow | RowT => (r.form.every((f) => f.length === 1) ? [r.clubId, r.p, r.w, r.d, r.l, r.gf, r.ga, r.pts, r.form.join('')] : r);
const decRow = (t: TableRow | RowT): TableRow => (Array.isArray(t) ? { clubId: t[0], p: t[1], w: t[2], d: t[3], l: t[4], gf: t[5], ga: t[6], pts: t[7], form: t[8] ? t[8].split('') : [] } : t);

const PERSON_KEYS = new Set(['id', 'name', 'role', 'age', 'nationality', 'traits', 'relations', 'clubId']);
function staffable(p: Person): boolean {
  if (p.role === 'player' || Object.keys(p.relations).length) return false;
  for (const k in p) if (!PERSON_KEYS.has(k)) return false;
  return true;
}
const encStaff = (p: Person): StaffT => [p.id, p.name, p.role, p.age, p.nationality, p.traits, p.clubId];
const decStaff = (t: StaffT): Person => ({ id: t[0], name: t[1], role: t[2], age: t[3], nationality: t[4], traits: t[5], relations: {}, clubId: t[6] });

const CLUB_KEYS = new Set(['id', 'name', 'short', 'city', 'countryCode', 'leagueId', 'reputation', 'budget', 'colors', 'crest', 'managerId', 'chairmanId', 'squad', 'rivalClubId', 'stadium', 'lazy', 'region']);
function encClub(c: Club): Club | ClubT {
  for (const k in c) if (!CLUB_KEYS.has(k)) return c;
  const t: ClubT = [c.id, c.name, c.short, c.city, c.countryCode, c.leagueId, c.reputation, c.budget, c.colors, c.crest, c.managerId, c.chairmanId, c.squad, c.rivalClubId, c.stadium];
  const x: { lazy?: true; region?: string } = {};
  if (c.lazy) x.lazy = true;
  if (c.region != null) x.region = c.region;
  if (x.lazy || x.region != null) t.push(x);
  return t;
}
function decClub(t: Club | ClubT): Club {
  if (!Array.isArray(t)) return t;
  const c: Club = {
    id: t[0], name: t[1], short: t[2], city: t[3], countryCode: t[4], leagueId: t[5], reputation: t[6], budget: t[7], colors: t[8], crest: t[9],
    managerId: t[10], chairmanId: t[11], squad: t[12], rivalClubId: t[13], stadium: t[14],
  };
  if (t[15]?.lazy) c.lazy = true;
  if (t[15]?.region != null) c.region = t[15].region;
  return c;
}

/** Regenerated fixture list of a league (from the season's club order). */
function regenFixtures(season: World['season'], leagueId: number): Fixture[] | null {
  const order = season.orders?.[leagueId];
  if (!order) return null;
  return fixturesFromRounds(roundsFromOrder(order), matchWeeks(season.totalWeeks, SEASON_EXTRA_WEEKS));
}

/** Results-only encoding when the stored list equals the regenerated one and the played fixtures are a prefix (scorers are dropped). */
function encResults(list: Fixture[], regen: Fixture[] | null): string | null {
  if (!regen || regen.length !== list.length) return null;
  let out = '';
  let prefix = true;
  for (let i = 0; i < list.length; i++) {
    const f = list[i], g = regen[i];
    if (f.week !== g.week || f.home !== g.home || f.away !== g.away) return null;
    if (f.played) {
      if (!prefix || f.hg > 35 || f.ag > 35) return null;
      out += f.hg.toString(36) + f.ag.toString(36);
    } else {
      if (f.hg || f.ag) return null;
      prefix = false;
    }
  }
  return out;
}

const st = (s: SeasonStats): StatT => [s.apps, s.goals, s.assists, Math.round(s.ratingSum * 10), s.cleanSheets];
const unst = (t: StatT): SeasonStats => ({ apps: t[0], goals: t[1], assists: t[2], ratingSum: t[3] / 10, cleanSheets: t[4] });

function encodePlayer(p: Footballer): PlayerT {
  const extra: Record<string, unknown> = {};
  if (p.traits.length) extra.traits = p.traits;
  if (Object.keys(p.relations).length) extra.relations = p.relations;
  if (p.injury) extra.injury = p.injury;
  if (p.contract) extra.contract = p.contract;
  if (p.agentId != null) extra.agentId = p.agentId;
  if (p.retired) extra.retired = true;
  if (p.shirt != null) extra.shirt = p.shirt;
  if (p.archetype) extra.archetype = p.archetype;
  const t: PlayerT = [p.id, p.name, p.age, p.nationality, p.clubId, p.pos, ATTR_KEYS.map((k) => Math.round(p.attr[k] * 10)), p.potential, p.form, p.fitness, p.morale, st(p.stats), st(p.careerStats)];
  if (Object.keys(extra).length) t.push(extra);
  return t;
}

function decodePlayer(t: PlayerT): Footballer {
  const attr = {} as Attributes;
  ATTR_KEYS.forEach((k, i) => { attr[k] = t[6][i] / 10; });
  const x = (t[13] ?? {}) as Partial<Footballer>;
  const p: Footballer = {
    id: t[0], name: t[1], role: 'player', age: t[2], nationality: t[3], traits: x.traits ?? [], relations: x.relations ?? {}, clubId: t[4],
    pos: t[5], attr, potential: t[7], form: t[8], fitness: t[9], morale: t[10], injury: x.injury ?? null, contract: x.contract ?? null,
    agentId: x.agentId ?? null, stats: unst(t[11]), careerStats: unst(t[12]),
  };
  if (x.retired) p.retired = true;
  if (x.shirt != null) p.shirt = x.shirt;
  if (x.archetype) p.archetype = x.archetype;
  return p;
}

/** Is this NPC exactly representable as a tuple? (1-decimal attributes, integer potential) */
function compactable(p: Footballer): boolean {
  if (!Number.isInteger(p.potential)) return false;
  for (const k of ATTR_KEYS) if (Math.round(p.attr[k] * 10) / 10 !== p.attr[k]) return false;
  return Number.isInteger(p.fitness) && Number.isInteger(p.morale);
}

export function compactWorld(world: World): CompactWorld {
  const people: Record<number, Person> = {};
  const players: PlayerT[] = [];
  const staff: StaffT[] = [];
  for (const k in world.people) {
    const p = world.people[k];
    if (p.role === 'player' && p.id !== world.career.playerId && compactable(p as Footballer)) players.push(encodePlayer(p as Footballer));
    else if (staffable(p)) staff.push(encStaff(p));
    else people[p.id] = p;
  }
  const userClub = (world.people[world.career.playerId] as Footballer).clubId;
  const userLeague = userClub != null ? world.clubs[userClub].leagueId : -1;
  // scorers are kept where the game reads them: the user's league and the rival's league
  const rival = world.people[world.career.rivalId] as Footballer | undefined;
  const keep = new Set<number>([userLeague]);
  if (rival?.clubId != null && world.clubs[rival.clubId]) keep.add(world.clubs[rival.clubId].leagueId);
  const fixtures: Record<number, FixturesT> = {};
  for (const id in world.season.fixtures) {
    if (!keep.has(Number(id))) {
      const r = encResults(world.season.fixtures[id], regenFixtures(world.season, Number(id)));
      if (r != null) { fixtures[id] = r; continue; }
    }
    fixtures[id] = world.season.fixtures[id].map((f) => {
      const t: FixtureT = [f.week, f.home, f.away, f.played ? 1 : 0, f.hg, f.ag];
      // scorers only matter in the user's league (other leagues: derived data, dropped)
      if (keep.has(Number(id)) && f.scorers?.length) t.push(f.scorers);
      return t;
    });
  }
  const tables: Record<number, (TableRow | RowT)[]> = {};
  for (const id in world.season.tables) tables[id] = world.season.tables[id].map(encRow);
  return { ...world, people, players, staff, clubs: world.clubs.map(encClub), season: { ...world.season, fixtures, tables } };
}

export function expandWorld(c: CompactWorld): World {
  const people: Record<number, Person | Footballer> = { ...c.people };
  for (const t of c.players) people[t[0]] = decodePlayer(t);
  for (const t of c.staff ?? []) people[t[0]] = decStaff(t);
  const fixtures: Record<number, Fixture[]> = {};
  const season = c.season as unknown as World['season'];
  for (const id in c.season.fixtures) {
    const enc = c.season.fixtures[id];
    if (typeof enc === 'string') {
      const list = regenFixtures(season, Number(id)) ?? [];
      for (let i = 0; i * 2 < enc.length && i < list.length; i++) {
        list[i].played = true;
        list[i].hg = parseInt(enc[i * 2], 36);
        list[i].ag = parseInt(enc[i * 2 + 1], 36);
      }
      fixtures[id] = list;
      continue;
    }
    fixtures[id] = enc.map((t) => {
      const f: Fixture = { week: t[0], home: t[1], away: t[2], played: t[3] === 1, hg: t[4], ag: t[5] };
      if (t[6]) f.scorers = t[6];
      return f;
    });
  }
  const { players: _p, staff: _s, ...rest } = c;
  void _p; void _s;
  const tables: Record<number, TableRow[]> = {};
  for (const id in c.season.tables) tables[id] = c.season.tables[id].map(decRow);
  return { ...(rest as unknown as World), people, clubs: c.clubs.map(decClub), season: { ...c.season, fixtures, tables } };
}

export function serialize(world: World): string {
  const file: SaveFile = { format: SAVE_FORMAT, version: SAVE_VERSION, savedAt: Date.now(), world: compactWorld(world) };
  return JSON.stringify(file);
}

export function deserialize(json: string): World {
  const raw = JSON.parse(json) as Partial<SaveFile> | World;
  const file: SaveFile = 'format' in raw && (raw as SaveFile).format === SAVE_FORMAT
    ? (raw as SaveFile)
    : { format: SAVE_FORMAT, version: (raw as World).version ?? 1, savedAt: 0, world: raw as World };
  const w = file.world as Partial<CompactWorld>;
  if (!w || !w.career || !w.people) throw new Error('קובץ שמירה לא תקין');
  const world = Array.isArray(w.players) ? expandWorld(w as CompactWorld) : (w as unknown as World);
  return migrate(world, file.version);
}

/** Upgrade older saves. v1: plain objects (still readable). v2: compact players/fixtures (handled by expandWorld). */
export function migrate(world: World, fromVersion: number): World {
  void fromVersion;
  world.version = SAVE_VERSION;
  world.settings ??= { autoMoments: false };
  world.career.recentMinutes ??= [];
  world.career.recentRatings ??= [];
  relinkLive(world);
  return world;
}

/** A senior live match shares its Fixture object with the season list; JSON splits them, so join them again after a load. */
function relinkLive(world: World): void {
  const live = world.live;
  if (!live || live.youth) return;
  const list = world.season.fixtures[live.leagueId];
  if (!list) return;
  const i = list.findIndex((f) => f.week === live.fixture.week && f.home === live.fixture.home && f.away === live.fixture.away);
  if (i >= 0) list[i] = live.fixture;
}
