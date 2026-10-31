// Player development: training plan, growth, ageing, injuries, NPC yearly growth, retirement + youth regen.
import type { Content } from './content';
import type { AttrGain, AttrKey, Footballer, PlanSlot, Position, WeekPlan, World } from './types';
import type { Rng } from './rng';
import {
  ATTR_HE, ATTR_KEYS, POS_WEIGHTS, addNews, changeRelation, clamp, ovr, pushHistory, relationOf, userPlayer,
} from './helpers';
import { SQUAD_MIX, clubLevel, makeFootballer, npcPotential } from './worldGen';

export const DEV_TUNING = {
  trainGain: 0.12, // per slot per week, before factors
  gymGain: 0.06,
  passiveGain: 0.025,
  gapScale: 12, // growth slows as overall approaches potential: factor = gap / gapScale
};

export const PLAN_HE: Record<PlanSlot, string> = {
  train_finishing: 'אימון סיומת', train_passing: 'אימון מסירה', train_dribbling: 'אימון דריבל', train_pace: 'אימון מהירות',
  train_stamina: 'אימון סיבולת', train_defending: 'אימון הגנה', train_heading: 'אימון משחק ראש', train_vision: 'אימון ראיית משחק',
  train_gk: 'אימון שוערים', rest: 'מנוחה', team_night: 'ערב עם הקבוצה', talk_coach: 'שיחה עם המאמן', extra_gym: 'חדר כושר',
  media: 'ראיון לתקשורת', family: 'זמן עם המשפחה',
};

export function ageFactor(age: number): number {
  if (age <= 18) return 1.1;
  if (age <= 21) return 0.95;
  if (age <= 24) return 0.7;
  if (age <= 27) return 0.4;
  if (age <= 29) return 0.2;
  if (age <= 31) return 0.08;
  return 0.03;
}

export function defaultPlan(p: Footballer): WeekPlan {
  const main: Record<Position, PlanSlot[]> = {
    GK: ['train_gk', 'train_gk', 'rest'], CB: ['train_defending', 'train_heading', 'rest'], FB: ['train_defending', 'train_pace', 'rest'],
    DM: ['train_defending', 'train_passing', 'rest'], CM: ['train_passing', 'train_vision', 'rest'], AM: ['train_vision', 'train_dribbling', 'rest'],
    W: ['train_dribbling', 'train_pace', 'rest'], ST: ['train_finishing', 'train_heading', 'rest'],
  };
  return main[p.pos].slice() as WeekPlan;
}

/** Immediate (non-attribute) effects of the plan. Returns short Hebrew notes. */
export function applyPlanImmediate(world: World, plan: WeekPlan, rng: Rng): string[] {
  const user = userPlayer(world);
  const notes: string[] = [];
  const club = user.clubId != null ? world.clubs[user.clubId] : null;
  const coach = club ? world.people[club.managerId] : undefined;
  const circle = world.career.circle ?? {};
  for (const slot of plan) {
    if (user.injury && slot.startsWith('train_')) { user.fitness = clamp(user.fitness + 4, 0, 100); continue; }
    switch (slot) {
      case 'rest': user.fitness = clamp(user.fitness + 25, 0, 100); user.morale = clamp(user.morale + 1, 0, 100); break;
      case 'team_night': {
        user.morale = clamp(user.morale + 4, 0, 100);
        user.fitness = clamp(user.fitness - 3, 0, 100);
        world.history.flags.team_nights = (world.history.flags.team_nights ?? 0) + 1;
        if (club) {
          const mate = rng.pick(club.squad.filter((id) => id !== user.id));
          if (mate != null) changeRelation(world.people[mate], user.id, 4);
          if (user.age >= 28) {
            const young = club.squad.map((id) => world.people[id] as Footballer).filter((p) => p && p.age <= 20 && p.id !== user.id);
            if (young.length) {
              const y = rng.pick(young);
              changeRelation(y, user.id, 6);
              world.history.flags.mentored = (world.history.flags.mentored ?? 0) + 1;
              changeRelation(coach, user.id, 1);
            }
          }
        }
        if (rng.chance(0.25)) { world.history.flags.party = (world.history.flags.party ?? 0) + 1; pushHistory(world, 'party', 'יצאת לבלות עם החבר׳ה'); }
        break;
      }
      case 'talk_coach': {
        let d = 3;
        if (coach?.traits.includes('mentor') || coach?.traits.includes('calm')) d += 2;
        if (coach?.traits.includes('hot_tempered') && rng.chance(0.3)) d = -2;
        changeRelation(coach, user.id, d);
        world.history.flags.talks = (world.history.flags.talks ?? 0) + 1;
        pushHistory(world, 'talk_coach', 'ישבת לשיחה עם המאמן');
        break;
      }
      case 'extra_gym': user.fitness = clamp(user.fitness - 8, 0, 100); break;
      case 'media': {
        world.career.fame = clamp(world.career.fame + 1, 0, 100);
        if (rng.chance(0.15)) {
          changeRelation(coach, user.id, -3);
          user.morale = clamp(user.morale - 3, 0, 100);
          addNews(world, { kind: 'career', headline: `${user.name} התבטא בראיון, ובמועדון לא אהבו` });
          pushHistory(world, 'bad_interview', 'הראיון שלך עשה רעש לא טוב');
          notes.push('הראיון יצא עקום');
        } else pushHistory(world, 'interview', 'נתת ראיון לתקשורת');
        break;
      }
      case 'family': {
        user.morale = clamp(user.morale + 5, 0, 100);
        user.fitness = clamp(user.fitness + 5, 0, 100);
        if (circle.father) changeRelation(world.people[circle.father], user.id, 3);
        if (circle.mother) changeRelation(world.people[circle.mother], user.id, 3);
        break;
      }
      default: user.fitness = clamp(user.fitness - 4, 0, 100);
    }
  }
  return notes;
}

