// Match simulation: 18 segments of 5 minutes. Same goal model for every sim level so averages match.
// Full (user match, stepped via LiveMatch + key moments), medium (scorers + stats), result (score only).
import type {
  Club, ContextMods, Fixture, PrematchDecision, Footballer, LiveMatch, MatchHighlight, MomentKind, MomentResult, MomentSpec, Position, World,
} from './types';
import type { Rng } from './rng';
import {
  POS_HE, changeRelation, clamp, firstName, overallOf, ovr, posGroup, pushHistory, relationOf, userPlayer, pre,
} from './helpers';
import { STARTER_SLOTS, lazyLevel } from './worldGen';
import { fixtureFor, tablePosition } from './schedule';

// ------------------------------------------------------------------ tuning
/** Rating every player starts a match on. */
export const RATING_START = 6.4;

export const MATCH_TUNING = {
  base: 1.2, // expected goals per team, equal sides, neutral
  home: 1.22,
  away: 0.9,
  k: 0.05, // sensitivity to strength difference
  xgMean: 0.12,
};

const SLOTS: Position[] = ['GK', 'CB', 'CB', 'FB', 'FB', 'DM', 'CM', 'AM', 'W', 'W', 'ST'];

export interface TeamStrength { att: number; mid: number; def: number; gk: number; overall: number; xi: number[]; slots: Position[] }

/** Selection score: what a coach sees when picking the XI. */
export function selectionScore(world: World, p: Footballer, c: Club, pos: Position): number {
  let s = overallOf(p.attr, pos) + p.form * 0.3;
  if (p.fitness < 65) s -= (65 - p.fitness) * 0.25;
  if (p.id === world.career?.playerId) {
    const coach = world.people[c.managerId];
    s += relationOf(coach, p.id) / 8;
    const role = p.contract?.role;
    s += role === 'star' ? 4 : role === 'starter' ? 2 : role === 'rotation' ? 0 : role === 'prospect' ? -1.5 : -3;
    if (coach?.traits.includes('prefers_youth') && p.age < 21) s += 2;
    s += (p.morale - 60) / 20;
    s -= youthSelectionPenalty(p.age);
  }
  return s;
}

/** Offset between a lazy club's level and the XI overall a generated squad at that level shows. */
export const LAZY_XI_OFFSET = 0.6;

export function selectXI(world: World, clubId: number, exclude?: number): TeamStrength {
  const c = world.clubs[clubId];
  if (c.lazy) {
    const l = lazyLevel(world, c) + LAZY_XI_OFFSET;
    return { gk: l, def: l, mid: l, att: l, overall: l, xi: SLOTS.map(() => -1), slots: SLOTS };
  }
  const avail: Footballer[] = [];
  for (const id of c.squad) {
    const p = world.people[id] as Footballer;
    if (!p || p.injury || p.retired || id === exclude) continue;
    avail.push(p);
  }
  const used = new Set<number>();
  const xi: number[] = [];
  const vals: number[] = [];
  for (const slot of SLOTS) {
    let best: Footballer | null = null;
    let bestS = -Infinity;
    for (let pass = 0; pass < 3 && !best; pass++) {
      for (const p of avail) {
        if (used.has(p.id)) continue;
        const ok = pass === 0 ? p.pos === slot : pass === 1 ? posGroup(p.pos) === posGroup(slot) : (slot === 'GK') === (p.pos === 'GK') || pass === 2;
        if (!ok) continue;
        const s = selectionScore(world, p, c, slot) - (pass * 6);
        if (s > bestS) { bestS = s; best = p; }
      }
    }
    if (best) {
      used.add(best.id);
      xi.push(best.id);
      vals.push(overallOf(best.attr, slot) * (best.fitness < 50 ? 0.93 : 1));
    } else {
      xi.push(-1);
      vals.push(20);
    }
  }
  const gk = vals[0];
  const def = (vals[1] + vals[2] + vals[3] + vals[4]) / 4;
  const mid = (vals[5] + vals[6] + vals[7]) / 3;
  const att = (vals[8] + vals[9] + vals[10]) / 3;
  return { gk, def, mid, att, overall: 0.1 * gk + 0.3 * def + 0.3 * mid + 0.3 * att, xi, slots: SLOTS };
}

export function expectedGoals(h: TeamStrength, a: TeamStrength, neutral = false): [number, number] {
  const T = MATCH_TUNING;
  const dh = 0.45 * (h.att - (0.8 * a.def + 0.2 * a.gk)) + 0.35 * (h.mid - a.mid) + 0.2 * (h.overall - a.overall);
  const da = 0.45 * (a.att - (0.8 * h.def + 0.2 * h.gk)) + 0.35 * (a.mid - h.mid) + 0.2 * (a.overall - h.overall);
  const lh = T.base * (neutral ? 1 : T.home) * Math.exp(T.k * clamp(dh, -40, 40));
  const la = T.base * (neutral ? 1 : T.away) * Math.exp(T.k * clamp(da, -40, 40));
  return [lh, la];
}

/** One segment for one side. Returns number of goals (0/1). */
function segmentGoal(rng: Rng, lam: number, seg: number, diff: number): { goal: boolean; xg: number; chance: boolean } {
  let l = lam / 18;
  if (seg >= 12) l *= diff < 0 ? 1.18 : diff > 0 ? 0.9 : 1;
  const xgMean = MATCH_TUNING.xgMean;
  let p = l / xgMean;
  let scale = 1;
  if (p > 0.9) { scale = p / 0.9; p = 0.9; }
  if (!rng.chance(p)) return { goal: false, xg: 0, chance: false };
  const xg = clamp(xgMean * scale * (0.25 + 1.5 * rng.next()), 0.01, 0.95);
  return { goal: rng.chance(xg), xg, chance: true };
}

export interface GoalEvent { minute: number; side: 0 | 1 }

/** Simulate segments [from, to). score is mutated ([home, away]). */
export function simSegments(rng: Rng, lh: number, la: number, from: number, to: number, score: [number, number], onChance?: (side: 0 | 1, minute: number, goal: boolean, xg: number) => void): void {
  for (let s = from; s < to; s++) {
    const gh = segmentGoal(rng, lh, s, score[0] - score[1]);
    const ga = segmentGoal(rng, la, s, score[1] - score[0]);
    const mh = s * 5 + 1 + Math.floor(rng.next() * 5);
    const ma = s * 5 + 1 + Math.floor(rng.next() * 5);
    if (gh.goal) score[0]++;
    if (ga.goal) score[1]++;
    if (onChance) {
      if (gh.chance) onChance(0, mh, gh.goal, gh.xg);
      if (ga.chance) onChance(1, ma, ga.goal, ga.xg);
    }
  }
}

