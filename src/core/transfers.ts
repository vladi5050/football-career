// Transfer market: windows, NPC signings (user's league + 3 nearby), offers to the user, sackings.
import type { Content } from './content';
import type { Club, Footballer, League, SquadRole, TransferOffer, World } from './types';
import type { Rng } from './rng';
import { addNews, avg, changeRelation, clamp, fmtMoney, ovr, pushHistory, userClub, userPlayer, pre } from './helpers';
import { isWindowOpen, sortedTable } from './schedule';
import { BIG5, clubLevel, makePerson, materializeClub } from './worldGen';
import { clubViewRole, marketWage, playerValue, wageCap } from './negotiation';
import { selectXI } from './matchSim';

export const TRANSFER_TUNING = { weeklyBase: 0.01 };

export type OfferKind = 'any' | 'abroad' | 'bigger' | 'lower';

/** User's league + 3 closest leagues (same country first, then by strength). */
export function activeLeagues(world: World): League[] {
  const c = userClub(world);
  if (!c) return world.leagues.slice(0, 4);
  const mine = world.leagues[c.leagueId];
  const others = world.leagues.filter((l) => l.id !== mine.id)
    .sort((a, b) => (a.countryCode === mine.countryCode ? 0 : 1) - (b.countryCode === mine.countryCode ? 0 : 1) || Math.abs(a.strength - mine.strength) - Math.abs(b.strength - mine.strength));
  return [mine, ...others.slice(0, 3)];
}

function estLevel(world: World, c: Club): number {
  const lg = world.leagues[c.leagueId];
  const avgRep = avg(lg.clubIds.map((id) => world.clubs[id].reputation));
  return clubLevel(lg, c.reputation, avgRep);
}

const NOTES: Record<string, string[]> = {
  shark: [
    'יש לי משהו גדול בשבילך. {club} רוצים אותך, ואני אוציא מהם יותר.',
    'תקשיב, {club} על הקו. אל תתלהב, אני אסחט אותם.',
    '{club} שלחו הצעה. זו רק נקודת פתיחה, תסמוך עליי.',
  ],
  mentor: [
    '{club} מתעניינים. בוא נחשוב בשקט אם זה הצעד הנכון בשבילך.',
    'הגיעה פנייה מ{club}. יש שם מקום לשחק, וזה מה שחשוב בגיל הזה.',
    '{club} רוצים לדבר. אני לא לוחצת, תחליט אתה.',
  ],
  uncle: [
    'חביבי, {club} התקשרו! אמרתי להם שאתה הכי טוב בארץ.',
    'שמע, דיברתי עם החבר שלי ב{club}. הם רוצים אותך, לא יודע כמה בדיוק.',
    '{club} שלחו משהו. יאללה, נראה מה יוצא מזה.',
  ],
};

export function agentNote(world: World, rng: Rng, clubName: string): string {
  const ag = world.people[world.career.agentId];
  const list = NOTES[ag?.archetype ?? 'uncle'];
  return rng.pick(list).replace('{club}', clubName);
}

/** Where Israeli players typically move abroad (multiplier on offer weight). Big-five and others are scaled by fame and level. */
export const ABROAD_DESTINATIONS: Record<string, number> = { BE: 1.6, NL: 1.4, CY: 1.6, GR: 1.4, AT: 1.3, PL: 1.3, US: 1.2, PT: 1.0, CH: 1.0, DK: 0.9, SE: 0.8, NO: 0.8, RO: 0.9, BG: 0.8, HR: 0.8, RS: 0.7, TR: 1.0, SC: 0.7, CZ: 0.8, HU: 0.8, SK: 0.7 };