function minutesFactor(world: World): number {
  const mins = world.career.recentMinutes ?? [];
  if (!mins.length) return 0.6;
  const avgRatio = mins.reduce((s, m) => s + m, 0) / (mins.length * 90);
  return 0.45 + 0.55 * clamp(avgRatio, 0, 1);
}

function gapFactor(p: Footballer): number {
  return clamp((p.potential - ovr(p)) / DEV_TUNING.gapScale, 0, 1);
}

/** Weekly attribute growth for the user's player. Returns gains for the week report. */
export function applyTraining(world: World, plan: WeekPlan, rng: Rng): AttrGain[] {
  const user = userPlayer(world);
  const before = { ...user.attr };
  if (!user.injury) {
    const club = user.clubId != null ? world.clubs[user.clubId] : null;
    const facilities = club ? 0.85 + club.reputation / 400 : 0.9;
    const army = world.career.life.armyStatus === 'serving' ? 0.7 : 1;
    const f = ageFactor(user.age) * gapFactor(user) * minutesFactor(world) * facilities * army * (0.8 + user.morale / 250);
    for (const slot of plan) {
      if (slot.startsWith('train_')) {
        const key = slot.slice(6) as AttrKey;
        user.attr[key] = Math.min(99, user.attr[key] + DEV_TUNING.trainGain * f * rng.float(0.8, 1.2));
      } else if (slot === 'extra_gym') {
        user.attr.pace = Math.min(99, user.attr.pace + DEV_TUNING.gymGain * f);
        user.attr.stamina = Math.min(99, user.attr.stamina + DEV_TUNING.gymGain * f);
      }
    }
    const w = POS_WEIGHTS[user.pos];
    for (const k of ATTR_KEYS) if (w[k]) user.attr[k] = Math.min(99, user.attr[k] + DEV_TUNING.passiveGain * f * (w[k]! * 4));
  }
  applyAgeingWeekly(user);
  const gains: AttrGain[] = [];
  for (const k of ATTR_KEYS) if (Math.abs(user.attr[k] - before[k]) >= 0.005) gains.push({ key: k, before: before[k], after: user.attr[k] });
  return gains;
}

function applyAgeingWeekly(p: Footballer): void {
  if (p.age < 30) return;
  const a = p.age - 29;
  p.attr.pace = Math.max(5, p.attr.pace - 0.025 * a);
  p.attr.stamina = Math.max(5, p.attr.stamina - 0.02 * a);
  if (p.age <= 34) p.attr.vision = Math.min(99, p.attr.vision + 0.012);
  if (p.age >= 33) for (const k of ['finishing', 'dribbling', 'defending', 'heading', 'gk'] as AttrKey[]) p.attr[k] = Math.max(5, p.attr[k] - 0.01 * (p.age - 32));
}

