// Small shared helpers over World. Pure functions, no DOM.
import type {
  AttrKey, Attributes, Club, Footballer, League, Memory, NewsItem, Person, Position, World,
} from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const round1 = (v: number): number => Math.round(v * 10) / 10;

export const ATTR_KEYS: AttrKey[] = ['finishing', 'passing', 'dribbling', 'pace', 'stamina', 'defending', 'heading', 'vision', 'gk'];

export const ATTR_HE: Record<AttrKey, string> = {
  finishing: 'סיומת', passing: 'מסירה', dribbling: 'דריבל', pace: 'מהירות', stamina: 'סיבולת',
  defending: 'הגנה', heading: 'משחק ראש', vision: 'ראיית משחק', gk: 'שוערות',
};

export const POS_HE: Record<Position, string> = {
  GK: 'שוער', CB: 'בלם', FB: 'מגן', DM: 'קשר אחורי', CM: 'קשר', AM: 'קשר התקפי', W: 'כנף', ST: 'חלוץ',
};

/** Weight of each attribute in a position's overall. Normalised on use. */
export const POS_WEIGHTS: Record<Position, Partial<Record<AttrKey, number>>> = {
  GK: { gk: 0.85, passing: 0.05, vision: 0.05, heading: 0.05 },
  CB: { defending: 0.4, heading: 0.25, pace: 0.1, passing: 0.1, stamina: 0.1, vision: 0.05 },
  FB: { defending: 0.3, pace: 0.25, stamina: 0.15, passing: 0.15, dribbling: 0.1, heading: 0.05 },
  DM: { defending: 0.3, passing: 0.25, vision: 0.15, stamina: 0.15, heading: 0.1, pace: 0.05 },
  CM: { passing: 0.3, vision: 0.25, stamina: 0.15, defending: 0.1, dribbling: 0.1, finishing: 0.1 },
  AM: { passing: 0.2, vision: 0.3, dribbling: 0.25, finishing: 0.2, pace: 0.05 },
  W: { pace: 0.3, dribbling: 0.3, passing: 0.15, finishing: 0.15, stamina: 0.1 },
  ST: { finishing: 0.4, heading: 0.15, pace: 0.15, dribbling: 0.15, vision: 0.05, stamina: 0.1 },
};

const NORM: Record<Position, [AttrKey, number][]> = (() => {
  const out = {} as Record<Position, [AttrKey, number][]>;
  for (const pos of Object.keys(POS_WEIGHTS) as Position[]) {
    const w = POS_WEIGHTS[pos];
    let sum = 0;
    for (const k in w) sum += w[k as AttrKey] ?? 0;
    out[pos] = (Object.keys(w) as AttrKey[]).map((k) => [k, (w[k] ?? 0) / sum]);
  }
  return out;
})();

export function overallOf(attr: Attributes, pos: Position): number {
  let o = 0;
  for (const [k, w] of NORM[pos]) o += attr[k] * w;
  return o;
}
export const ovr = (p: Footballer): number => overallOf(p.attr, p.pos);
export const ovrInt = (p: Footballer): number => Math.floor(ovr(p));

export function isFootballer(p: Person | undefined): p is Footballer {
  return !!p && p.role === 'player';
}

export function player(world: World, id: number): Footballer {
  return world.people[id] as Footballer;
}
export function person(world: World, id: number | null | undefined): Person | undefined {
  return id == null ? undefined : world.people[id];
}
export function userPlayer(world: World): Footballer {
  return world.people[world.career.playerId] as Footballer;
}
export function club(world: World, id: number): Club {
  return world.clubs[id];
}
export function league(world: World, id: number): League {
  return world.leagues[id];
}
export function userClub(world: World): Club | null {
  const p = userPlayer(world);
  return p.clubId == null ? null : world.clubs[p.clubId];
}
export function userLeague(world: World): League | null {
  const c = userClub(world);
  return c ? world.leagues[c.leagueId] : null;
}