/** Create a transfer offer to the user. Any club in any league can ask, low tiers included. */
export function spawnOffer(world: World, content: Content, rng: Rng, kind: OfferKind): TransferOffer | null {
  const user = userPlayer(world);
  const mine = userClub(world);
  if (!mine || world.career.retired) return null;
  if (world.career.offers.length >= 4) return null;
  // a fresh signing is left alone for a while
  const lastMove = world.history.flags.last_move_week;
  if (lastMove != null && world.absWeek - lastMove < 26 && kind !== 'lower') return null;
  const o = ovr(user);
  const home = world.leagues[mine.leagueId];
  const homeCountry = home.countryCode;
  const mineLvl = estLevel(world, mine);
  // 'lower' = a step down to play: mostly the same country
  const pool = kind === 'abroad' ? world.leagues.filter((l) => l.countryCode !== homeCountry)
    : kind === 'lower' ? world.leagues.filter((l) => l.countryCode === homeCountry || l.countryCode === 'IL') : world.leagues;
  const cands: { c: Club; w: number }[] = [];
  for (const lg of pool) {
    let sum = 0;
    for (const id of lg.clubIds) sum += world.clubs[id].reputation;
    const avgRep = sum / Math.max(1, lg.clubIds.length);
    const jump = lg.strength - home.strength;
    let lw = 1;
    if (jump > 6) lw *= Math.exp(-(jump - 6) / 4); // scouts mostly watch similar levels: big jumps are rare
    if (lg.countryCode !== homeCountry) {
      lw *= o >= 64 ? 0.25 : 0.07;
      if (user.nationality === 'IL' && lg.countryCode !== 'IL') lw *= ABROAD_DESTINATIONS[lg.countryCode] ?? (lg.strength >= 75 ? 1 : 0.4);
    }
    if (lg.tier === 2 && BIG5.includes(lg.countryCode) && homeCountry !== lg.countryCode) lw *= 0.7; // a promotion away from the giants
    if (lg.strength >= 75) lw *= 0.45 * clamp((world.career.fame / 80) ** 2, 0.03, 1); // the big leagues scout names, and rarely
    if (lg.tier >= 3) lw *= user.age >= 31 ? 1.2 : user.age >= 26 ? 0.6 : 0.35; // low tiers call veterans
    if (lw < 1e-4) continue;
    for (const id of lg.clubIds) {
      if (id === mine.id || world.career.offers.some((x) => x.fromClubId === id)) continue;
      const c = world.clubs[id];
      if (kind === 'bigger' && c.reputation <= mine.reputation + 3) continue;
      const lvl = clubLevel(lg, c.reputation, avgRep);
      if (kind === 'lower' && lvl > mineLvl - 2) continue;
      const d = o - lvl; // >0 he would be a starter there
      if (d < -2 || d > (user.age >= 31 ? 30 : 14)) continue;
      const w = lw * Math.exp(-Math.abs(d - 3) / 4) * (0.5 + c.reputation / 100);
      cands.push({ c, w });
    }
  }
  const pick = rng.weightedPick(cands, (x) => x.w);
  if (!pick) return null;
  const c = pick.c;
  materializeClub(world, content, c.id);
  const role: SquadRole = clubViewRole(world, c.id, user);
  const value = playerValue(world, content, user);
  let fee = Math.round((value * rng.float(0.7, 1.1)) / 10000) * 10000;
  if (user.contract?.releaseClause != null) fee = Math.min(fee, user.contract.releaseClause);
  if (user.contract && user.contract.endSeason <= world.season.number) fee = 0; // free agent at season end
  const wage = Math.round((Math.min(marketWage(world, content, c.id, user), wageCap(world, c.id, user) / 1.15) * rng.float(0.78, 0.92)) / 100) * 100;
  const offer: TransferOffer = {
    id: world.nextId++, fromClubId: c.id, fee, wage, role, years: user.age < 28 ? rng.int(3, 4) : rng.int(1, 2),
    expiresWeek: world.absWeek + rng.int(2, 4), viaAgentNote: agentNote(world, rng, c.name),
  };
  world.career.offers.push(offer);
  pushHistory(world, 'offer', `${c.name} הגישו הצעה`);
  return offer;
}

export function expireOffers(world: World): void {
  world.career.offers = world.career.offers.filter((o) => o.expiresWeek >= world.absWeek);
}

/** Weekly chance of an offer during windows. */
export function weeklyOffers(world: World, content: Content, rng: Rng): TransferOffer | null {
  if (!isWindowOpen(world) || world.career.retired) return null;
  const user = userPlayer(world);
  const ratings = world.career.recentRatings ?? [];
  const avgR = ratings.length ? avg(ratings) : 6.3;
  const mins = world.career.recentMinutes ?? [];
  const avgMin = mins.length ? avg(mins) : 0;
  let p = TRANSFER_TUNING.weeklyBase + world.career.fame / 900 + Math.max(0, avgR - 6.9) * 0.08 + (user.stats.goals >= 10 ? 0.02 : 0);
  if (user.age < 17) p *= 0.4;
  let kind: OfferKind = rng.chance(0.25) ? 'bigger' : rng.chance(0.15) ? 'abroad' : 'any';
  if (avgMin < 30 && user.age >= 18) { p += 0.08; kind = 'lower'; }
  if (!rng.chance(p)) return null;
  return spawnOffer(world, content, rng, kind) ?? (kind !== 'any' ? spawnOffer(world, content, rng, 'any') : null);
}

