// Builds a fresh World from content + seed. Target < 2s for ~400 clubs.
import type { Content, LeagueSeed } from './content';
import type {
  AgentArchetype, Attributes, Career, Club, CrestSpec, Footballer, League, Person, Position, Role, SeasonStats,
  TraitId, World,
} from './types';
import { makeRng, hashString, seedState, type Rng } from './rng';
import { ATTR_KEYS, POS_WEIGHTS, clamp, overallOf, changeRelation, pre } from './helpers';
import { wageFor } from './wages';

export const SAVE_VERSION = 2;

/** Balance knobs for the user's hidden potential. */
export const WORLD_TUNING = { potentialMean: 77, potentialSd: 19, potentialMin: 45, potentialMax: 97 };

export const STAFF_TRAITS: TraitId[] = [
  'hot_tempered', 'loyal', 'greedy', 'grateful', 'prefers_youth', 'hates_press', 'calm', 'ambitious',
  'jealous', 'mentor', 'superstitious', 'tactician', 'party_animal', 'workaholic', 'gossip',
];

/** 22-man squad position mix. */
export const SQUAD_MIX: Position[] = [
  'GK', 'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'FB', 'FB', 'FB', 'FB',
  'DM', 'DM', 'CM', 'CM', 'CM', 'AM', 'AM', 'W', 'W', 'ST', 'ST',
];

const FEMALE_FIRST = ['מיכל', 'נועה', 'רונית', 'אורית', 'יעל', 'שירה', 'דנה', 'תמר', 'ליאת', 'הדס', 'סיגל', 'אתי'];
const FALLBACK_FIRST = ['אלון', 'עידן', 'יוסי', 'דניאל', 'עומר', 'רועי', 'נועם', 'איתי'];
const FALLBACK_LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'שושן', 'דהן', 'חדד'];

export const emptyStats = (): SeasonStats => ({ apps: 0, goals: 0, assists: 0, ratingSum: 0, cleanSheets: 0 });

export function genName(content: Content, rng: Rng, country: string, female = false): string {
  const pool = content.names[country] ?? content.names.IL;
  const first = female ? rng.pick(FEMALE_FIRST) : rng.pick(pool?.first?.length ? pool.first : FALLBACK_FIRST);
  const last = rng.pick(pool?.last?.length ? pool.last : FALLBACK_LAST);
  return `${first} ${last}`;
}

export function genAttributes(rng: Rng, pos: Position, target: number): Attributes {
  const w = POS_WEIGHTS[pos];
  const a = {} as Attributes;
  for (const k of ATTR_KEYS) {
    let v: number;
    if (k === 'gk') v = pos === 'GK' ? target + 3 + rng.normal(0, 2) : rng.float(5, 18);
    else if (pos === 'GK') v = (w[k] ? target - 12 : target - 22) + rng.normal(0, 5);
    else v = w[k] ? target + (w[k]! * 18 - 2) + rng.normal(0, 4) : target - 10 + rng.normal(0, 6);
    a[k] = v;
  }
  for (let pass = 0; pass < 2; pass++) {
    const diff = target - overallOf(a, pos);
    for (const k of ATTR_KEYS) {
      if (pos === 'GK' ? k === 'gk' || !!w[k] : k !== 'gk') a[k] += diff;
    }
    for (const k of ATTR_KEYS) a[k] = clamp(a[k], 3, 97);
  }
  return a;
}

/** NPC numbers are kept at 1 decimal so the compact save round-trips exactly. */
export function round1Attrs(a: Attributes): Attributes {
  for (const k of ATTR_KEYS) a[k] = Math.round(a[k] * 10) / 10;
  return a;
}

export function crestFor(name: string, colors: [string, string], charge?: number): CrestSpec {
  const h = hashString(name);
  const ch = hashString(colors.join('|'));
  return [h % 6, (h >>> 3) % 10, ch % 14, charge != null ? clamp(Math.round(charge), 0, 10) : (h >>> 7) % 11];
}

export function makePerson(world: World, content: Content, rng: Rng, role: Role, country: string, age: number, clubId: number | null, opts: { female?: boolean; traits?: TraitId[] } = {}): Person {
  const traits = opts.traits ?? (rng.shuffle(STAFF_TRAITS.slice()).slice(0, 3));
  const p: Person = {
    id: world.nextId++, name: genName(content, rng, country, opts.female), role, age, nationality: country,
    traits, relations: {}, clubId,
  };
  world.people[p.id] = p;
  return p;
}