// ------------------------------------------------------------------ scorers

const SCORE_SHARE: Record<Position, number> = { GK: 0.001, CB: 0.05, FB: 0.04, DM: 0.05, CM: 0.08, AM: 0.13, W: 0.15, ST: 0.25 };
const ASSIST_SHARE: Record<Position, number> = { GK: 0.01, CB: 0.03, FB: 0.08, DM: 0.07, CM: 0.12, AM: 0.18, W: 0.16, ST: 0.1 };

export function pickScorer(world: World, xi: number[], rng: Rng, exclude?: number): number {
  return rng.weightedPick(xi, (id) => {
    if (id < 0 || id === exclude) return 0;
    const p = world.people[id] as Footballer;
    return SCORE_SHARE[p.pos] * (0.5 + p.attr.finishing / 70);
  }) ?? -1;
}
function pickAssister(world: World, xi: number[], rng: Rng, scorer: number): number {
  if (rng.chance(0.25)) return -1;
  return rng.weightedPick(xi, (id) => {
    if (id < 0 || id === scorer) return 0;
    const p = world.people[id] as Footballer;
    return ASSIST_SHARE[p.pos] * (0.5 + p.attr.passing / 70);
  }) ?? -1;
}

function addApp(p: Footballer, rating: number, goals: number, assists: number, cleanSheet: boolean): void {
  for (const st of [p.stats, p.careerStats]) {
    st.apps++; st.goals += goals; st.assists += assists; st.ratingSum = Math.round((st.ratingSum + rating) * 10) / 10; if (cleanSheet) st.cleanSheets++;
  }
}

/** Medium / result sim of a non-user fixture. withStats: scorers + appearances. */
export function simFixture(world: World, f: Fixture, rng: Rng, withStats: boolean): void {
  const hs = selectXI(world, f.home);
  const as = selectXI(world, f.away);
  const [lh, la] = expectedGoals(hs, as);
  const score: [number, number] = [0, 0];
  const goals: { side: 0 | 1; minute: number }[] = [];
  simSegments(rng, lh, la, 0, 18, score, withStats ? (side, minute, goal) => { if (goal) goals.push({ side, minute }); } : undefined);
  f.hg = score[0]; f.ag = score[1]; f.played = true;
  if (!withStats) return;
  f.scorers = [];
  const g = new Map<number, number>();
  const a = new Map<number, number>();
  for (const ev of goals.sort((x, y) => x.minute - y.minute)) {
    const xi = ev.side === 0 ? hs.xi : as.xi;
    const sc = pickScorer(world, xi, rng);
    if (sc < 0) continue;
    g.set(sc, (g.get(sc) ?? 0) + 1);
    const as1 = pickAssister(world, xi, rng, sc);
    if (as1 >= 0) a.set(as1, (a.get(as1) ?? 0) + 1);
    f.scorers.push({ playerId: sc, minute: ev.minute, clubId: ev.side === 0 ? f.home : f.away });
  }
  const userId = world.career?.playerId;
  for (const [xi, conceded] of [[hs.xi, f.ag], [as.xi, f.hg]] as [number[], number][]) {
    for (const id of xi) {
      if (id < 0 || id === userId) continue;
      const p = world.people[id] as Footballer;
      const r = clamp(6.4 + (g.get(id) ?? 0) * 0.9 + (a.get(id) ?? 0) * 0.5 - conceded * 0.1 + rng.normal(0, 0.5), 4, 10);
      addApp(p, r, g.get(id) ?? 0, a.get(id) ?? 0, conceded === 0 && (p.pos === 'GK' || posGroup(p.pos) === 'DEF'));
      p.fitness = clamp(p.fitness - rng.int(8, 16), 0, 100);
    }
  }
  // occasional knocks
  if (rng.chance(0.07)) {
    const xi = rng.chance(0.5) ? hs.xi : as.xi;
    const id = rng.pick(xi);
    const p = id >= 0 ? (world.people[id] as Footballer) : null;
    if (p && id !== userId) p.injury = { kind: 'מתיחה', weeksLeft: rng.int(1, 4) };
  }
}

// ------------------------------------------------------------------ key moments

/**
 * Moment mix per position (round 6: every position mostly sees moves of its own role). Scoring kinds keep about the
 * same share as before for attackers, so goal tallies stay where the balance runner wants them.
 */
export const KINDS_BY_POS: Record<Position, [MomentKind, number][]> = {
  ST: [['shot', 1.7], ['one_on_one', 0.9], ['header', 1.2], ['hold_up', 2], ['press', 1.1], ['counter', 0.8], ['dribble', 1.2], ['penalty', 0.15], ['free_kick', 0.2]],
  W: [['dribble', 2.5], ['shot', 3], ['one_on_one', 1.8], ['cross', 1.5], ['cutback', 1.5], ['counter', 1], ['recovery', 0.7], ['press', 0.5], ['overlap', 0.5], ['header', 0.4], ['free_kick', 0.3]],
  AM: [['between_lines', 2.4], ['through_ball', 2.4], ['long_shot', 1.6], ['shot', 1.5], ['dribble', 1.2], ['counter', 0.8], ['free_kick', 0.7], ['press', 0.6], ['cutback', 0.4], ['interception', 0.4]],
  CM: [['through_ball', 2], ['switch_play', 2], ['second_ball', 1.6], ['long_shot', 1.6], ['interception', 1.6], ['between_lines', 1], ['tackle', 1], ['recovery', 0.8], ['press', 0.6], ['counter', 0.5], ['build_up', 0.4], ['overlap', 0.4], ['free_kick', 0.3]],
  DM: [['interception', 2.2], ['tackle', 1.8], ['recovery', 1.6], ['build_up', 1.6], ['second_ball', 1.4], ['switch_play', 1.4], ['block', 0.8], ['last_man', 0.6], ['set_piece_defend', 0.6], ['long_shot', 0.6], ['through_ball', 0.6], ['aerial_duel', 0.5]],
  CB: [['aerial_duel', 1.8], ['last_man', 1.8], ['tackle', 1.6], ['block', 1.4], ['clearance', 1.4], ['set_piece_defend', 1.4], ['build_up', 1.2], ['header', 0.8], ['interception', 0.8], ['switch_play', 0.4]],
  FB: [['overlap', 1.6], ['tackle', 1.4], ['cross', 1.4], ['recovery', 1.4], ['build_up', 1], ['block', 0.8], ['clearance', 0.8], ['interception', 0.8], ['cutback', 0.6], ['last_man', 0.6], ['aerial_duel', 0.5], ['set_piece_defend', 0.4], ['dribble', 0.3]],
  GK: [['save', 4], ['rush_out', 2], ['claim_cross', 2], ['distribution', 2], ['penalty', 0.8], ['set_piece_defend', 0.6]],
};