/** NPC transfers inside the active leagues. Returns "meanwhile" lines. */
export function npcTransfers(world: World, content: Content, rng: Rng): string[] {
  if (!isWindowOpen(world)) return [];
  const lines: string[] = [];
  const leagues = activeLeagues(world);
  const clubIds = leagues.flatMap((l) => l.clubIds).filter((id) => !world.clubs[id].lazy);
  const userId = world.career.playerId;
  for (const buyerId of clubIds) {
    if (!rng.chance(0.1)) continue;
    const buyer = world.clubs[buyerId];
    const xi = selectXI(world, buyerId);
    // weakest slot relative to the XI average
    let worst = -1, worstVal = Infinity;
    xi.xi.forEach((id, i) => {
      const v = id >= 0 ? ovr(world.people[id] as Footballer) : 0;
      if (v < worstVal) { worstVal = v; worst = i; }
    });
    if (worst < 0) continue;
    const pos = xi.slots[worst];
    const budget = buyer.budget * 0.12;
    let best: Footballer | null = null;
    for (let tries = 0; tries < 30; tries++) {
      const sellerId = rng.pick(clubIds);
      if (sellerId === buyerId) continue;
      const seller = world.clubs[sellerId];
      if (seller.reputation > buyer.reputation + 5 || seller.squad.length <= 19) continue;
      const pid = rng.pick(seller.squad);
      const p = world.people[pid] as Footballer;
      if (!p || pid === userId || p.pos !== pos || p.injury) continue;
      if (ovr(p) < worstVal + 2) continue;
      if (playerValue(world, content, p) > budget) continue;
      if (!best || ovr(p) > ovr(best)) best = p;
    }
    if (!best) continue;
    const seller = world.clubs[best.clubId!];
    const fee = playerValue(world, content, best);
    seller.squad.splice(seller.squad.indexOf(best.id), 1);
    buyer.squad.push(best.id);
    best.clubId = buyer.id;
    buyer.budget -= Math.round(fee * 0.2);
    seller.budget += Math.round(fee * 0.2);
    const line = `${buyer.name} החתימה את ${best.name} ${pre('מ', seller.name)}`;
    if (best.id === world.career.rivalId) {
      lines.unshift(`המתחרה שלך ${best.name} עבר ${pre('ל', buyer.name)}`);
      pushHistory(world, 'rival_moved', `${best.name} עבר ${pre('ל', buyer.name)}`);
      addNews(world, { kind: 'rival', headline: `${best.name} עובר ${pre('ל', buyer.name)}` });
    } else if (buyer.leagueId === userClub(world)?.leagueId || seller.leagueId === userClub(world)?.leagueId) {
      lines.push(line);
      if (fee > 0) addNews(world, { kind: 'transfer', headline: line, body: `לפי הדיווחים: ${fmtMoney(fee)}` });
    }
    // release the weakest at the buyer if squad is too big
    if (buyer.squad.length > 26) {
      const weakest = buyer.squad.map((id) => world.people[id] as Footballer).filter((p) => p && p.id !== userId && p.id !== world.career.rivalId).sort((a, b) => ovr(a) - ovr(b))[0];
      if (weakest) { buyer.squad.splice(buyer.squad.indexOf(weakest.id), 1); weakest.clubId = null; weakest.retired = true; }
    }
  }
  return lines.slice(0, 4);
}

/** Manager sackings after bad runs. Returns meanwhile lines. */
export function sackings(world: World, content: Content, rng: Rng): string[] {
  if (world.season.week < 6) return [];
  const lines: string[] = [];
  const mine = userClub(world);
  // only the leagues the user follows (his own + nearby): far-away coaching changes are noise and cost
  for (const lg of activeLeagues(world)) {
    const rows = sortedTable(world.season.tables[lg.id] ?? []);
    const n = rows.length;
    rows.forEach((r, i) => {
      if (r.form.length < 5) return;
      const pts = r.form.reduce((s, f) => s + (f === 'W' ? 3 : f === 'D' ? 1 : 0), 0);
      if (pts > 2 || i < n * 0.55) return;
      const c = world.clubs[r.clubId];
      const p = (c.reputation > 60 ? 0.3 : 0.15) * (lg.id === mine?.leagueId ? 1 : 0.6);
      if (!rng.chance(p)) return;
      const old = world.people[c.managerId];
      const pool: number[] = [];
      for (const k in world.people) { const pp = world.people[k]; if (pp.role === 'coach' && pp.clubId == null && pp.nationality === c.countryCode) pool.push(pp.id); }
      let newId: number;
      if (pool.length && rng.chance(0.5)) newId = rng.pick(pool);
      else newId = makePerson(world, content, rng, 'coach', c.countryCode, rng.int(38, 60), null).id;
      const nm = world.people[newId];
      nm.clubId = c.id;
      if (old) old.clubId = null;
      c.managerId = newId;
      r.form = []; // fresh start, avoids double sacking
      const line = `${c.name} פיטרה את ${old?.name ?? 'המאמן'}. ${nm.name} מחליף אותו`;
      if (mine && c.id === mine.id) {
        pushHistory(world, 'coach_sacked', `${old?.name ?? 'המאמן'} פוטר`);
        addNews(world, { kind: 'sacking', headline: line });
        const user = userPlayer(world);
        if (!nm.relations[user.id]) changeRelation(nm, user.id, 0);
        lines.unshift(line);
      } else if (mine && lg.id === mine.leagueId) {
        addNews(world, { kind: 'sacking', headline: line });
        lines.push(line);
      }
    });
  }
  return lines;
}

/** Offseason NPC clean-up of budgets and reputations by final table. */
export function seasonEndClubs(world: World): void {
  for (const lg of world.leagues) {
    const rows = sortedTable(world.season.tables[lg.id] ?? []);
    rows.forEach((r, i) => {
      const c = world.clubs[r.clubId];
      const n = rows.length;
      const d = i === 0 ? 2 : i < 3 ? 1 : i >= n - 3 ? -1 : 0;
      c.reputation = clamp(c.reputation + d, 5, 99);
    });
  }
}