const INJURY_KINDS: { kind: string; w: number; weeks: [number, number] }[] = [
  { kind: 'מתיחה', w: 70, weeks: [1, 2] },
  { kind: 'קרע', w: 25, weeks: [3, 6] },
  { kind: 'פציעה קשה', w: 5, weeks: [12, 30] },
];

/** Weekly injury roll for the user. Returns Hebrew line if injured. */
export function rollUserInjury(world: World, rng: Rng, plan: WeekPlan, minutes: number): string | null {
  const user = userPlayer(world);
  if (user.injury) return null;
  let p = 0.006 + (user.fitness < 40 ? 0.04 : user.fitness < 60 ? 0.012 : 0) + (minutes / 90) * 0.014;
  p += plan.filter((s) => s === 'extra_gym').length * 0.006;
  if (user.age >= 31) p *= 1.3;
  if (!rng.chance(p)) return null;
  return injureUser(world, rng);
}

export function injureUser(world: World, rng: Rng, weeks?: number): string {
  const user = userPlayer(world);
  const k = rng.weightedPick(INJURY_KINDS, (x) => x.w)!;
  const w = weeks ?? rng.int(k.weeks[0], k.weeks[1]);
  const kind = weeks != null ? (weeks <= 2 ? 'מתיחה' : weeks <= 8 ? 'קרע' : 'פציעה קשה') : k.kind;
  user.injury = { kind, weeksLeft: w };
  pushHistory(world, 'injury', `נפצעת (${kind})`);
  addNews(world, { kind: 'career', headline: `${user.name} נפצע: ${kind}, ${w} שבועות בחוץ` });
  return `${kind}: ${w} שבועות בחוץ`;
}

/** A sensible version of the plan for an automatic week: tired players get a rest day. */
export function autoPlan(p: Footballer, plan: WeekPlan): WeekPlan {
  if (p.fitness >= 60 || plan.includes('rest')) return plan;
  return [plan[0], plan[1], 'rest'];
}

/** Weekly recovery for every club footballer: fitness + injury countdown. */
export function weeklyRecovery(world: World): void {
  for (const c of world.clubs) {
    for (const id of c.squad) {
      const p = world.people[id] as Footballer;
      if (!p) continue;
      p.fitness = Math.min(100, p.fitness + (id === world.career.playerId ? 10 : 14));
      if (id === world.career.playerId) p.morale = clamp(p.morale + (62 - p.morale) * 0.08, 0, 100);
      if (p.injury) {
        p.injury.weeksLeft--;
        if (p.injury.weeksLeft <= 0) p.injury = null;
      }
    }
  }
}

/** Yearly NPC growth and decline, applied at season end (before ageing). */
export function npcSeasonDevelopment(world: World, rng: Rng): void {
  const userId = world.career.playerId;
  for (const c of world.clubs) {
    for (const id of c.squad) {
      if (id === userId) continue;
      const p = world.people[id] as Footballer;
      if (!p) continue;
      developNpc(p, rng);
    }
  }
}

export function developNpc(p: Footballer, rng: Rng): void {
  const o = ovr(p);
  let delta: number;
  const gap = p.potential - o;
  const cap = p.age <= 19 ? 6.5 : p.age <= 22 ? 5 : p.age <= 25 ? 2.5 : p.age <= 28 ? 1 : 0.3;
  delta = Math.max(0, Math.min(gap * rng.float(0.25, 0.45), cap * rng.float(0.6, 1.3)));
  if (p.age >= 30) delta -= (p.age - 29) * rng.float(0.5, 1.1);
  if (delta === 0) return;
  const w = POS_WEIGHTS[p.pos];
  for (const k of ATTR_KEYS) {
    if (!w[k] && !(p.pos === 'GK' && k === 'gk')) continue;
    let d = delta;
    if (p.age >= 30 && (k === 'pace' || k === 'stamina')) d *= 1.4;
    if (p.age >= 30 && k === 'vision') d = Math.abs(delta) * 0.2;
    p.attr[k] = Math.round(clamp(p.attr[k] + d, 3, 99) * 10) / 10;
  }
}