const ATTACKING: Set<MomentKind> = new Set(['shot', 'one_on_one', 'header', 'long_shot', 'free_kick', 'dribble', 'through_ball', 'cross',
  'hold_up', 'press', 'counter', 'cutback', 'overlap', 'between_lines', 'switch_play']);
const SCORING: Set<MomentKind> = new Set(['shot', 'one_on_one', 'header', 'long_shot', 'free_kick']);

export function isAttackingMoment(kind: MomentKind, userPos: Position): boolean {
  if (kind === 'penalty') return userPos !== 'GK';
  return ATTACKING.has(kind);
}

const SKILL_FOR: Record<MomentKind, (p: Footballer) => number> = {
  shot: (p) => p.attr.finishing, one_on_one: (p) => (p.attr.finishing * 2 + p.attr.dribbling) / 3,
  header: (p) => p.attr.heading, dribble: (p) => (p.attr.dribbling * 2 + p.attr.pace) / 3,
  through_ball: (p) => (p.attr.passing + p.attr.vision) / 2, long_shot: (p) => p.attr.finishing,
  interception: (p) => (p.attr.defending + p.attr.vision) / 2, tackle: (p) => p.attr.defending,
  block: (p) => (p.attr.defending * 2 + p.attr.heading) / 3, clearance: (p) => (p.attr.heading + p.attr.defending) / 2,
  save: (p) => p.attr.gk, rush_out: (p) => (p.attr.gk * 2 + p.attr.pace) / 3,
  penalty: (p) => (p.pos === 'GK' ? p.attr.gk : p.attr.finishing), free_kick: (p) => (p.attr.finishing + p.attr.passing) / 2,
  cross: (p) => p.attr.passing,
  hold_up: (p) => (p.attr.dribbling + p.attr.passing + p.attr.heading) / 3, press: (p) => (p.attr.stamina + p.attr.pace + p.attr.vision) / 3,
  counter: (p) => (p.attr.passing + p.attr.dribbling + p.attr.pace) / 3, cutback: (p) => (p.attr.passing + p.attr.vision) / 2,
  overlap: (p) => (p.attr.pace + p.attr.passing + p.attr.stamina) / 3, between_lines: (p) => (p.attr.dribbling + p.attr.passing + p.attr.vision) / 3,
  switch_play: (p) => (p.attr.passing + p.attr.vision) / 2, second_ball: (p) => (p.attr.stamina + p.attr.defending + p.attr.passing) / 3,
  build_up: (p) => (p.pos === 'GK' ? p.attr.gk : (p.attr.passing + p.attr.vision) / 2), recovery: (p) => (p.attr.pace + p.attr.stamina + p.attr.defending) / 3,
  last_man: (p) => (p.attr.defending * 2 + p.attr.pace) / 3, aerial_duel: (p) => (p.attr.heading + p.attr.defending) / 2,
  set_piece_defend: (p) => (p.pos === 'GK' ? p.attr.gk : (p.attr.heading + p.attr.defending) / 2),
  distribution: (p) => (p.attr.gk * 2 + p.attr.passing) / 3, claim_cross: (p) => p.attr.gk,
};

const KIND_BASE: Record<MomentKind, number> = {
  shot: 0.07, one_on_one: 0.1, header: 0.06, dribble: 0.5, through_ball: 0.48, long_shot: 0.045,
  interception: 0.55, tackle: 0.6, block: 0.55, clearance: 0.66, save: 0.68, rush_out: 0.6, penalty: 0.75,
  free_kick: 0.05, cross: 0.48,
  hold_up: 0.55, press: 0.4, counter: 0.45, cutback: 0.48, overlap: 0.5, between_lines: 0.5, switch_play: 0.55, second_ball: 0.52,
  build_up: 0.6, recovery: 0.55, last_man: 0.5, aerial_duel: 0.55, set_piece_defend: 0.6, distribution: 0.65, claim_cross: 0.62,
};
const KIND_DIFF: Partial<Record<MomentKind, number>> = { long_shot: 0.12, free_kick: 0.12, penalty: -0.15, one_on_one: -0.05, header: 0.05 };

/** Probability a moment succeeds when auto-resolved. userPos disambiguates penalties (GK saves vs taking one). */
export function autoSuccessChance(spec: MomentSpec, userPos?: Position): number {
  let base = KIND_BASE[spec.kind];
  if (spec.kind === 'penalty' && userPos === 'GK') base = 0.24;
  // finishing moments are less sensitive to the skill gap (keeps strong strikers' tallies realistic)
  const sens = SCORING.has(spec.kind) ? 0.3 : 0.45;
  return clamp(base + (0.5 - spec.difficulty) * sens, 0.03, 0.95);
}

export function resolveMomentAuto(spec: MomentSpec, rng: Rng, userPos?: Position): MomentResult {
  const success = rng.chance(autoSuccessChance(spec, userPos));
  return { momentId: spec.id, success, quality: success ? 0.45 + 0.55 * rng.next() : 0.4 * rng.next(), skipped: true };
}

