// Contract negotiation: hidden ceiling, agent range by archetype, 3 rounds with patience.
import type { Content } from './content';
import type { Club, Footballer, GamePhase, Negotiation, SquadRole, TransferOffer, World } from './types';
import type { Rng } from './rng';
import { addNews, changeRelation, clamp, fmtMoney, ovr, pushHistory, userPlayer } from './helpers';
import { wageFor } from './wages';
import { selectXI } from './matchSim';

export const ROLE_RANK: Record<SquadRole, number> = { backup: 0, prospect: 1, rotation: 2, starter: 3, star: 4 };
export const ROLE_HE: Record<SquadRole, string> = { star: 'כוכב', starter: 'הרכב', rotation: 'רוטציה', prospect: 'כישרון צעיר', backup: 'ספסל' };

export interface Demand { wage: number; role: SquadRole; years: number; releaseClause: number | null }

/** Average XI level of a club (by real XI). */
export function clubXiLevel(world: World, clubId: number, exclude?: number): number {
  return selectXI(world, clubId, exclude).overall;
}

/** How the club sees the player. */
export function clubViewRole(world: World, clubId: number, p: Footballer): SquadRole {
  const lvl = clubXiLevel(world, clubId, p.id);
  const o = ovr(p);
  if (o >= lvl + 5) return 'star';
  if (o >= lvl - 1.5) return 'starter';
  if (o >= lvl - 6) return 'rotation';
  if (p.age < 20) return 'prospect';
  return 'backup';
}

/** Fair monthly wage at a club for this player. */
export function marketWage(world: World, content: Content, clubId: number, p: Footballer): number {
  const c = world.clubs[clubId];
  const lg = world.leagues[c.leagueId];
  const q = (ovr(p) - (lg.strength - 14)) / 26;
  const fame = 1 + world.career.fame / 300;
  const base = wageFor(content, lg, p.age, q) * (0.78 + c.reputation / 230) * (p.id === world.career.playerId ? fame : 1);
  return Math.round(base / 100) * 100;
}

/** Transfer value in NIS. */
export function playerValue(world: World, content: Content, p: Footballer): number {
  const clubId = p.clubId ?? 0;
  const w = marketWage(world, content, clubId, p);
  const ageF = p.age <= 21 ? 2.2 : p.age <= 24 ? 1.8 : p.age <= 28 ? 1.3 : p.age <= 31 ? 0.7 : 0.3;
  const potF = 1 + Math.max(0, p.potential - ovr(p)) / 40;
  return Math.round((w * 12 * 2.5 * ageF * potF) / 10000) * 10000;
}

export function coachDesire(world: World, clubId: number, p: Footballer): number {
  const c = world.clubs[clubId];
  const lvl = clubXiLevel(world, clubId, p.id);
  const coach = world.people[c.managerId];
  let d = 1 + clamp((ovr(p) - lvl) / 30, -0.2, 0.25);
  if (coach?.traits.includes('prefers_youth') && p.age < 22) d += 0.08;
  const rel = coach?.relations[p.id]?.score ?? 0;
  if (p.clubId === clubId) d += rel / 400;
  return clamp(d, 0.75, 1.3);
}

function budgetFactor(world: World, c: Club): number {
  const lg = world.leagues[c.leagueId];
  const avg = lg.clubIds.reduce((s, id) => s + world.clubs[id].budget, 0) / Math.max(1, lg.clubIds.length);
  return clamp(Math.sqrt(c.budget / Math.max(1, avg)), 0.75, 1.35);
}

/** Hidden wage ceiling for a given role/clause/years combination. */
export function ceilingFor(base: number, role: SquadRole, clubRole: SquadRole, releaseClause: number | null, value: number, years: number): number {
  let c = base;
  if (ROLE_RANK[role] >= ROLE_RANK.starter && ROLE_RANK[role] <= ROLE_RANK[clubRole]) c *= role === 'star' ? 0.93 : 0.96; // a guaranteed role costs some wage
  if (releaseClause != null) c *= releaseClause < value ? 1.1 : 1.05; // a clause (esp. low) is compensated with wage
  c *= 1 + clamp(years - 3, -2, 2) * 0.015;
  return Math.round(c);
}

export function agentRange(world: World, rng: Rng, ceiling: number): [number, number] {
  const ag = world.people[world.career.agentId];
  const a = ag?.archetype ?? 'uncle';
  let centre: number, w: number;
  if (a === 'mentor') { centre = ceiling * (1 + rng.normal(0, 0.03)); w = 0.1; }
  else if (a === 'shark') { centre = ceiling * (1.07 + rng.normal(0, 0.04)); w = 0.2; }
  else { centre = ceiling * (1 + rng.normal(0, 0.12)); w = 0.3; }
  const r100 = (x: number): number => Math.round(x / 100) * 100;
  return [r100(centre * (1 - w)), r100(centre * (1 + w))];
}