export function posGroup(pos: Position): 'GK' | 'DEF' | 'MID' | 'ATT' {
  if (pos === 'GK') return 'GK';
  if (pos === 'CB' || pos === 'FB') return 'DEF';
  if (pos === 'DM' || pos === 'CM' || pos === 'AM') return 'MID';
  return 'ATT';
}

export function relationOf(p: Person | undefined, otherId: number): number {
  if (!p) return 0;
  return p.relations[otherId]?.score ?? 0;
}

export function changeRelation(p: Person | undefined, otherId: number, delta: number, memory?: Memory): void {
  if (!p) return;
  let r = p.relations[otherId];
  if (!r) { r = { score: 0, memories: [] }; p.relations[otherId] = r; }
  r.score = clamp(r.score + delta, -100, 100);
  if (memory) {
    r.memories.push(memory);
    if (r.memories.length > 5) {
      // drop the least important (smallest |weight|), oldest first
      let idx = 0;
      for (let i = 1; i < r.memories.length; i++) if (Math.abs(r.memories[i].weight) < Math.abs(r.memories[idx].weight)) idx = i;
      r.memories.splice(idx, 1);
    }
  }
}

export function addNews(world: World, n: Omit<NewsItem, 'week' | 'absWeek'>): void {
  world.news.unshift({ week: world.season.week, absWeek: world.absWeek, ...n });
  if (world.news.length > 60) world.news.length = 60;
}

export function newId(world: World): number {
  return world.nextId++;
}

export function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}

export function seasonWeekOf(world: World, absWeek: number): { season: number; week: number } {
  const start = world.season.startAbsWeek ?? 0;
  if (absWeek >= start) return { season: world.season.number, week: absWeek - start };
  // previous seasons: approximate by totalWeeks (+1 offseason)
  const per = world.season.totalWeeks + 1;
  const back = Math.ceil((start - absWeek) / per);
  return { season: world.season.number - back, week: Math.max(0, per * back - (start - absWeek)) };
}

export function avg(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

/** Remove an id from an array in place. */
export function removeFrom(arr: number[], id: number): void {
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
}

/** Format NIS amounts one way everywhere: ₪12,500, ₪1.5 מיליון */
export function fmtMoney(n: number): string {
  const r = Math.round(n);
  if (Math.abs(r) >= 1_000_000) return `₪${(r / 1_000_000).toFixed(1).replace(/\.0$/, '')} מיליון`;
  return `₪${r.toLocaleString('en-US')}`;
}

/** Hebrew prefix letter(s) before a word: a hyphen (maqaf) when the word does not start with a Hebrew letter ("ב-3", "ל-₪7,400"). */
export function pre(prefix: string, word: string | number): string {
  const w = String(word);
  return /^[\u05D0-\u05EA]/.test(w) ? prefix + w : `${prefix}-${w}`;
}

/** Number-aware Hebrew count: "שער אחד", "2 שערים", "הופעה אחת". */
export function count(n: number, one: string, many: string, fem = false): string {
  if (n === 1) return `${one} ${fem ? 'אחת' : 'אחד'}`;
  return `${Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(1)} ${many}`;
}

/** Log a message only once per process (for content problems). */
const logged = new Set<string>();
export function logOnce(msg: string): void {
  if (logged.has(msg)) return;
  logged.add(msg);
  // eslint-disable-next-line no-console
  console.warn('[core]', msg);
}

/** Record a history entry (feeds `because` lines and `recent(tag, n)` conditions). */
export function pushHistory(world: World, tag: string, text?: string, templateId?: string, cast?: Record<string, number>): void {
  const e: { week: number; tag: string; text?: string; templateId?: string; cast?: Record<string, number> } = { week: world.absWeek, tag };
  if (text) e.text = text;
  if (templateId) e.templateId = templateId;
  if (cast) e.cast = cast;
  world.history.entries.push(e);
  if (world.history.entries.length > 300) world.history.entries.splice(0, world.history.entries.length - 300);
}