/** Outcome probabilities: [goal for us on success, goal against on failure]. */
function momentOutcome(kind: MomentKind, userPos: Position): { scoreOnSuccess: number; assistOnSuccess: number; concedeOnFail: number } {
  if (kind === 'penalty') return userPos === 'GK' ? { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 1 } : { scoreOnSuccess: 1, assistOnSuccess: 0, concedeOnFail: 0 };
  if (SCORING.has(kind)) return { scoreOnSuccess: 1, assistOnSuccess: 0, concedeOnFail: 0 };
  switch (kind) {
    case 'dribble': return { scoreOnSuccess: 0.1, assistOnSuccess: 0.15, concedeOnFail: 0 };
    case 'through_ball': return { scoreOnSuccess: 0, assistOnSuccess: 0.35, concedeOnFail: 0 };
    case 'cross': return { scoreOnSuccess: 0, assistOnSuccess: 0.3, concedeOnFail: 0 };
    case 'interception': return { scoreOnSuccess: 0, assistOnSuccess: 0.1, concedeOnFail: 0.15 };
    case 'tackle': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.35 };
    case 'block': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.5 };
    case 'clearance': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.3 };
    case 'save': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 1 };
    case 'rush_out': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.6 };
    case 'hold_up': return { scoreOnSuccess: 0.05, assistOnSuccess: 0.15, concedeOnFail: 0 };
    case 'press': return { scoreOnSuccess: 0.1, assistOnSuccess: 0.12, concedeOnFail: 0.04 };
    case 'counter': return { scoreOnSuccess: 0.1, assistOnSuccess: 0.3, concedeOnFail: 0 };
    case 'cutback': return { scoreOnSuccess: 0, assistOnSuccess: 0.32, concedeOnFail: 0 };
    case 'overlap': return { scoreOnSuccess: 0, assistOnSuccess: 0.22, concedeOnFail: 0.04 };
    case 'between_lines': return { scoreOnSuccess: 0.06, assistOnSuccess: 0.25, concedeOnFail: 0 };
    case 'switch_play': return { scoreOnSuccess: 0, assistOnSuccess: 0.12, concedeOnFail: 0.03 };
    case 'second_ball': return { scoreOnSuccess: 0, assistOnSuccess: 0.08, concedeOnFail: 0.08 };
    case 'build_up': return { scoreOnSuccess: 0, assistOnSuccess: 0.05, concedeOnFail: 0.1 };
    case 'recovery': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.25 };
    case 'last_man': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.45 };
    case 'aerial_duel': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.18 };
    case 'set_piece_defend': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.3 };
    case 'distribution': return { scoreOnSuccess: 0, assistOnSuccess: 0.05, concedeOnFail: 0.1 };
    case 'claim_cross': return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0.3 };
    default: return { scoreOnSuccess: 0, assistOnSuccess: 0, concedeOnFail: 0 };
  }
}

const KIND_HE: Record<MomentKind, string> = {
  shot: 'בעיטה', one_on_one: 'אחד על אחד', header: 'נגיחה', dribble: 'דריבל', through_ball: 'מסירת עומק',
  long_shot: 'בעיטה מרחוק', interception: 'חטיפה', tackle: 'תיקול', block: 'חסימה', clearance: 'הרחקה',
  save: 'הצלה', rush_out: 'יציאה', penalty: 'פנדל', free_kick: 'בעיטה חופשית', cross: 'הגבהה',
  hold_up: 'משחק גב', press: 'לחץ גבוה', counter: 'מתפרצת', cutback: 'החזרה לאחור', overlap: 'עקיפה באגף',
  between_lines: 'קבלה בין הקווים', switch_play: 'החלפת אגף', second_ball: 'כדור שני', build_up: 'יציאה מהלחץ',
  recovery: 'חזרה להגנה', last_man: 'אחרון בהגנה', aerial_duel: 'מאבק אווירי', set_piece_defend: 'הגנה על מצב נייח',
  distribution: 'הוצאת כדור', claim_cross: 'יציאה להגבהה',
};
export { KIND_HE };

// ------------------------------------------------------------------ live match (user's)

interface LiveCtx { lh: number; la: number }

/** Persisted inside LiveMatch via highlights/moments; λ are recomputed from squads each call (deterministic enough). */
function liveLambdas(world: World, live: LiveMatch): LiveCtx {
  const f = live.fixture;
  const userId = world.career.playerId;
  const userOn = isUserOnPitch(live);
  let hs: TeamStrength, as: TeamStrength;
  if (live.youth) {
    hs = youthStrength(world, f.home, f.home === live.userClubId);
    as = youthStrength(world, f.away, f.away === live.userClubId);
  } else {
    hs = selectXI(world, f.home, userOn ? undefined : (f.home === live.userClubId ? userId : undefined));
    as = selectXI(world, f.away, userOn ? undefined : (f.away === live.userClubId ? userId : undefined));
  }
  let [lh, la] = expectedGoals(hs, as);
  // subtract what the remaining user moments are expected to add, so totals stay realistic
  const user = userPlayer(world);
  let addFor = 0, addAgainst = 0;
  for (let i = live.pendingMomentIndex; i < live.moments.length; i++) {
    const m = live.moments[i];
    const p = autoSuccessChance(m, user.pos);
    const o = momentOutcome(m.kind, user.pos);
    addFor += p * (o.scoreOnSuccess + o.assistOnSuccess);
    addAgainst += (1 - p) * o.concedeOnFail;
  }
  const segLeft = Math.max(1, 18 - live.segment);
  const frac = segLeft / 18;
  if (live.isHome) { lh = Math.max(lh * 0.3, lh - addFor / frac); la = Math.max(la * 0.3, la - addAgainst / frac); }
  else { la = Math.max(la * 0.3, la - addFor / frac); lh = Math.max(lh * 0.3, lh - addAgainst / frac); }
  return { lh, la };
}

/** Youth (U19) level of a club: derived from its youngest players. */
export function youthXI(world: World, clubId: number, includeUser: boolean): number[] {
  const userId = world.career.playerId;
  const c = world.clubs[clubId];
  const young = c.squad.filter((id) => id !== userId && world.people[id] && !(world.people[id] as Footballer).injury)
    .sort((a, b) => world.people[a].age - world.people[b].age).slice(0, includeUser ? 10 : 11);
  if (includeUser) young.unshift(userId);
  return young;
}

function youthStrength(world: World, clubId: number, withUser: boolean): TeamStrength {
  const ids = youthXI(world, clubId, withUser);
  const c = world.clubs[clubId];
  const lg = world.leagues[c.leagueId];
  // youth teams: around a 17-18 year old at this club's level
  const base = clamp(lg.strength - 20 + (c.reputation - 50) * 0.12, 26, 62);
  let sum = 0;
  for (const id of ids) sum += ovr(world.people[id] as Footballer);
  const lvl = ids.length ? 0.6 * base + 0.4 * (sum / ids.length) : base;
  return { att: lvl, mid: lvl, def: lvl, gk: lvl, overall: lvl, xi: ids, slots: SLOTS };
}