export function openNegotiation(world: World, content: Content, rng: Rng, clubId: number, offer: TransferOffer | null, returnPhase: GamePhase): Negotiation | string {
  const user = userPlayer(world);
  const c = world.clubs[clubId];
  const chair = world.people[c.chairmanId];
  const walked = chair?.relations[user.id]?.memories.find((m) => m.tag === 'walked_away' && world.absWeek - m.week < 40);
  if (walked) return `${c.name} עוד זוכרים שהשיחות האחרונות התפוצצו. הם לא מוכנים לשבת כרגע.`;
  const clubRole = clubViewRole(world, clubId, user);
  if (!offer && user.contract) {
    const left = user.contract.endSeason - world.season.number;
    const better = ROLE_RANK[clubRole] > ROLE_RANK[user.contract.role];
    if (left > 1 && !better) return 'המועדון לא ממהר לחדש. החוזה שלך עוד ארוך.';
    if (clubRole === 'backup' && user.age >= 22 && rng.chance(0.5)) return 'המועדון לא מעוניין לחדש כרגע.';
  }
  const base = marketWage(world, content, clubId, user) * coachDesire(world, clubId, user) * budgetFactor(world, c);
  const value = playerValue(world, content, user);
  const years = offer?.years ?? (user.age < 29 ? 3 : 2);
  const hidden = ceilingFor(base, clubRole, clubRole, null, value, years);
  const startWage = offer ? offer.wage : Math.round((hidden * rng.float(0.72, 0.85)) / 100) * 100;
  const neg: Negotiation = {
    clubId, offerId: offer ? offer.id : null, round: 1, patience: 100, hiddenCeiling: Math.round(base),
    agentRange: agentRange(world, rng, hidden),
    currentOffer: { wage: startWage, role: offer?.role ?? clubRole, years, releaseClause: null },
    log: [`${c.name} מציעים ${fmtMoney(startWage)} לחודש, תפקיד: ${ROLE_HE[offer?.role ?? clubRole]}, ${years} שנים.`],
    status: 'open', returnPhase,
  };
  world.career.negotiation = neg;
  return neg;
}

/** One round. Mutates world.career.negotiation. Returns the club's reply line. */
export function negotiateRound(world: World, content: Content, rng: Rng, demand: Demand): string {
  const neg = world.career.negotiation;
  if (!neg || neg.status !== 'open') return 'אין משא ומתן פתוח';
  const user = userPlayer(world);
  const c = world.clubs[neg.clubId];
  const clubRole = clubViewRole(world, neg.clubId, user);
  const value = playerValue(world, content, user);
  const years = clamp(Math.round(demand.years), 1, 5);
  const ceiling = ceilingFor(neg.hiddenCeiling, demand.role, clubRole, demand.releaseClause, value, years);
  const roleGap = ROLE_RANK[demand.role] - ROLE_RANK[clubRole];
  const wageGap = (demand.wage - ceiling) / ceiling;
  neg.log.push(`דרשת ${fmtMoney(demand.wage)}, ${ROLE_HE[demand.role]}, ${years} שנים${demand.releaseClause != null ? `, סעיף שחרור ${fmtMoney(demand.releaseClause)}` : ''}.`);
  if (wageGap <= 0 && roleGap <= 0 && (demand.releaseClause == null || demand.releaseClause >= value * 0.6)) {
    neg.currentOffer = { wage: Math.round(demand.wage), role: demand.role, years, releaseClause: demand.releaseClause };
    const line = `${c.name} מסכימים. אפשר לחתום.`;
    neg.log.push(line);
    return line;
  }
  let drop = 8 + Math.max(0, wageGap) * 140 + Math.max(0, roleGap) * 12;
  if (demand.releaseClause != null && demand.releaseClause < value * 0.6) drop += 10;
  neg.patience = Math.round(neg.patience - drop);
  if (neg.patience <= 0 || neg.round >= 3) {
    neg.status = 'walked_away';
    const chair = world.people[c.chairmanId];
    changeRelation(chair, user.id, -8, { tag: 'walked_away', week: world.absWeek, weight: -15 });
    pushHistory(world, 'talks_collapsed', `השיחות עם ${c.name} התפוצצו`);
    if (neg.offerId != null) world.career.offers = world.career.offers.filter((o) => o.id !== neg.offerId);
    const line = `${c.name} קמים מהשולחן. "אין על מה לדבר."`;
    neg.log.push(line);
    return line;
  }
  neg.round++;
  const target = Math.min(ceiling, Math.max(neg.currentOffer.wage, demand.wage));
  const last = neg.round >= 3;
  const wage = last ? Math.round(ceiling * rng.float(0.96, 1.0)) : Math.round(neg.currentOffer.wage + (target - neg.currentOffer.wage) * rng.float(0.4, 0.7));
  neg.currentOffer = {
    wage: Math.round(Math.min(wage, demand.wage) / 100) * 100,
    role: roleGap > 0 ? clubRole : demand.role,
    years,
    releaseClause: demand.releaseClause != null && demand.releaseClause < value * 0.6 ? Math.round(value * 0.8 / 10000) * 10000 : demand.releaseClause,
  };
  const line = `${c.name} משפרים ל${fmtMoney(neg.currentOffer.wage)}${roleGap > 0 ? `, אבל תפקיד ${ROLE_HE[clubRole]}` : ''}.${last ? ' זו ההצעה האחרונה.' : ''}`;
  neg.log.push(line);
  return line;
}

