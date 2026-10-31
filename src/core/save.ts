// Save format v2: JSON { format, version, savedAt, world }.
// NPC footballers are stored as compact tuples and fixtures as arrays; everything else as plain objects.
// The encoding round-trips exactly (NPC numbers are kept at 1 decimal by the engine).
import type { Attributes, Fixture, Footballer, Person, Position, SeasonStats, World } from './types';
import { ATTR_KEYS } from './helpers';
import { SAVE_VERSION } from './worldGen';

export const SAVE_FORMAT = 'football-career-save';

export interface SaveFile { format: string; version: number; savedAt: number; world: World | CompactWorld }

type StatT = [number, number, number, number, number];
type PlayerT = [number, string, number, string, number | null, Position, number[], number, number, number, number, StatT, StatT, Record<string, unknown>?];
type FixtureT = [number, number, number, number, number, number, Fixture['scorers']?];
interface CompactWorld extends Omit<World, 'people' | 'season'> {
  people: Record<number, Person>;
  players: PlayerT[];
  season: Omit<World['season'], 'fixtures'> & { fixtures: Record<number, FixtureT[]> };
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
  for (const k in world.people) {
    const p = world.people[k];
    if (p.role === 'player' && p.id !== world.career.playerId && compactable(p as Footballer)) players.push(encodePlayer(p as Footballer));
    else people[p.id] = p;
  }
  const userClub = (world.people[world.career.playerId] as Footballer).clubId;
  const userLeague = userClub != null ? world.clubs[userClub].leagueId : -1;
  const fixtures: Record<number, FixtureT[]> = {};
  for (const id in world.season.fixtures) {
    fixtures[id] = world.season.fixtures[id].map((f) => {
      const t: FixtureT = [f.week, f.home, f.away, f.played ? 1 : 0, f.hg, f.ag];
      // scorers only matter in the user's league (other leagues: derived data, dropped)
      if (Number(id) === userLeague && f.scorers?.length) t.push(f.scorers);
      return t;
    });
  }
  return { ...world, people, players, season: { ...world.season, fixtures } };
}

export function expandWorld(c: CompactWorld): World {
  const people: Record<number, Person | Footballer> = { ...c.people };
  for (const t of c.players) people[t[0]] = decodePlayer(t);
  const fixtures: Record<number, Fixture[]> = {};
  for (const id in c.season.fixtures) {
    fixtures[id] = c.season.fixtures[id].map((t) => {
      const f: Fixture = { week: t[0], home: t[1], away: t[2], played: t[3] === 1, hg: t[4], ag: t[5] };
      if (t[6]) f.scorers = t[6];
      return f;
    });
  }
  const { players: _p, ...rest } = c;
  void _p;
  return { ...(rest as unknown as World), people, season: { ...c.season, fixtures } };
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
  return world;
}