/** XI used for scorer/opponent picks in the live match (youth or senior). */
function teamXI(world: World, live: LiveMatch, clubId: number): number[] {
  if (live.youth) return youthXI(world, clubId, clubId === live.userClubId);
  return selectXI(world, clubId).xi;
}

export function isUserOnPitch(live: LiveMatch): boolean {
  if (live.started) return true;
  if (live.subMinute != null) return live.segment * 5 >= live.subMinute;
  return false;
}

export type LineupStatus = PrematchDecision['lineup'];
export type LineupDecision = PrematchDecision;

/** True until the user has played his first match of the career (senior or youth). */
export function isFirstCareerMatch(world: World): boolean {
  const u = userPlayer(world);
  return !(world.history.flags.first_match_done ?? 0) && u.careerStats.apps === 0 && !(world.history.flags.youth_apps ?? 0);
}

/** Youth penalty in the coach's eyes: a 15-16 year old is mostly a U19 player. */
export function youthSelectionPenalty(age: number): number {
  return age <= 15 ? 13 : age === 16 ? 10 : age === 17 ? 5 : age === 18 ? 1.5 : 0;
}

/** Decide the user's matchday status for this week's fixture. Called when the week reaches pre-match; startLiveMatch honours it. */
export function decideLineup(world: World, rng: Rng): LineupDecision | null {
  const user = userPlayer(world);
  if (user.clubId == null) return null;
  const f = fixtureFor(world, user.clubId, world.season.week);
  if (!f || f.played) return null;
  const c = world.clubs[user.clubId];
  const coach = world.people[c.managerId];
  const first = isFirstCareerMatch(world);
  const mk = (lineup: LineupStatus, subMinute: number | null, reason: string): LineupDecision => ({ absWeek: world.absWeek, lineup, subMinute, reason, firstMatch: first });
  if (user.injury) return mk('out', null, `אתה פצוע (${user.injury.kind}). השבוע אתה ביציע.`);
  const xi = selectXI(world, user.clubId);
  const started = xi.xi.includes(user.id);
  if (started) {
    const reasons = first
      ? ['המשחק הראשון שלך בבוגרים. תהנה, ותשחק פשוט.']
      : user.contract?.role === 'star' || user.contract?.role === 'starter'
        ? ['אתה בהרכב. תן לי 90 דקות כמו שאתה יודע.', 'פותח, כרגיל. אני סומך עליך.']
        : user.form > 3 ? ['אתה בהרכב. הכושר שלך לא השאיר לי ברירה.'] : ['אתה פותח היום. זאת ההזדמנות שלך.'];
    return mk('starter', null, rng.pick(reasons));
  }
  let p = 0.32 + relationOf(coach, user.id) / 250 + (user.form > 3 ? 0.08 : 0);
  if (user.contract?.role === 'prospect' && coach?.traits.includes('prefers_youth')) p += 0.12;
  if (user.contract?.role === 'rotation') p += 0.15;
  if (user.fitness < 40) p -= 0.2;
  // a senior debut at 15-17 is rare
  p *= user.age <= 16 ? 0.15 : user.age === 17 ? 0.5 : 1;
  // the first career match is a youth match unless he starts (3 key moments, a gentle start)
  if (!first && rng.chance(clamp(p, 0.02, 0.85))) {
    const subMinute = rng.int(56, 75);
    const senior = user.careerStats.apps > 0;
    return mk('bench', subMinute, senior ? 'מתחיל על הספסל. תיכנס בחצי השני, תראה לי מה יש לך.' : 'על הספסל של הבוגרים. אם תיכנס, זאת תהיה הבכורה שלך.');
  }
  if (user.age <= 18) return mk('youth', null, first ? 'המשחק הראשון שלך במדים. בנוער, מול קהל קטן. תתחיל בשקט.' : 'לא בסגל הבוגר השבוע. תשחק בנוער ותראה לי משהו.');
  return mk('out', null, user.fitness < 40 ? 'אתה גמור פיזית. השבוע אתה נח.' : 'לא נכנסת לסגל. תעבוד קשה באימונים.');
}

/** Build the live match for the user's club this week. Returns null if no fixture. Honours a pre-match lineup decision. */
export function startLiveMatch(world: World, rng: Rng, decision?: LineupDecision | null): LiveMatch | null {
  const user = userPlayer(world);
  if (user.clubId == null) return null;
  const f = fixtureFor(world, user.clubId, world.season.week);
  if (!f || f.played) return null;
  const dec = decision && decision.absWeek === world.absWeek ? decision : decideLineup(world, rng);
  if (!dec) return null;
  const userClub = world.clubs[user.clubId];
  const isHome = f.home === user.clubId;
  const oppId = isHome ? f.away : f.home;
  const opp = world.clubs[oppId];
  const started = dec.lineup === 'starter';
  const subMinute = dec.lineup === 'bench' ? dec.subMinute ?? 65 : null;
  const derby = userClub.rivalClubId === oppId || opp.rivalClubId === userClub.id;
  const youth = dec.lineup === 'youth';
  const weatherRoll = rng.next();
  const weather: LiveMatch['weather'] = weatherRoll < 0.15 ? 'rain' : weatherRoll < 0.25 ? 'wind' : 'clear';
  const live: LiveMatch = {
    fixture: f, leagueId: userClub.leagueId, userClubId: userClub.id, oppClubId: oppId, isHome, segment: 0, score: [0, 0],
    moments: [], pendingMomentIndex: 0, highlights: [], userRating: RATING_START, userMinutes: 0, userGoals: 0, userAssists: 0,
    weather, started: started || youth, derby, subMinute, finished: false,
  };
  if (dec.firstMatch) live.firstMatch = true;
  if (youth) {
    live.youth = true;
    live.fixture = { week: f.week, home: f.home, away: f.away, played: false, hg: 0, ag: 0, scorers: [] };
    live.highlights.push({ minute: 0, kind: 'moment', text: 'משחק נוער. הבוגרים משחקים בלעדיך היום' });
  }
  if (subMinute != null) live.highlights.push({ minute: subMinute, kind: 'sub', text: `${firstName(user.name)} נכנס מהספסל בדקה ${subMinute}` });
  if (live.started || subMinute != null) planMoments(world, live, rng);
  return live;
}