export function makeFootballer(world: World, content: Content, rng: Rng, pos: Position, age: number, target: number, potential: number, clubId: number | null, country: string): Footballer {
  const f: Footballer = {
    id: world.nextId++, name: genName(content, rng, country), role: 'player', age, nationality: country,
    traits: rng.chance(0.5) ? [rng.pick(STAFF_TRAITS)] : [], relations: {}, clubId,
    pos, attr: round1Attrs(genAttributes(rng, pos, target)), potential: Math.round(clamp(Math.max(potential, target + 1), 20, 99)),
    form: 0, fitness: rng.int(80, 100), morale: rng.int(55, 80), injury: null, contract: null, agentId: null,
    stats: emptyStats(), careerStats: emptyStats(),
  };
  world.people[f.id] = f;
  return f;
}

/** Level of a club's first XI. */
export function clubLevel(lg: League, rep: number, avgRep: number): number {
  return lg.strength + (rep - avgRep) * 0.2;
}

/** Overall for an NPC of a given age at a club of level lvl. starterSlot: true for first-XI candidates. */
function npcTarget(rng: Rng, lvl: number, age: number, starter: boolean): number {
  let t = starter ? lvl + rng.normal(1, 3) : lvl - 6 + rng.normal(0, 4);
  if (age < 21) t -= (21 - age) * 2.2;
  if (age > 32) t -= (age - 32) * 1.5;
  return clamp(t, 15, 92);
}

function npcAge(rng: Rng): number {
  // mode ~25, range 17..35
  return clamp(Math.round(rng.normal(25.5, 4.2)), 17, 36);
}

export function npcPotential(rng: Rng, ovr: number, age: number): number {
  if (age <= 18) return ovr + rng.float(8, 30);
  if (age <= 21) return ovr + rng.float(4, 18);
  if (age <= 24) return ovr + rng.float(1, 8);
  return ovr + rng.float(0, 3);
}

export function fillSquad(world: World, content: Content, rng: Rng, c: Club, lvl: number): void {
  const counts: Record<string, number> = {};
  for (const pos of SQUAD_MIX) {
    counts[pos] = (counts[pos] ?? 0) + 1;
    const starter = counts[pos] <= STARTER_SLOTS[pos];
    const age = npcAge(rng);
    const t = npcTarget(rng, lvl, age, starter);
    const country = rng.chance(0.85) ? c.countryCode : rng.pick(Object.keys(content.names).length ? Object.keys(content.names) : [c.countryCode]);
    const f = makeFootballer(world, content, rng, pos, age, t, npcPotential(rng, t, age), c.id, country);
    c.squad.push(f.id);
  }
}

/** First-XI slots per position (4-3-3 with DM/CM/AM). */
export const STARTER_SLOTS: Record<Position, number> = { GK: 1, CB: 2, FB: 2, DM: 1, CM: 1, AM: 1, W: 2, ST: 1 };

export function leagueBudget(content: Content, lg: League, rep: number): number {
  const prime = wageFor(content, lg, 26, 0.5);
  return Math.round(12 * 22 * prime * (0.45 + rep / 100));
}

/** Team-editor rename map: { format: 'football-career-names', version: 1, clubs: { [originalName]: { name?, short?, city? } } } */
export interface NamesOverride { format: 'football-career-names'; version: number; clubs: Record<string, { name?: string; short?: string; city?: string }> }

/**
 * clubsOverride: a rename map (team editor) applied to the content leagues, or a full LeagueSeed[] (fallback).
 * Renames update derby (`rival`) references. A rename that would duplicate another club's name is ignored.
 */
export function resolveLeagueSeeds(base: LeagueSeed[], override: unknown): LeagueSeed[] {
  if (Array.isArray(override)) return override.length ? (override as LeagueSeed[]) : base;
  const o = override as Partial<NamesOverride> | null | undefined;
  if (!o || typeof o !== 'object' || o.format !== 'football-career-names' || !o.clubs || typeof o.clubs !== 'object') return base;
  const leagues: LeagueSeed[] = JSON.parse(JSON.stringify(base));
  const taken = new Set(leagues.flatMap((l) => l.clubs.map((c) => c.name)));
  const renamed = new Map<string, string>();
  const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : null);
  for (const l of leagues) {
    for (const c of l.clubs) {
      const r = o.clubs[c.name];
      if (!r) continue;
      const name = clean(r.name);
      if (name && name !== c.name && !taken.has(name)) {
        taken.delete(c.name);
        taken.add(name);
        renamed.set(c.name, name);
        c.name = name;
      }
      const short = clean(r.short);
      if (short) c.short = short.slice(0, 8);
      const city = clean(r.city);
      if (city) c.city = city;
    }
  }
  for (const l of leagues) for (const c of l.clubs) if (c.rival && renamed.has(c.rival)) c.rival = renamed.get(c.rival)!;
  return leagues;
}