/** Sign the current offer. Moves the player if it is a transfer. */
export function acceptCurrent(world: World, content: Content): string[] {
  const neg = world.career.negotiation;
  if (!neg || neg.status !== 'open') return [];
  const user = userPlayer(world);
  const c = world.clubs[neg.clubId];
  const o = neg.currentOffer;
  const lines: string[] = [];
  const offer = neg.offerId != null ? world.career.offers.find((x) => x.id === neg.offerId) : null;
  const endSeason = world.season.number + o.years - (world.phase === 'offseason' || neg.returnPhase === 'offseason' ? 0 : 1);
  if (offer && user.clubId !== neg.clubId) {
    moveUser(world, content, neg.clubId, offer.fee);
    lines.push(`חתמת ב${c.name}!`);
    world.career.offers = [];
    world.history.flags.last_move_week = world.absWeek;
  } else lines.push(`חתמת על חוזה חדש ב${c.name}`);
  user.contract = {
    clubId: neg.clubId, monthlyWage: o.wage, endSeason: Math.max(endSeason, world.season.number), role: o.role,
    releaseClause: o.releaseClause, bonuses: [{ kind: 'goal', amount: Math.round(o.wage * 0.05 / 100) * 100 }, { kind: 'appearance', amount: Math.round(o.wage * 0.02 / 100) * 100 }],
  };
  neg.status = 'signed';
  pushHistory(world, 'signed', `חתמת ב${c.name} על ${fmtMoney(o.wage)} לחודש`);
  world.career.offers = world.career.offers.filter((x) => x.id !== neg.offerId);
  return lines;
}

export function userWalkAway(world: World): string {
  const neg = world.career.negotiation;
  if (!neg || neg.status !== 'open') return '';
  const user = userPlayer(world);
  const c = world.clubs[neg.clubId];
  neg.status = 'walked_away';
  changeRelation(world.people[c.chairmanId], user.id, -3, { tag: 'player_walked', week: world.absWeek, weight: -5 });
  if (neg.offerId != null) world.career.offers = world.career.offers.filter((o) => o.id !== neg.offerId);
  neg.log.push('קמת מהשולחן.');
  return `עזבת את השיחות עם ${c.name}`;
}

/** Move the user to another club (transfer). */
export function moveUser(world: World, _content: Content, toClubId: number, fee: number): void {
  const user = userPlayer(world);
  const from = user.clubId != null ? world.clubs[user.clubId] : null;
  const to = world.clubs[toClubId];
  if (from) {
    const i = from.squad.indexOf(user.id);
    if (i >= 0) from.squad.splice(i, 1);
    from.budget += Math.round(fee * 0.3);
  }
  to.squad.push(user.id);
  to.budget = Math.max(0, to.budget - Math.round(fee * 0.1));
  user.clubId = toClubId;
  user.form = Math.round(user.form / 2);
  const fromCountry = from ? from.countryCode : 'IL';
  const coach = world.people[to.managerId];
  if (coach && !coach.relations[user.id]) changeRelation(coach, user.id, 8);
  if (to.countryCode !== fromCountry) {
    world.career.life.home = 'rented';
    user.morale = clamp(user.morale - 6, 0, 100); // adaptation
    pushHistory(world, to.countryCode !== 'IL' ? 'moved_abroad' : 'came_home', to.countryCode !== 'IL' ? `עברת ל${to.name} בחו״ל` : `חזרת הביתה ל${to.name}`);
    world.history.flags.abroad_moves = (world.history.flags.abroad_moves ?? 0) + (to.countryCode !== 'IL' ? 1 : 0);
  }
  pushHistory(world, 'transfer', `עברת מ${from?.name ?? 'בלי קבוצה'} ל${to.name}`);
  addNews(world, { kind: 'transfer', headline: `${user.name} עובר ל${to.name}`, body: fee > 0 ? `סכום ההעברה: ${fmtMoney(fee)}` : undefined });
  world.career.fame = clamp(world.career.fame + Math.max(1, Math.round(to.reputation / 25)), 0, 100);
}