function isProtected(world: World, id: number): boolean {
  if (id === world.career.playerId || id === world.career.rivalId) return true;
  for (const v of Object.values(world.career.circle ?? {})) if (v === id) return true;
  const p = world.people[id];
  return !!p && !!p.relations[world.career.playerId] && Math.abs(p.relations[world.career.playerId].score) >= 10;
}

/** NPC retirements + youth regen to keep squads at 22. Returns notable retirement lines. */
export function retireAndRegen(world: World, content: Content, rng: Rng): string[] {
  const lines: string[] = [];
  const userId = world.career.playerId;
  const avgRepByLeague = new Map<number, number>();
  for (const lg of world.leagues) avgRepByLeague.set(lg.id, lg.clubIds.reduce((s, id) => s + world.clubs[id].reputation, 0) / Math.max(1, lg.clubIds.length));
  for (const c of world.clubs) {
    // retirements
    for (const id of c.squad.slice()) {
      if (id === userId) continue;
      const p = world.people[id] as Footballer;
      if (!p) { c.squad.splice(c.squad.indexOf(id), 1); continue; }
      const pr = p.age >= 38 ? 1 : p.age >= 33 ? 0.14 * (p.age - 32) : 0;
      if (pr > 0 && rng.chance(pr)) {
        retireNpc(world, c.squad, p);
        if (id === world.career.rivalId) lines.push(`${p.name} תלה את הנעליים`);
      }
    }
    // trim oversized squads (release the weakest, non-protected)
    while (c.squad.length > 26) {
      const cands = c.squad.map((id) => world.people[id] as Footballer).filter((p) => p && !isProtected(world, p.id));
      if (!cands.length) break;
      cands.sort((a, b) => ovr(a) - ovr(b));
      retireNpc(world, c.squad, cands[0]);
    }
    // regen
    const lg = world.leagues[c.leagueId];
    const lvl = clubLevel(lg, c.reputation, avgRepByLeague.get(lg.id) ?? c.reputation);
    while (c.squad.length < 22) {
      const counts: Record<string, number> = {};
      for (const id of c.squad) { const p = world.people[id] as Footballer; if (p) counts[p.pos] = (counts[p.pos] ?? 0) + 1; }
      const need: Record<string, number> = {};
      for (const pos of SQUAD_MIX) need[pos] = (need[pos] ?? 0) + 1;
      const pos = (Object.keys(need) as Position[]).sort((a, b) => ((counts[a] ?? 0) - need[a]) - ((counts[b] ?? 0) - need[b]))[0];
      const age = rng.int(17, 19);
      const t = clamp(lvl - 13 + rng.normal(0, 4), 15, 80);
      const f = makeFootballer(world, content, rng, pos, age, t, npcPotential(rng, t, age), c.id, rng.chance(0.85) ? c.countryCode : 'IL');
      c.squad.push(f.id);
    }
  }
  return lines;
}

function retireNpc(world: World, squad: number[], p: Footballer): void {
  const i = squad.indexOf(p.id);
  if (i >= 0) squad.splice(i, 1);
  p.retired = true;
  p.clubId = null;
  if (!isProtected(world, p.id)) delete world.people[p.id];
}

/** Hebrew "near goal" lines: attributes close to the next multiple of 10. */
export function nearAttrGoals(p: Footballer): { text: string; progress: number; target: number }[] {
  const out: { text: string; progress: number; target: number; gap: number }[] = [];
  const w = POS_WEIGHTS[p.pos];
  for (const k of ATTR_KEYS) {
    if (!w[k] && !(p.pos === 'GK' && k === 'gk')) continue;
    const v = p.attr[k];
    const next = Math.floor(v / 10) * 10 + 10;
    const gap = next - v;
    if (gap <= 1.5 && next <= 99) {
      const need = Math.max(1, Math.ceil(gap));
      out.push({ text: `עוד ${need} ל${ATTR_HE[k]} ${next}`, progress: Math.round((v - (next - 10)) * 10) / 10, target: 10, gap });
    }
  }
  return out.sort((a, b) => a.gap - b.gap).slice(0, 2).map(({ text, progress, target }) => ({ text, progress, target }));
}

export function relationNote(world: World, id: number): number {
  return relationOf(world.people[id], world.career.playerId);
}