export interface GenOptions { pos: Position; firstName: string; lastName: string; shirt?: number; clubsOverride?: unknown }

const SHIRT_DEFAULT: Record<Position, number> = { GK: 1, CB: 4, FB: 2, DM: 6, CM: 8, AM: 10, W: 7, ST: 9 };

export function generateWorld(content: Content, seed: number, opts: GenOptions): World {
  const leagueSeeds: LeagueSeed[] = resolveLeagueSeeds(content.leagues, opts.clubsOverride);
  const world: World = {
    version: SAVE_VERSION, seed, rngState: seedState(seed), absWeek: 0,
    season: { number: 1, year: 2026, week: 0, totalWeeks: 0, fixtures: {}, tables: {}, themes: [], startAbsWeek: 0 },
    leagues: [], clubs: [], people: {}, nextId: 1,
    career: null as unknown as Career, pending: [],
    history: { entries: [], lastSeen: {}, usedVariants: {}, recentCategories: [], flags: {} },
    inbox: [], news: [], live: null, phase: 'plan', lastWeekReport: null, settings: { autoMoments: false },
  };
  const rng = makeRng(world.rngState);

  // ---- leagues + clubs
  const keyToId = new Map<string, number>();
  leagueSeeds.forEach((ls, i) => keyToId.set(ls.key, i));
  const nameToClub = new Map<string, number>();
  leagueSeeds.forEach((ls, i) => {
    const lg: League = {
      id: i, key: ls.key, name: ls.name, countryCode: ls.countryCode, country: ls.country, tier: ls.tier, clubIds: [],
      promotesTo: ls.promotesTo ? keyToId.get(ls.promotesTo) ?? null : null,
      relegatesTo: ls.relegatesTo ? keyToId.get(ls.relegatesTo) ?? null : null,
      promoteSpots: ls.promoteSpots ?? 0, relegateSpots: ls.relegateSpots ?? 0,
      strength: ls.strength, wageFactor: ls.wageFactor ?? 1, simLevel: ls.simLevel ?? 'result',
    };
    world.leagues.push(lg);
    const avgRep = ls.clubs.reduce((s, c) => s + c.reputation, 0) / Math.max(1, ls.clubs.length);
    for (const cs of ls.clubs) {
      const colors: [string, string] = [cs.colors?.[0] ?? '#888888', cs.colors?.[1] ?? '#FFFFFF'];
      const c: Club = {
        id: world.clubs.length, name: cs.name, short: cs.short ?? cs.name.slice(0, 4), city: cs.city ?? '', countryCode: ls.countryCode,
        leagueId: i, reputation: cs.reputation, budget: leagueBudget(content, lg, cs.reputation), colors,
        crest: crestFor(cs.name, colors, cs.crestCharge), managerId: 0, chairmanId: 0, squad: [], rivalClubId: null,
        stadium: cs.stadium ?? `אצטדיון ${cs.city ?? cs.name}`,
      };
      world.clubs.push(c);
      lg.clubIds.push(c.id);
      nameToClub.set(cs.name, c.id);
      const mgr = makePerson(world, content, rng, 'coach', ls.countryCode, rng.int(38, 64), c.id);
      const chair = makePerson(world, content, rng, 'chairman', ls.countryCode, rng.int(45, 72), c.id);
      c.managerId = mgr.id;
      c.chairmanId = chair.id;
      fillSquad(world, content, rng, c, clubLevel(lg, cs.reputation, avgRep));
    }
  });
  leagueSeeds.forEach((ls) => {
    for (const cs of ls.clubs) {
      if (cs.rival && nameToClub.has(cs.rival)) world.clubs[nameToClub.get(cs.name)!].rivalClubId = nameToClub.get(cs.rival)!;
    }
  });

  // ---- free managers pool, journalists, agents
  const countries = [...new Set(world.leagues.map((l) => l.countryCode))];
  for (let i = 0; i < Math.max(6, Math.round(world.clubs.length / 12)); i++) {
    makePerson(world, content, rng, 'coach', rng.pick(countries), rng.int(40, 62), null);
  }
  for (const cc of countries) for (let i = 0; i < 3; i++) makePerson(world, content, rng, 'journalist', cc, rng.int(28, 60), null);
  const agents: Person[] = [];
  const archetypes: AgentArchetype[] = ['shark', 'mentor', 'uncle'];
  for (const a of archetypes) {
    for (let i = 0; i < 2; i++) {
      const traits: TraitId[] = a === 'shark' ? ['greedy', 'ambitious', rng.pick(['hot_tempered', 'gossip', 'calm'] as TraitId[])]
        : a === 'mentor' ? ['mentor', 'loyal', rng.pick(['calm', 'workaholic', 'hates_press'] as TraitId[])]
        : ['loyal', 'grateful', rng.pick(['party_animal', 'superstitious', 'gossip'] as TraitId[])];
      const ag = makePerson(world, content, rng, 'agent', 'IL', rng.int(32, 66), null, { female: a === 'mentor', traits });
      ag.archetype = a;
      agents.push(ag);
    }
  }

  // ---- the user's start
  const pick = rollStart(world, rng, opts.pos);
  const startClub = world.clubs[pick.clubId];
  const startLeague = world.leagues[startClub.leagueId];
  const target = rng.float(35, 45);
  const potential = Math.round(clamp(rng.normal(WORLD_TUNING.potentialMean, WORLD_TUNING.potentialSd), WORLD_TUNING.potentialMin, WORLD_TUNING.potentialMax));
  const user = makeFootballer(world, content, rng, opts.pos, 16, target, potential, startClub.id, 'IL');
  user.name = `${opts.firstName} ${opts.lastName}`.trim();
  user.traits = [];
  user.fitness = 95;
  user.morale = 70;
  user.shirt = opts.shirt ?? (SHIRT_DEFAULT[opts.pos] + 20);
  startClub.squad.push(user.id);
  const agent = rng.weightedPick(agents, (a) => (a.archetype === 'uncle' ? 4 : 3))!;
  user.agentId = agent.id;
  user.contract = {
    clubId: startClub.id, monthlyWage: Math.round(wageFor(content, startLeague, 16, 0.15) / 100) * 100, endSeason: 2,
    role: 'prospect', releaseClause: null, bonuses: [{ kind: 'goal', amount: 500 }],
  };

  // ---- rival
  const rivalClubId = startClub.rivalClubId ?? pickOtherClub(rng, world, startLeague, startClub.id);
  const rivalClub = world.clubs[rivalClubId];
  const rivalPos: Position = rng.chance(0.7) ? opts.pos : adjacentPos(rng, opts.pos);
  const rival = makeFootballer(world, content, rng, rivalPos, rng.chance(0.6) ? 16 : 17, target + rng.float(-1, 4), clamp(potential + rng.float(-6, 6), 60, 94), rivalClub.id, 'IL');
  rival.traits = ['ambitious', rng.pick(['jealous', 'calm', 'hot_tempered'] as TraitId[]), rng.pick(['party_animal', 'workaholic', 'gossip'] as TraitId[])];
  rivalClub.squad.push(rival.id);
  changeRelation(rival, user.id, -5);

  // ---- family + friend
  const father = makePerson(world, content, rng, 'family', 'IL', rng.int(42, 52), null);
  father.name = `${father.name.split(' ')[0]} ${opts.lastName}`.trim();
  const mother = makePerson(world, content, rng, 'family', 'IL', rng.int(40, 50), null, { female: true });
  mother.name = `${mother.name.split(' ')[0]} ${opts.lastName}`.trim();
  const friend = makeFootballer(world, content, rng, rng.pick(['CM', 'FB', 'W', 'ST'] as Position[]), 16, target - 3, target + rng.float(5, 12), startClub.id, 'IL');
  startClub.squad.push(friend.id);
  changeRelation(father, user.id, 40);
  changeRelation(mother, user.id, 50);
  changeRelation(friend, user.id, 35);
  changeRelation(agent, user.id, 10);
  const coach = world.people[startClub.managerId];
  changeRelation(coach, user.id, coach.traits.includes('prefers_youth') ? 15 : 5);

  world.career = {
    playerId: user.id, agentId: agent.id, rivalId: rival.id, money: 2000, fame: 0, goals: [], specialties: [],
    life: { stage: 'youth', armyStatus: 'none', home: pick.kind === 'foreign_academy' ? 'rented' : 'parents', partner: null, kids: 0 },
    lastPlan: null, startKind: pick.kind, seasonsPlayed: 0, trophies: [], history: [], nationalCaps: 0, nationalGoals: 0,
    captain: false, promises: [], offers: [], negotiation: null, retired: false,
    circle: { father: father.id, mother: mother.id, friend: friend.id, firstCoach: coach.id },
    recentMinutes: [], recentRatings: [], startStory: startStory(rng, pick.kind, startClub.name, startLeague.country, opts.pos),
  };
  return world;
}

