// Events engine: eligibility (conditions + cast), weights, silence, variants, placeholders,
// `because` lines, effects (closed list), chains and promises.
import type { Content, EventTemplate } from './content';
import type { ActiveEvent, EventOutcome, Footballer, Goal, Person, Position, SquadRole, TraitId, World } from './types';
import type { Rng } from './rng';
import { parseCondition, testCondition, type Ast, type EvalEnv } from './conditions';
import {
  ATTR_HE, addNews, changeRelation, clamp, fmtMoney, firstName, logOnce, ovr, pushHistory, relationOf, seasonWeekOf, userClub, userLeague, userPlayer,
} from './helpers';
import { changePersistence, injureUser, persistenceOf } from './development';
import { fixtureFor, isWindowOpen, nextFixture } from './schedule';
import { spawnOffer } from './transfers';

export const EVENT_TUNING = {
  silenceShare: 0.4, // silence weight = share x total weight  -> about 1/3 of weeks silent (chains fill some)
  recentPenalty: 0.3,
  recentWeeks: 3,
  defaultCooldown: 12,
  maxPerWeek: 2,
};

// ------------------------------------------------------------------ compile (once per template)

export type Effect =
  | { k: 'rel'; role: string; d: number }
  | { k: 'stat'; key: 'morale' | 'fame' | 'money' | 'form' | 'fitness' | 'potential' | 'persistence'; d: number }
  | { k: 'attr'; key: string; d: number }
  | { k: 'flag'; name: string; d: number; set: boolean }
  | { k: 'memory'; role: string; tag: string; weight: number }
  | { k: 'history'; tag: string }
  | { k: 'promise'; role: string; weeks: number; tag: string }
  | { k: 'injury'; weeks: number }
  | { k: 'goal'; kind: string; target: number; text: string }
  | { k: 'news'; text: string }
  | { k: 'offer'; kind: string }
  | { k: 'squadRole'; role: SquadRole }
  | { k: 'unknown'; src: string };

interface Compiled { when: Ast[]; effects: Record<string, Effect[]> }
const compiled = new WeakMap<EventTemplate, Compiled>();
const byIdCache = new WeakMap<Content, Map<string, EventTemplate>>();