function planMoments(world: World, live: LiveMatch, rng: Rng): void {
  const user = userPlayer(world);
  const rivalOpp = (world.people[world.career.rivalId] as Footballer | undefined)?.clubId === live.oppClubId;
  const startSeg = live.started ? 0 : Math.floor((live.subMinute ?? 60) / 5) + 1;
  const segsAvail = 18 - startSeg;
  let n: number;
  if (live.firstMatch) n = 3;
  else if (live.youth) n = rng.int(3, 4);
  else if (live.started) {
    n = rng.int(3, 4);
    const posU = tablePosition(world, live.userClubId), posO = tablePosition(world, live.oppClubId);
    if (live.derby || rivalOpp || (posU <= 3 && posO <= 3)) n++;
    if (user.attr.vision > 70 && rng.chance(0.3)) n++;
    n = Math.min(5, n);
  } else n = segsAvail >= 5 ? rng.int(2, 3) : 2;
  n = Math.min(n, Math.max(2, segsAvail));
  const segs = new Set<number>();
  let guard = 0;
  while (segs.size < n && guard++ < 100) {
    // later segments a bit more likely (drama)
    const s = startSeg + Math.floor(Math.pow(rng.next(), 0.85) * segsAvail);
    segs.add(Math.min(17, s));
  }
  const sorted = [...segs].sort((a, b) => a - b);
  const kinds = KINDS_BY_POS[user.pos];
  let prev: MomentKind | null = null;
  sorted.forEach((s, i) => {
    const kind = rng.weightedPick(kinds.filter(([k]) => k !== prev), ([, w]) => w)?.[0] ?? kinds[0][0];
    prev = kind;
    live.moments.push({
      id: i + 1, kind, minute: s * 5 + 1 + Math.floor(rng.next() * 5), difficulty: 0.5, attackerSkill: SKILL_FOR[kind](user),
      opponentId: null, opponentName: '', context: { lateClose: false, hostileCrowd: false, rivalInvolved: false, rain: live.weather === 'rain', derby: live.derby },
      scoreBefore: [0, 0], stakes: '',
    });
  });
  // first career match: one moment is always a scoring chance
  if (live.firstMatch && user.pos !== 'GK' && live.moments.length && !live.moments.some((m) => SCORING.has(m.kind))) {
    const last = live.moments[live.moments.length - 1];
    last.kind = posGroup(user.pos) === 'DEF' ? 'header' : 'shot';
    last.attackerSkill = SKILL_FOR[last.kind](user);
  }
  // pre-pick opponents so the UI can show names on the timeline
  for (const m of live.moments) pickOpponent(world, live, m, rng);
}

function pickOpponent(world: World, live: LiveMatch, m: MomentSpec, rng: Rng): void {
  const user = userPlayer(world);
  const oppXI = live.youth ? (() => { const ids = youthXI(world, live.oppClubId, false); return { xi: ids, slots: ids.map((id) => (world.people[id] as Footballer).pos) }; })() : selectXI(world, live.oppClubId);
  const attacking = isAttackingMoment(m.kind, user.pos);
  const wanted: Position[] = attacking
    ? (['shot', 'one_on_one', 'long_shot', 'free_kick', 'penalty', 'header'].includes(m.kind) ? ['GK']
      : m.kind === 'cross' || m.kind === 'cutback' || m.kind === 'overlap' ? ['FB']
        : m.kind === 'through_ball' || m.kind === 'between_lines' || m.kind === 'switch_play' ? ['DM', 'CB']
          : m.kind === 'press' ? ['CB', 'DM'] : m.kind === 'counter' ? ['CB', 'DM', 'FB'] : ['CB', 'FB', 'DM'])
    : m.kind === 'build_up' || m.kind === 'distribution' ? ['ST', 'W', 'AM']
      : m.kind === 'second_ball' ? ['CM', 'DM', 'AM']
        : (user.pos === 'GK' ? ['ST', 'W', 'AM'] : ['ST', 'W', 'AM', 'CM']);
  const rival = world.people[world.career.rivalId] as Footballer | undefined;
  let oppId = -1;
  if (rival && rival.clubId === live.oppClubId && oppXI.xi.includes(rival.id) && (wanted.includes(rival.pos) || rng.chance(0.35)) && rival.pos !== 'GK' === (wanted[0] !== 'GK')) {
    oppId = rival.id;
  } else {
    const cands = oppXI.xi.filter((id, i) => id >= 0 && wanted.includes(oppXI.slots[i]));
    oppId = cands.length ? rng.pick(cands) : oppXI.xi.find((id) => id >= 0) ?? -1;
  }
  const opp = oppId >= 0 ? (world.people[oppId] as Footballer) : null;
  m.opponentId = opp ? opp.id : null;
  m.opponentName = opp ? opp.name : world.clubs[live.oppClubId].name;
  m.context.rivalInvolved = !!opp && opp.id === world.career.rivalId;
}

/** Fill in context/score/difficulty/stakes of the pending moment (called when it becomes current). */
function refreshPending(world: World, live: LiveMatch): void {
  const m = live.moments[live.pendingMomentIndex];
  if (!m) return;
  const user = userPlayer(world);
  const us = live.isHome ? live.score[0] : live.score[1];
  const them = live.isHome ? live.score[1] : live.score[0];
  m.scoreBefore = [us, them];
  const opp = m.opponentId != null ? (world.people[m.opponentId] as Footballer | undefined) : undefined;
  const ctx: ContextMods = m.context;
  ctx.lateClose = m.minute >= 80 && Math.abs(us - them) <= 1;
  ctx.hostileCrowd = !live.isHome && (live.derby || world.clubs[live.oppClubId].reputation >= 60);
  ctx.rain = live.weather === 'rain';
  ctx.derby = live.derby;
  const attacking = isAttackingMoment(m.kind, user.pos);
  let oppSkill: number;
  if (!opp) oppSkill = 50;
  else if (attacking) oppSkill = opp.pos === 'GK' ? opp.attr.gk : opp.attr.defending;
  else oppSkill = (opp.attr.finishing + opp.attr.dribbling + opp.attr.pace) / 3;
  m.attackerSkill = Math.round(SKILL_FOR[m.kind](user));
  let d = 0.5 + clamp((oppSkill - m.attackerSkill) / 110, -0.25, 0.3) + (KIND_DIFF[m.kind] ?? 0);
  if (ctx.lateClose) d += 0.07;
  if (ctx.hostileCrowd) d += user.morale < 50 ? 0.06 : 0.03;
  if (ctx.rivalInvolved) d += 0.04;
  if (ctx.rain) d += 0.03;
  if (ctx.derby) d += 0.03;
  if (user.fitness < 50) d += 0.05;
  if (live.firstMatch && live.pendingMomentIndex === 0) d -= 0.18; // a quiet tutorial moment
  m.difficulty = Math.round(clamp(d, 0.08, 0.95) * 100) / 100;
  const bits = [`דקה ${m.minute}, ${us}-${them}`];
  if (ctx.rivalInvolved) bits.push(`${firstName(opp!.name)} מולך`);
  else if (ctx.derby) bits.push('דרבי');
  if (ctx.lateClose) bits.push(us === them ? 'כל נגיעה יכולה להכריע' : us < them ? 'זה הרגע להשוות' : 'צריך להחזיק את היתרון');
  else if (ctx.hostileCrowd) bits.push('הקהל שורק עליך');
  if (ctx.rain) bits.push('המגרש רטוב');
  m.stakes = bits.join('. ');
}