function adjacentPos(rng: Rng, pos: Position): Position {
  const adj: Record<Position, Position[]> = {
    GK: ['GK'], CB: ['CB', 'FB', 'DM'], FB: ['FB', 'CB', 'W'], DM: ['DM', 'CM', 'CB'], CM: ['CM', 'DM', 'AM'],
    AM: ['AM', 'CM', 'W'], W: ['W', 'AM', 'ST'], ST: ['ST', 'W', 'AM'],
  };
  return rng.pick(adj[pos]);
}

function pickOtherClub(rng: Rng, world: World, lg: League, notId: number): number {
  const others = lg.clubIds.filter((id) => id !== notId);
  return others.length ? rng.pick(others) : (notId + 1) % world.clubs.length;
}

interface StartPick { kind: Career['startKind']; clubId: number }

function rollStart(world: World, rng: Rng, pos: Position): StartPick {
  let wIsrael = 60, wAcademy = 25, wAbroad = 15;
  if (pos === 'GK' || pos === 'CB') { wIsrael -= 5; wAcademy += 5; }
  if (pos === 'W' || pos === 'ST') { wIsrael -= 5; wAcademy += 4; wAbroad += 1; }
  const il = world.leagues.filter((l) => l.countryCode === 'IL');
  const academyLeagues = world.leagues.filter((l) => ['BE', 'NL', 'PT'].includes(l.countryCode));
  const abroadLeagues = world.leagues.filter((l) => l.countryCode !== 'IL');
  if (!academyLeagues.length) wAcademy = 0;
  if (!abroadLeagues.length) wAbroad = 0;
  if (!il.length) wIsrael = 0;
  if (wIsrael + wAcademy + wAbroad === 0) wIsrael = 1;
  const r = rng.next() * (wIsrael + wAcademy + wAbroad);
  const kind: Career['startKind'] = r < wIsrael ? 'israel' : r < wIsrael + wAcademy ? 'foreign_academy' : 'raised_abroad';
  let pool: League[];
  if (kind === 'israel') {
    pool = il.length ? il.filter((l) => l.tier >= 2) : world.leagues;
    if (!pool.length) pool = il.length ? il : world.leagues;
  } else if (kind === 'foreign_academy') pool = academyLeagues;
  else pool = abroadLeagues;
  // lower tiers preferred; within a league, clubs with weaker depth at the position
  const minTier = Math.min(...pool.map((l) => l.tier));
  const maxTier = Math.max(...pool.map((l) => l.tier));
  const leagueW = (l: League): number => (kind === 'israel' ? 1 : 1 + (l.tier - minTier)) * (l.tier === maxTier && kind !== 'israel' ? 1.5 : 1);
  const lg = rng.weightedPick(pool, leagueW) ?? world.leagues[0];
  const clubId = rng.weightedPick(lg.clubIds, (id) => 1 + (100 - world.clubs[id].reputation) / 40)!;
  return { kind, clubId };
}