export function parseEffect(src: string): Effect {
  const s = src.trim();
  let m = /^(\w+)\s*\(\s*([^)]*?)\s*\)\s*(\+=|-=|=)\s*(-?[\d.]+)$/.exec(s);
  if (m) {
    const [, fn, arg, op, num] = m;
    const n = parseFloat(num) * (op === '-=' ? -1 : 1);
    if (fn === 'rel') return { k: 'rel', role: arg, d: n };
    if (fn === 'attr') return { k: 'attr', key: arg, d: n };
    if (fn === 'flag') return { k: 'flag', name: arg, d: n, set: op === '=' };
    return { k: 'unknown', src: s };
  }
  m = /^(\w+)\s*(\+=|-=|=)\s*(-?[\d.]+)$/.exec(s);
  if (m) {
    const [, key, op, num] = m;
    const n = parseFloat(num) * (op === '-=' ? -1 : 1);
    if (['morale', 'fame', 'money', 'form', 'fitness', 'potential', 'persistence'].includes(key)) return { k: 'stat', key: key as 'morale', d: n };
    return { k: 'unknown', src: s };
  }
  m = /^(\w+)\s*\(([\s\S]*)\)$/.exec(s);
  if (m) {
    const [, fn, rawArgs] = m;
    const parts = rawArgs.split(',').map((x) => x.trim());
    switch (fn) {
      case 'memory': return { k: 'memory', role: parts[0], tag: parts[1] ?? 'memory', weight: parseFloat(parts[2] ?? '5') || 5 };
      case 'history': return { k: 'history', tag: parts[0] };
      case 'promise': return { k: 'promise', role: parts[0], weeks: parseInt(parts[1] ?? '4', 10) || 4, tag: parts[2] ?? 'promise' };
      case 'injury': return { k: 'injury', weeks: parseInt(parts[0] ?? '1', 10) || 1 };
      case 'goal': return { k: 'goal', kind: parts[0], target: parseFloat(parts[1] ?? '1') || 1, text: parts.slice(2).join(', ').replace(/^["']|["']$/g, '') };
      case 'news': return { k: 'news', text: rawArgs.trim().replace(/^["']|["']$/g, '') };
      case 'offer': return { k: 'offer', kind: parts[0] || 'any' };
      case 'squadRole': return { k: 'squadRole', role: (['star', 'starter', 'rotation', 'prospect', 'backup'].includes(parts[0]) ? parts[0] : 'rotation') as SquadRole };
    }
  }
  return { k: 'unknown', src: s };
}

export function compileTemplate(t: EventTemplate): Compiled {
  let c = compiled.get(t);
  if (c) return c;
  const when = (t.when ?? []).map((w) => {
    const ast = parseCondition(w);
    if (ast.t === 'never') logOnce(`event ${t.id}: ${ast.reason}`);
    return ast;
  });
  const effects: Record<string, Effect[]> = {};
  for (const o of t.options ?? []) {
    effects[o.id] = (o.effects ?? []).map((e) => {
      const ef = parseEffect(e);
      if (ef.k === 'unknown') logOnce(`event ${t.id}: unknown effect "${e}"`);
      return ef;
    });
  }
  c = { when, effects };
  compiled.set(t, c);
  return c;
}

/** Parse every template now (call once after loading content). */
export function compileEvents(content: Content): void {
  for (const t of content.events) compileTemplate(t);
  templateById(content, '');
}

export function templateById(content: Content, id: string): EventTemplate | undefined {
  let m = byIdCache.get(content);
  if (!m) { m = new Map(content.events.map((t) => [t.id, t])); byIdCache.set(content, m); }
  return m.get(id);
}

// ------------------------------------------------------------------ cast selectors

export const SELECTORS = ['coach', 'agent', 'rival', 'teammate', 'captain', 'youngster', 'veteran', 'journalist', 'chairman', 'father', 'mother', 'friend', 'opp_coach', 'first_coach'];

const journalistCache = new WeakMap<World, number[]>();
function journalists(world: World): Person[] {
  let ids = journalistCache.get(world);
  if (!ids) {
    ids = [];
    for (const k in world.people) if (world.people[k].role === 'journalist') ids.push(world.people[k].id);
    journalistCache.set(world, ids);
  }
  return ids.map((id) => world.people[id]).filter(Boolean);
}

export function selectPerson(world: World, selector: string, rng: Rng | null, exclude: Set<number>): number | null {
  const user = userPlayer(world);
  const club = userClub(world);
  const mates = (): Footballer[] => (club ? club.squad.filter((id) => id !== user.id && !exclude.has(id)).map((id) => world.people[id] as Footballer).filter(Boolean) : []);
  const alive = (id: number | undefined | null): number | null => (id != null && world.people[id] && !exclude.has(id) ? id : null);
  switch (selector) {
    case 'coach': return alive(club?.managerId);
    case 'chairman': return alive(club?.chairmanId);
    case 'agent': return alive(world.career.agentId);
    case 'rival': { const r = world.people[world.career.rivalId] as Footballer | undefined; return r && !r.retired ? alive(r.id) : null; }
    case 'father': return alive(world.career.circle?.father);
    case 'mother': return alive(world.career.circle?.mother);
    case 'friend': return alive(world.career.circle?.friend);
    case 'first_coach': return alive(world.career.circle?.firstCoach);
    case 'teammate': { const m = mates(); return m.length ? (rng ? rng.pick(m).id : m[0].id) : null; }
    case 'captain': { const m = mates(); if (!m.length) return null; return m.reduce((b, p) => (ovr(p) + p.age > ovr(b) + b.age ? p : b)).id; }
    case 'youngster': { const m = mates(); if (!m.length) return null; return m.reduce((b, p) => (p.age < b.age ? p : b)).id; }
    case 'veteran': { const m = mates(); if (!m.length) return null; return m.reduce((b, p) => (p.age > b.age ? p : b)).id; }
    case 'journalist': {
      const cc = club?.countryCode ?? 'IL';
      const js: Person[] = journalists(world).filter((p) => !exclude.has(p.id));
      const local = js.filter((p) => p.nationality === cc);
      const pool = local.length ? local : js;
      if (!pool.length) return null;
      // stable-ish: prefer the journalist with the strongest relation, otherwise random
      return rng ? rng.pick(pool).id : pool[0].id;
    }
    case 'opp_coach': {
      if (!club) return null;
      const f = nextFixture(world, club.id, world.season.week);
      if (!f) return null;
      const opp = world.clubs[f.home === club.id ? f.away : f.home];
      return alive(opp.managerId);
    }
  }
  logOnce(`unknown cast selector '${selector}'`);
  return null;
}

function castFor(world: World, t: EventTemplate, rng: Rng | null, base: Record<string, number> = {}): Record<string, number> | null {
  const cast: Record<string, number> = { ...base };
  const used = new Set<number>(Object.values(cast));
  for (const [role, sel] of Object.entries(t.cast ?? {})) {
    if (cast[role] != null && world.people[cast[role]]) continue;
    const id = selectPerson(world, sel, rng, used);
    if (id == null) return null;
    cast[role] = id;
    used.add(id);
  }
  return cast;
}

// ------------------------------------------------------------------ condition env

export function makeEnv(world: World, cast: Record<string, number>): EvalEnv {
  const user = userPlayer(world);
  const roleId = (role: string): number | null => (cast[role] != null ? cast[role] : SELECTORS.includes(role) ? selectPerson(world, role, null, new Set()) : null);
  return {
    value(name) {
      switch (name) {
        case 'overall': return ovr(user);
        case 'age': return user.age;
        case 'fame': return world.career.fame;
        case 'money': return world.career.money;
        case 'form': return user.form;
        case 'morale': return user.morale;
        case 'fitness': return user.fitness;
        case 'persistence': return persistenceOf(world);
        case 'seasonWeek': return world.season.week + 1;
        case 'season': return world.season.number;
        case 'absWeek': return world.absWeek;
        case 'injured': return user.injury ? 1 : 0;
        case 'tier': return userLeague(world)?.tier ?? 0;
        case 'foreign': return userLeague(world) && userLeague(world)!.countryCode !== 'IL' ? 1 : 0;
        case 'starter': return world.career.lastMatch?.started ? 1 : 0;
        case 'lastResult': return world.career.lastMatch?.result ?? 0;
        case 'lastRating': return world.career.lastMatch?.rating ?? 0;
        case 'goalsSeason': return user.stats.goals;
        case 'rivalScoredLast': return world.history.flags.rival_scored_last ?? 0;
        case 'rivalGoalsSeason': { const r = world.people[world.career.rivalId] as Footballer | undefined; return r && !r.retired ? r.stats.goals : 0; }
        case 'window': return isWindowOpen(world) ? 1 : 0;
        case 'derbyNext': {
          const c = userClub(world);
          if (!c) return 0;
          const f = fixtureFor(world, c.id, world.season.week);
          return f && (f.home === c.rivalClubId || f.away === c.rivalClubId) ? 1 : 0;
        }
        case 'hasOffer': return world.career.offers.length ? 1 : 0;
        case 'contractLeft': return user.contract ? Math.max(0, user.contract.endSeason - world.season.number) : 0;
        case 'true': return 1;
        case 'false': return 0;
      }
      return undefined;
    },
    call(name, args) {
      const a0 = String(args[0] ?? '');
      switch (name) {
        case 'rel': { const id = roleId(a0); return id == null ? 0 : relationOf(world.people[id], user.id); }
        case 'attr': { const v = (user.attr as unknown as Record<string, number>)[a0]; return v === undefined ? undefined : v; }
        case 'flag': return world.history.flags[a0] ?? 0;
        case 'trait': { const id = roleId(a0); const p = id != null ? world.people[id] : undefined; return p && p.traits.includes(String(args[1]) as TraitId) ? 1 : 0; }
        case 'theme': return world.season.themes.includes(a0) ? 1 : 0;
        case 'recent': {
          const weeks = Number(args[1] ?? 4);
          const from = world.absWeek - weeks;
          for (let i = world.history.entries.length - 1; i >= 0; i--) {
            const e = world.history.entries[i];
            if (e.week < from) break;
            if (e.tag === a0 || e.templateId === a0) return 1;
          }
          return 0;
        }
        case 'stage': return world.career.life.stage === a0 ? 1 : 0;
        case 'pos': return user.pos === (a0 as Position) ? 1 : 0;
        case 'seen': return world.history.lastSeen[a0] != null ? 1 : 0;
      }
      return undefined;
    },
  };
}

// ------------------------------------------------------------------ weights

const TRAIT_CAT: Partial<Record<TraitId, Record<string, number>>> = {
  hot_tempered: { discipline: 1.5, pressure: 1.3, team: 1.2 },
  loyal: { transfer: 0.7, team: 1.2 },
  greedy: { money: 1.6, agent: 1.4, transfer: 1.3 },
  grateful: { family: 1.2, team: 1.1 },
  prefers_youth: { minutes: 1.4 },
  hates_press: { media: 1.5 },
  calm: { discipline: 0.7, pressure: 0.8 },
  ambitious: { transfer: 1.4, rival: 1.3 },
  jealous: { rival: 1.6, team: 1.2 },
  mentor: { minutes: 1.2, life: 1.2 },
  superstitious: { pressure: 1.2, life: 1.1 },
  tactician: { minutes: 1.3 },
  party_animal: { discipline: 1.3, team: 1.4 },
  workaholic: { discipline: 0.8, injury: 1.2 },
  gossip: { media: 1.5, rival: 1.2 },
};

function recentCategory(world: World, category: string): boolean {
  const from = world.absWeek - EVENT_TUNING.recentWeeks;
  for (const s of world.history.recentCategories) {
    const i = s.indexOf('|');
    if (Number(s.slice(0, i)) >= from && s.slice(i + 1) === category) return true;
  }
  return false;
}

export function eventWeight(world: World, content: Content, t: EventTemplate, cast: Record<string, number>): number {
  let w = t.weight ?? 10;
  for (const id of Object.values(cast)) {
    const p = world.people[id];
    if (!p) continue;
    for (const tr of p.traits) w *= TRAIT_CAT[tr]?.[t.category] ?? 1;
  }
  for (const th of world.season.themes) {
    const theme = content.themes.find((x) => x.id === th);
    w *= theme?.categoryBoost?.[t.category] ?? 1;
  }
  if (recentCategory(world, t.category)) w *= EVENT_TUNING.recentPenalty;
  return w;
}

function eligibleBase(world: World, t: EventTemplate): boolean {
  if (!t.variants?.length || !t.options?.length) return false;
  const last = world.history.lastSeen[t.id];
  if (last != null) {
    if (t.once) return false;
    if (world.absWeek - last < (t.cooldown ?? EVENT_TUNING.defaultCooldown)) return false;
  }
  const used = world.history.usedVariants[t.id] ?? [];
  return used.length < t.variants.length;
}

function conditionsHold(world: World, t: EventTemplate, cast: Record<string, number>): boolean {
  const c = compileTemplate(t);
  if (!c.when.length) return true;
  const env = makeEnv(world, cast);
  for (const ast of c.when) if (!testCondition(ast, env, (msg) => logOnce(`event ${t.id}: ${msg}`))) return false;
  return true;
}

/** All templates eligible right now (for debugging + tests). */
export function eligibleTemplates(world: World, content: Content, rng: Rng): { t: EventTemplate; cast: Record<string, number>; w: number }[] {
  const out: { t: EventTemplate; cast: Record<string, number>; w: number }[] = [];
  if (world.career.retired) return out;
  for (const t of content.events) {
    if (t.chainOnly || !eligibleBase(world, t)) continue;
    const cast = castFor(world, t, rng);
    if (!cast) continue;
    if (!conditionsHold(world, t, cast)) continue;
    const w = eventWeight(world, content, t, cast);
    if (w > 0) out.push({ t, cast, w });
  }
  return out;
}

// ------------------------------------------------------------------ instantiate

export function fillText(world: World, text: string, cast: Record<string, number>): string {
  const user = userPlayer(world);
  const club = userClub(world);
  const lg = userLeague(world);
  let opp = '';
  if (club) {
    const f = nextFixture(world, club.id, world.season.week);
    if (f) opp = world.clubs[f.home === club.id ? f.away : f.home].name;
  }
  return text.replace(/\{(\w+)\}/g, (all, key: string) => {
    switch (key) {
      case 'player': return user.name;
      case 'first': return firstName(user.name);
      case 'club': return club?.name ?? '';
      case 'league': return lg?.name ?? '';
      case 'opp': return opp || 'היריבה';
      case 'week': return String(world.season.week + 1);
      case 'age': return String(user.age);
      case 'because': return '';
    }
    const id = cast[key];
    if (id != null && world.people[id]) return world.people[id].name;
    if (SELECTORS.includes(key)) {
      const pid = selectPerson(world, key, null, new Set());
      if (pid != null) return world.people[pid].name;
    }
    return all;
  })
    // a lone prefix letter before a number or a non-Hebrew word takes a maqaf ("ב-3", "ל-7,400")
    .replace(/(^|[\s(])([בלמהו])(?=[0-9₪A-Za-z])/g, '$1$2-');
}

export function becauseLine(world: World, tag: string | undefined): string | null {
  if (!tag) return null;
  for (let i = world.history.entries.length - 1; i >= 0; i--) {
    const e = world.history.entries[i];
    if (e.tag !== tag && e.templateId !== tag) continue;
    if (e.week === world.absWeek) continue; // not from this very week
    const sw = seasonWeekOf(world, e.week);
    const when = sw.season === world.season.number ? `בשבוע ${sw.week + 1}` : sw.season === world.season.number - 1 ? 'בעונה שעברה' : `בעונה ${sw.season}`;
    return `כי ${when} ${e.text ?? 'זה קרה'}`;
  }
  return null;
}

function instantiate(world: World, t: EventTemplate, cast: Record<string, number>, rng: Rng): ActiveEvent | null {
  const used = world.history.usedVariants[t.id] ?? [];
  const free = t.variants.map((_, i) => i).filter((i) => !used.includes(i));
  if (!free.length) return null;
  const vi = rng.pick(free);
  world.history.usedVariants[t.id] = [...used, vi];
  const v = t.variants[vi];
  world.history.lastSeen[t.id] = world.absWeek;
  world.history.recentCategories.push(`${world.absWeek}|${t.category}`);
  if (world.history.recentCategories.length > 12) world.history.recentCategories.shift();
  const ev: ActiveEvent = {
    uid: world.nextId++, templateId: t.id, title: fillText(world, v.title, cast), body: fillText(world, v.body, cast),
    because: becauseLine(world, t.because), cast,
    options: t.options.map((o) => ({ id: o.id, text: fillText(world, o.text, cast), ...(o.hint ? { hint: fillText(world, o.hint, cast) } : {}) })),
    week: world.absWeek, category: t.category,
  };
  return ev;
}

/** Roll this week's events into world.inbox: due chains + 0..1 random (max 2 total). */
export function rollWeekEvents(world: World, content: Content, rng: Rng): ActiveEvent[] {
  const out: ActiveEvent[] = [];
  if (world.career.retired) return out;
  // due chains
  const due = world.pending.filter((p) => p.atWeek <= world.absWeek);
  world.pending = world.pending.filter((p) => p.atWeek > world.absWeek);
  for (const d of due) {
    const t = templateById(content, d.templateId);
    if (!t) { logOnce(`chain to unknown event '${d.templateId}'`); continue; }
    if (out.length >= EVENT_TUNING.maxPerWeek) { world.pending.push({ ...d, atWeek: world.absWeek + 1 }); continue; }
    const cast = castFor(world, t, rng, d.cast);
    if (!cast || !conditionsHold(world, t, cast)) continue;
    if (d.flags) for (const [k, v] of Object.entries(d.flags)) world.history.flags[k] = v;
    const ev = instantiate(world, t, cast, rng);
    if (ev) out.push(ev);
  }
  // random event (or silence)
  if (out.length < EVENT_TUNING.maxPerWeek && !(out.length && rng.chance(0.5))) {
    const cands = eligibleTemplates(world, content, rng);
    if (cands.length) {
      const total = cands.reduce((s, c) => s + c.w, 0);
      const silence = total * EVENT_TUNING.silenceShare;
      let r = rng.next() * (total + silence);
      if (r >= silence) {
        r -= silence;
        let chosen = cands[cands.length - 1];
        for (const c of cands) { r -= c.w; if (r < 0) { chosen = c; break; } }
        const ev = instantiate(world, chosen.t, chosen.cast, rng);
        if (ev) out.push(ev);
      }
    }
  }
  world.inbox.push(...out);
  return out;
}

/** Force an event by id (debug menu). */
export function forceEvent(world: World, content: Content, id: string, rng: Rng): ActiveEvent | null {
  const t = templateById(content, id);
  if (!t) return null;
  const cast = castFor(world, t, rng);
  if (!cast) return null;
  const ev = instantiate(world, t, cast, rng);
  if (ev) world.inbox.push(ev);
  return ev;
}

// ------------------------------------------------------------------ resolve + effects

export interface ResolveOut { notes: string[]; outcome?: EventOutcome }

export function resolveEvent(world: World, content: Content, uid: number, optionId: string, rng: Rng): ResolveOut {
  const idx = world.inbox.findIndex((e) => e.uid === uid);
  if (idx < 0) return { notes: [] };
  const ev = world.inbox[idx];
  world.inbox.splice(idx, 1);
  const t = templateById(content, ev.templateId);
  if (!t) return { notes: [] };
  const opt = t.options.find((o) => o.id === optionId) ?? t.options[0];
  const text = `(${ev.title}) בחרת: ${fillText(world, opt.text, ev.cast)}`;
  pushHistory(world, t.id, text, t.id, ev.cast);
  pushHistory(world, `${t.id}.${opt.id}`, text, t.id);
  const before = snapshot(world, ev.cast);
  if (t.category === 'discipline') changePersistence(world, -1); // the incident itself says something about habits
  const notes = applyEffects(world, content, compileTemplate(t).effects[opt.id] ?? [], ev.cast, rng, text);
  for (const ch of opt.chain ?? []) {
    world.pending.push({ templateId: ch.event, atWeek: world.absWeek + Math.max(1, ch.after), cast: { ...ev.cast } });
  }
  addNewsForBig(world, t.category, ev.title);
  const outcome = describeOutcome(world, before, compileTemplate(t).effects[opt.id] ?? [], ev.cast, notes);
  return { notes, outcome: { title: ev.title, choice: fillText(world, opt.text, ev.cast), lines: outcome, followUp: (opt.chain?.length ?? 0) > 0 } };
}

function addNewsForBig(world: World, category: string, title: string): void {
  if (category === 'media' || category === 'transfer' || category === 'national') addNews(world, { kind: 'event', headline: title });
}

interface Snap { rel: Map<number, number>; morale: number; fame: number; money: number; form: number; fitness: number; potential: number; persistence: number; attr: Record<string, number>; role?: string; goals: number; promises: number; newsTop: unknown }

function snapshot(world: World, cast: Record<string, number>): Snap {
  const u = userPlayer(world);
  const rel = new Map<number, number>();
  for (const id of Object.values(cast)) if (world.people[id]) rel.set(id, relationOf(world.people[id], u.id));
  return { rel, morale: u.morale, fame: world.career.fame, money: world.career.money, form: u.form, fitness: u.fitness, potential: u.potential, persistence: persistenceOf(world),
    attr: { ...(u.attr as unknown as Record<string, number>) }, role: u.contract?.role, goals: world.career.goals.length, promises: world.career.promises.length, newsTop: world.news[0] };
}

const ROLE_WORD: Record<string, string> = { star: 'כוכב', starter: 'שחקן הרכב', rotation: 'שחקן רוטציה', backup: 'מחליף', youth: 'נוער' };
const sign = (d: number, digits = 0) => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)}`;

/** Before/after diff of everything an answer touched, in plain Hebrew lines. */
function describeOutcome(world: World, b: Snap, effects: Effect[], cast: Record<string, number>, notes: string[]): EventOutcome['lines'] {
  const u = userPlayer(world);
  const out: EventOutcome['lines'] = [];
  for (const [id, was] of b.rel) {
    const p = world.people[id]; if (!p) continue;
    const d = Math.round(relationOf(p, u.id) - was);
    if (Math.abs(d) < 1) continue;
    out.push({ text: d > 0 ? `${p.name} מעריך את זה` : `${p.name} לא שוכח את זה`, delta: `יחסים ${sign(d)}`, tone: d > 0 ? 'up' : 'down' });
  }
  // relations of people outside the cast (a random teammate etc.)
  for (const e of effects) if (e.k === 'rel' && cast[e.role] == null) out.push({ text: e.d > 0 ? 'מישהו בחדר ההלבשה מעריך את זה' : 'מישהו בחדר ההלבשה לא אהב את זה', delta: `יחסים ${sign(e.d)}`, tone: e.d > 0 ? 'up' : 'down' });
  const stat = (label: string, d: number, digits = 0) => { if (Math.abs(d) >= (digits ? 0.05 : 0.5)) out.push({ text: label, delta: sign(d, digits), tone: d > 0 ? 'up' : 'down' }); };
  stat('מורל', u.morale - b.morale);
  stat('מוניטין', world.career.fame - b.fame);
  stat('כושר', u.form - b.form);
  stat('מוכנות גופנית', u.fitness - b.fitness);
  stat('פוטנציאל', u.potential - b.potential);
  stat('התמדה באימון', persistenceOf(world) - b.persistence);
  const a = u.attr as unknown as Record<string, number>;
  for (const k of Object.keys(a)) stat(ATTR_HE[k as keyof typeof ATTR_HE] ?? k, a[k] - (b.attr[k] ?? a[k]), 1);
  const dm = world.career.money - b.money;
  if (Math.abs(dm) >= 1) out.push({ text: dm > 0 ? 'נכנס כסף' : 'יצא כסף', delta: `${dm > 0 ? '+' : '−'}${fmtMoney(Math.abs(dm))}`, tone: dm > 0 ? 'up' : 'down' });
  if (u.contract?.role && u.contract.role !== b.role) out.push({ text: `התפקיד שלך בסגל: ${ROLE_WORD[u.contract.role] ?? u.contract.role}`, tone: 'info' });
  for (const g of world.career.goals.slice(b.goals)) out.push({ text: `מטרה חדשה: ${g.text}`, tone: 'info' });
  for (const pr of world.career.promises.slice(b.promises)) out.push({ text: pr.text, tone: 'info' });
  const oldTop = world.news.indexOf(b.newsTop as never);
  for (const n of world.news.slice(0, oldTop < 0 ? (b.newsTop ? 0 : world.news.length) : oldTop)) out.push({ text: `בחדשות: ${n.headline}`, tone: 'info' });
  for (const n of notes) if (n) out.push({ text: n, tone: 'info' });
  return out;
}

const PROMISE_TEXT: Record<string, string> = {
  minutes: 'הבטיח לך דקות', starter: 'הבטיח לך מקום בהרכב', contract: 'הבטיח לך חוזה חדש', rest: 'הבטיח לך מנוחה',
};

export function applyEffects(world: World, content: Content, effects: Effect[], cast: Record<string, number>, rng: Rng, text: string): string[] {
  const user = userPlayer(world);
  const notes: string[] = [];
  const roleId = (role: string): number | null => (cast[role] != null ? cast[role] : SELECTORS.includes(role) ? selectPerson(world, role, rng, new Set()) : null);
  for (const e of effects) {
    switch (e.k) {
      case 'rel': { const id = roleId(e.role); if (id != null) changeRelation(world.people[id], user.id, e.d); break; }
      case 'stat':
        if (e.key === 'fame') world.career.fame = clamp(world.career.fame + e.d, 0, 100);
        else if (e.key === 'money') world.career.money += e.d;
        else if (e.key === 'form') user.form = clamp(user.form + e.d, -10, 10);
        else if (e.key === 'morale') user.morale = clamp(user.morale + e.d, 0, 100);
        else if (e.key === 'fitness') user.fitness = clamp(user.fitness + e.d, 0, 100);
        else if (e.key === 'potential') user.potential = clamp(user.potential + e.d, 30, 99);
        else if (e.key === 'persistence') changePersistence(world, e.d);
        break;
      case 'attr': {
        const a = user.attr as unknown as Record<string, number>;
        if (a[e.key] !== undefined) a[e.key] = clamp(a[e.key] + e.d, 1, 99);
        else logOnce(`unknown attribute '${e.key}'`);
        break;
      }
      case 'flag':
        world.history.flags[e.name] = e.set ? e.d : (world.history.flags[e.name] ?? 0) + e.d;
        pushHistory(world, e.name, text);
        break;
      case 'memory': {
        const id = roleId(e.role);
        if (id != null) changeRelation(world.people[id], user.id, e.weight * 0.3, { tag: e.tag, week: world.absWeek, weight: e.weight });
        pushHistory(world, e.tag, text);
        break;
      }
      case 'history': pushHistory(world, e.tag, text); break;
      case 'promise': {
        const id = roleId(e.role);
        if (id == null) break;
        const starts = world.history.flags.starts_total ?? 0;
        world.career.promises.push({
          id: `${e.tag}|${world.absWeek}|${starts}|${e.weeks}`, by: id,
          text: `${world.people[id].name} ${PROMISE_TEXT[e.tag] ?? 'הבטיח משהו'}`, dueWeek: world.absWeek + e.weeks, kept: null,
        });
        break;
      }
      case 'injury': notes.push(injureUser(world, rng, e.weeks)); break;
      case 'goal': addGoal(world, { kind: e.kind, target: e.target, text: fillText(world, e.text, cast) }); break;
      case 'news': addNews(world, { kind: 'event', headline: fillText(world, e.text, cast) }); break;
      case 'offer': { const o = spawnOffer(world, content, rng, e.kind as 'any' | 'abroad' | 'bigger'); if (o) notes.push(o.viaAgentNote); break; }
      case 'squadRole': if (user.contract) user.contract.role = e.role; break;
      case 'unknown': break;
    }
  }
  return notes;
}

function addGoal(world: World, g: { kind: string; target: number; text: string }): void {
  const kinds: Goal['kind'][] = ['attr', 'goals', 'apps', 'transfer', 'title', 'money', 'fame', 'national', 'captain', 'custom'];
  const kind = (kinds.includes(g.kind as Goal['kind']) ? g.kind : 'custom') as Goal['kind'];
  world.career.goals.push({ id: `ev_${world.absWeek}_${world.career.goals.length}`, text: g.text, kind, target: g.target, progress: 0, reward: 'מוניטין', done: false, createdWeek: world.absWeek });
}

/** Option picked by quick week: `default: true`, else the smallest relationship loss, tie-break highest morale. */
export function autoOptionId(content: Content, ev: ActiveEvent): string {
  const t = templateById(content, ev.templateId);
  if (!t || !t.options.length) return ev.options[0]?.id ?? '';
  const def = t.options.find((o) => o.default);
  if (def) return def.id;
  const effects = compileTemplate(t).effects;
  let best = t.options[0].id, bestLoss = Infinity, bestMorale = -Infinity;
  for (const o of t.options) {
    let loss = 0, morale = 0;
    for (const e of effects[o.id] ?? []) {
      if (e.k === 'rel' && e.d < 0) loss += -e.d;
      if (e.k === 'memory' && e.weight < 0) loss += -e.weight * 0.3;
      if (e.k === 'stat' && e.key === 'morale') morale += e.d;
    }
    if (loss < bestLoss || (loss === bestLoss && morale > bestMorale)) { best = o.id; bestLoss = loss; bestMorale = morale; }
  }
  return best;
}

/** Flags with engine meaning (set by event effects). Returns side effects the game loop must handle. */
export function syncFlags(world: World): { openRenewal: boolean } {
  const f = world.history.flags;
  const out = { openRenewal: false };
  if ((f.captain ?? 0) >= 1 && !world.career.captain) {
    world.career.captain = true;
    pushHistory(world, 'captain', 'קיבלת את סרט הקפטן');
  }
  if ((f.want_renewal ?? 0) >= 1) { f.want_renewal = 0; out.openRenewal = true; }
  if ((f.outstanding_athlete ?? 0) >= 1 && world.career.life.armyStatus !== 'done') world.career.life.armyStatus = 'outstanding_athlete';
  else if ((f.army_serving ?? 0) >= 1 && world.career.life.armyStatus !== 'done') { world.career.life.armyStatus = 'serving'; world.career.life.stage = 'army'; }
  f.national_caps = world.career.nationalCaps;
  return out;
}

/** Due promises: kept or broken. Returns Hebrew lines. */
export function checkPromises(world: World): string[] {
  const lines: string[] = [];
  const user = userPlayer(world);
  for (const pr of world.career.promises) {
    if (pr.kept !== null || pr.dueWeek > world.absWeek) continue;
    const [tag, , startsAt, weeks] = pr.id.split('|');
    const by = world.people[pr.by];
    let kept: boolean;
    if (tag === 'minutes' || tag === 'starter') kept = (world.history.flags.starts_total ?? 0) - Number(startsAt) >= Math.ceil(Number(weeks) / 2);
    else kept = relationOf(by, user.id) >= 0;
    pr.kept = kept;
    if (!by) continue;
    if (kept) {
      changeRelation(by, user.id, 4, { tag: 'promise_kept', week: world.absWeek, weight: 6 });
      pushHistory(world, 'promise_kept', `${by.name} עמד בהבטחה`);
      lines.push(`${by.name} עמד בהבטחה`);
    } else {
      changeRelation(by, user.id, -6, { tag: 'promise_broken', week: world.absWeek, weight: -10 });
      user.morale = clamp(user.morale - 5, 0, 100);
      pushHistory(world, 'promise_broken', `${by.name} לא עמד בהבטחה שלו`);
      lines.push(`${by.name} לא עמד בהבטחה`);
    }
  }
  world.career.promises = world.career.promises.filter((p) => p.kept === null || p.dueWeek > world.absWeek - 20);
  return lines;
}