function bgHighlight(world: World, live: LiveMatch, side: 0 | 1, minute: number, goal: boolean, xg: number, rng: Rng): void {
  const clubId = side === 0 ? live.fixture.home : live.fixture.away;
  const c = world.clubs[clubId];
  const userOn = isUserOnPitch(live) && minute >= (live.subMinute ?? 0);
  const user = userPlayer(world);
  if (goal) {
    const xi = live.youth ? youthXI(world, clubId, clubId === live.userClubId) : selectXI(world, clubId, clubId === live.userClubId && !userOn ? user.id : undefined).xi;
    let scorer = pickScorer(world, xi, rng);
    const isUserTeam = clubId === live.userClubId;
    // the user is part of the background play too, but moments carry most of his chances
    if (isUserTeam && scorer === user.id && !rng.chance(0.25)) scorer = pickScorer(world, xi, rng, user.id);
    const name = scorer >= 0 ? (world.people[scorer] as Footballer).name : c.name;
    if (isUserTeam && scorer === user.id) live.userGoals++;
    else if (isUserTeam && userOn && user.pos !== 'GK' && rng.chance(ASSIST_SHARE[user.pos] * 0.6)) {
      live.userAssists++;
      live.userRating += 0.4;
    }
    live.fixture.scorers = live.fixture.scorers ?? [];
    if (scorer >= 0) live.fixture.scorers.push({ playerId: scorer, minute, clubId });
    live.highlights.push({ minute, kind: 'goal', text: `שער! ${name} (${c.short})` });
    if (userOn) {
      const g = posGroup(user.pos);
      if (isUserTeam) live.userRating += g === 'ATT' ? 0.12 : 0.06;
      else live.userRating -= g === 'DEF' || g === 'GK' ? 0.25 : 0.06;
    }
  } else if (xg > 0.25) {
    live.highlights.push({ minute, kind: 'chance', text: `הזדמנות ${pre('ל', c.name)}` });
  }
}

function simTo(world: World, live: LiveMatch, rng: Rng, toSeg: number): void {
  if (toSeg <= live.segment) return;
  const { lh, la } = liveLambdas(world, live);
  const before = live.highlights.length;
  simSegments(rng, lh, la, live.segment, toSeg, live.score, (side, minute, goal, xg) => bgHighlight(world, live, side, minute, goal, xg, rng));
  // keep highlights chronological
  if (live.highlights.length > before) live.highlights.sort((a, b) => a.minute - b.minute);
  live.segment = toSeg;
}

/** Advance until the next pending moment (or to full time). */
export function advanceLive(world: World, live: LiveMatch, rng: Rng): void {
  const m = live.moments[live.pendingMomentIndex];
  if (m) {
    simTo(world, live, rng, Math.floor((m.minute - 1) / 5));
    refreshPending(world, live);
  } else {
    simTo(world, live, rng, 18);
    live.finished = true;
  }
}

export interface MomentEffect { goalFor: boolean; goalAgainst: boolean; assist: boolean; big: string | null }