function startStory(rng: Rng, kind: Career['startKind'], clubName: string, country: string, pos: Position): string {
  const posHe: Record<Position, string> = { GK: 'שוער', CB: 'בלם', FB: 'מגן', DM: 'קשר אחורי', CM: 'קשר', AM: 'קשר התקפי', W: 'כנף', ST: 'חלוץ' };
  if (kind === 'israel') {
    return rng.pick([
      `מאמן הנוער של ${clubName} ראה אותך בטורניר שכונות ולא הפסיק להתקשר. ${posHe[pos]} בן 16, והחלום מתחיל כאן.`,
      `אבא שלך הסיע אותך לכל מבחן בארץ. ${pre('ב', clubName)} אמרו כן. עכשיו צריך להוכיח.`,
      `שיחה אחת ${pre('מ', clubName)} ופתאום אתה בסגל הנוער. בשכונה כבר מדברים עליך.`,
    ]);
  }
  if (kind === 'foreign_academy') {
    return rng.pick([
      `סקאוט של ${clubName} ראה אותך בטורניר בנתניה. שבוע אחרי זה כבר היית על מטוס ${pre('ל', country)}.`,
      `האקדמיה של ${clubName} ${pre('ב', country)} הציעה לך מקום. חדר קטן, שפה חדשה, והרבה געגועים.`,
    ]);
  }
  return rng.pick([
    `גדלת ${pre('ב', country)} במשפחה ישראלית. ${clubName} המקומית צירפה אותך לנוער, ובבית עדיין מדברים עברית.`,
    `בבית מדברים עברית, במגרש מדברים בשפה של ${country}. ${clubName} רוצה אותך בנוער.`,
  ]);
}