/** Apply a MomentResult to the live match. Returns what happened. */
export function applyMomentResult(world: World, live: LiveMatch, result: MomentResult, rng: Rng): MomentEffect {
  const m = live.moments[live.pendingMomentIndex];
  const eff: MomentEffect = { goalFor: false, goalAgainst: false, assist: false, big: null };
  if (!m) return eff;
  const user = userPlayer(world);
  const o = momentOutcome(m.kind, user.pos);
  const usIdx = live.isHome ? 0 : 1;
  const themIdx = live.isHome ? 1 : 0;
  const q = clamp(result.quality, 0, 1);
  if (result.success) {
    live.userRating += 0.25 + 0.25 * q;
    user.morale = clamp(user.morale + 1, 0, 100);
    if (o.scoreOnSuccess > 0 && rng.chance(o.scoreOnSuccess === 1 ? 1 : o.scoreOnSuccess)) {
      eff.goalFor = true;
      live.score[usIdx]++;
      live.userGoals++;
      live.userRating += 0.7;
      live.fixture.scorers = live.fixture.scorers ?? [];
      live.fixture.scorers.push({ playerId: user.id, minute: m.minute, clubId: live.userClubId });
      live.highlights.push({ minute: m.minute, kind: 'goal', text: `שער! ${user.name} (${KIND_HE[m.kind]})` });
    } else if (o.assistOnSuccess > 0 && rng.chance(o.assistOnSuccess)) {
      eff.goalFor = true;
      eff.assist = true;
      live.score[usIdx]++;
      live.userAssists++;
      live.userRating += 0.4;
      const xi = teamXI(world, live, live.userClubId);
      const sc = pickScorer(world, xi, rng, user.id);
      const name = sc >= 0 ? (world.people[sc] as Footballer).name : 'חבר לקבוצה';
      live.fixture.scorers = live.fixture.scorers ?? [];
      if (sc >= 0) live.fixture.scorers.push({ playerId: sc, minute: m.minute, clubId: live.userClubId });
      live.highlights.push({ minute: m.minute, kind: 'goal', text: `שער! ${name}, בישול של ${firstName(user.name)}` });
    } else {
      live.highlights.push({ minute: m.minute, kind: 'moment', text: `${KIND_HE[m.kind]} מוצלח של ${firstName(user.name)}` });
    }
  } else {
    live.userRating -= 0.22;
    user.morale = clamp(user.morale - 1, 0, 100);
    if (o.concedeOnFail > 0 && rng.chance(o.concedeOnFail)) {
      eff.goalAgainst = true;
      live.score[themIdx]++;
      live.userRating -= 0.3;
      const opp = m.opponentId != null ? (world.people[m.opponentId] as Footballer | undefined) : undefined;
      const scorerId = opp && opp.pos !== 'GK' ? opp.id : pickScorer(world, teamXI(world, live, live.oppClubId), rng);
      const nm = scorerId >= 0 ? (world.people[scorerId] as Footballer).name : world.clubs[live.oppClubId].name;
      live.fixture.scorers = live.fixture.scorers ?? [];
      if (scorerId >= 0) live.fixture.scorers.push({ playerId: scorerId, minute: m.minute, clubId: live.oppClubId });
      live.highlights.push({ minute: m.minute, kind: 'goal', text: `שער ליריבה. ${nm} ניצל את זה` });
    } else {
      live.highlights.push({ minute: m.minute, kind: 'chance', text: `${KIND_HE[m.kind]} לא הצליח` });
    }
  }
  // big moments -> memories + history
  const us = live.score[usIdx], them = live.score[themIdx];
  const coach = world.people[world.clubs[live.userClubId].managerId];
  const rival = world.people[world.career.rivalId];
  const opp = world.clubs[live.oppClubId];
  if (eff.goalFor && !eff.assist && m.minute >= 80 && Math.abs(us - them) <= 1) {
    eff.big = 'late_goal';
    changeRelation(coach, user.id, 6, { tag: 'late_goal', week: world.absWeek, weight: 10 });
    pushHistory(world, 'late_goal', `כבשת בדקה ${m.minute} נגד ${opp.name}`);
  }
  if (eff.goalFor && !eff.assist && live.derby) {
    eff.big = eff.big ?? 'derby_goal';
    pushHistory(world, 'derby_goal', `כבשת בדרבי נגד ${opp.name}`);
  }
  if (m.context.rivalInvolved) {
    if (result.success) {
      changeRelation(rival, user.id, -4, { tag: 'beaten_by_user', week: world.absWeek, weight: -6 });
      pushHistory(world, 'beat_rival', `ניצחת את ${rival?.name ?? 'המתחרה'} ברגע ישיר`);
      eff.big = eff.big ?? 'beat_rival';
    } else {
      changeRelation(rival, user.id, -2, { tag: 'gloat', week: world.absWeek, weight: -5 });
      pushHistory(world, 'missed_vs_rival', `${rival?.name ?? 'המתחרה'} ניצח אותך ברגע ישיר`);
      eff.big = eff.big ?? 'missed_vs_rival';
    }
  }
  if (result.success && live.derby && (m.kind === 'save' || m.kind === 'penalty') && user.pos === 'GK') {
    pushHistory(world, 'derby_save', `הצלת בדרבי נגד ${opp.name}`);
    eff.big = eff.big ?? 'derby_save';
  }
  live.userRating = clamp(live.userRating, 3, 10);
  live.pendingMomentIndex++;
  live.segment = Math.max(live.segment, Math.floor((m.minute - 1) / 5));
  return eff;
}

/** Finish: final whistle, fixture, user stats. Returns final rating (null if not played). */
export function finalizeLive(world: World, live: LiveMatch, rng: Rng): number | null {
  if (!live.finished) { simTo(world, live, rng, 18); live.finished = true; }
  const f = live.fixture;
  f.hg = live.score[0]; f.ag = live.score[1]; f.played = true;
  const user = userPlayer(world);
  const played = live.started || live.subMinute != null;
  if (live.youth) {
    live.userMinutes = 90;
    const us = live.isHome ? f.hg : f.ag, them = live.isHome ? f.ag : f.hg;
    live.userRating = Math.round(clamp(live.userRating + (us > them ? 0.3 : us < them ? -0.2 : 0) + rng.normal(0, 0.25), 4, 10) * 10) / 10;
    world.history.flags.youth_apps = (world.history.flags.youth_apps ?? 0) + 1;
    world.history.flags.youth_goals = (world.history.flags.youth_goals ?? 0) + live.userGoals;
    user.fitness = clamp(user.fitness - 10, 0, 100);
    return live.userRating;
  }
  live.userMinutes = live.started ? 90 : live.subMinute != null ? 90 - live.subMinute : 0;
  const us = live.isHome ? f.hg : f.ag, them = live.isHome ? f.ag : f.hg;
  if (played) {
    let r = live.userRating;
    r += us > them ? 0.3 : us < them ? -0.2 : 0;
    const g = posGroup(user.pos);
    if (them === 0 && (g === 'DEF' || g === 'GK')) r += 0.5;
    r += rng.normal(0, 0.25);
    if (!live.started) r = RATING_START + (r - RATING_START) * 0.8;
    live.userRating = Math.round(clamp(r, 4, 10) * 10) / 10;
    addApp(user, live.userRating, live.userGoals, live.userAssists, them === 0 && (g === 'DEF' || g === 'GK'));
    user.fitness = clamp(user.fitness - Math.round(live.userMinutes / 90 * (16 - user.attr.stamina / 12)), 0, 100);
  }
  // NPC stats for both XIs
  for (const clubId of [f.home, f.away]) {
    const xi = selectXI(world, clubId, user.id).xi;
    const conceded = clubId === f.home ? f.ag : f.hg;
    for (const id of xi) {
      if (id < 0 || id === user.id) continue;
      const p = world.people[id] as Footballer;
      const goals = (f.scorers ?? []).filter((s) => s.playerId === id).length;
      addApp(p, clamp(6.4 + goals * 0.9 - conceded * 0.1 + rng.normal(0, 0.5), 4, 10), goals, 0, conceded === 0 && (p.pos === 'GK' || posGroup(p.pos) === 'DEF'));
      p.fitness = clamp(p.fitness - rng.int(8, 16), 0, 100);
    }
  }
  return played ? live.userRating : null;
}

/** Full-time sim for tests and balancing: two clubs, no user. */
export function quickScore(world: World, homeId: number, awayId: number, rng: Rng): [number, number] {
  const [lh, la] = expectedGoals(selectXI(world, homeId), selectXI(world, awayId));
  const s: [number, number] = [0, 0];
  simSegments(rng, lh, la, 0, 18, s);
  return s;
}

export const POSITION_LABEL = POS_HE;
export type { MatchHighlight };
export { STARTER_SLOTS };
