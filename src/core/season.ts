// Season start/end: themes, records, trophies, promotion/relegation, ageing, retirement, national team.
import type { Content } from './content';
import type { Footballer, World } from './types';
import type { Rng } from './rng';
import { addNews, avg, changeRelation, clamp, ovr, pushHistory, userClub, userLeague, userPlayer } from './helpers';
import { buildSeason, promoteRelegate, sortedTable, tablePosition } from './schedule';
import { npcSeasonDevelopment, retireAndRegen } from './development';
import { emptyStats } from './worldGen';
import { seasonEndClubs } from './transfers';
import { updateGoals } from './goals';

export const RETIRE_PROMPT_AGE = 33;
export const NATIONAL_TUNING = { callUp: 72.5, keep: 70.5 };
export const RETIRE_FORCED_AGE = 39;

export function pickThemes(content: Content, rng: Rng): string[] {
  const ids = content.themes.map((t) => t.id);
  return rng.shuffle(ids.slice()).slice(0, 2);
}

/** Create season `number` (fixtures, tables, themes) and reset season stats. */
export function startSeason(world: World, content: Content, rng: Rng, number: number, year: number): void {
  world.season = buildSeason(world, rng, number, year, pickThemes(content, rng));
  for (const c of world.clubs) for (const id of c.squad) {
    const p = world.people[id] as Footballer;
    if (p && p.role === 'player') p.stats = emptyStats();
  }
  const u = userPlayer(world);
  if (u.clubId == null) u.stats = emptyStats();
  const themes = world.season.themes.map((id) => content.themes.find((t) => t.id === id)?.name).filter(Boolean);
  addNews(world, { kind: 'league', headline: `עונה ${number} יוצאת לדרך`, body: themes.length ? `נושאי העונה: ${themes.join(', ')}` : undefined });
  updateGoals(world);
}

export interface SeasonEndReport { lines: string[]; champion: boolean; promoted: boolean; relegated: boolean; forcedRetire: boolean }

/** Close the season. Leaves world.season as the finished season (tables) until startSeason is called. */
export function endSeason(world: World, content: Content, rng: Rng): SeasonEndReport {
  const lines: string[] = [];
  const u = userPlayer(world);
  const c = userClub(world);
  const lg = userLeague(world);
  const pos = c ? tablePosition(world, c.id) : 0;
  if (c && lg) {
    world.career.history.push({
      season: world.season.number, year: world.season.year, clubId: c.id, leagueId: lg.id, apps: u.stats.apps, goals: u.stats.goals,
      assists: u.stats.assists, avgRating: u.stats.apps ? Math.round((u.stats.ratingSum / u.stats.apps) * 100) / 100 : 0, position: pos,
    });
  }
  // champions everywhere (news), user's trophy
  let champion = false;
  for (const l of world.leagues) {
    const rows = sortedTable(world.season.tables[l.id] ?? []);
    if (!rows.length) continue;
    const champ = world.clubs[rows[0].clubId];
    if (lg && l.id === lg.id) {
      lines.push(`${champ.name} אלופת ${l.name}`);
      if (c && champ.id === c.id) {
        champion = true;
        const t = `אליפות ${l.name} ${world.season.year}`;
        world.career.trophies.push(t);
        pushHistory(world, 'title', `זכית ב${t}`);
        world.career.fame = clamp(world.career.fame + 6, 0, 100);
      }
    }
  }
  // top scorer note in the user's league
  if (lg) {
    let best: Footballer | null = null;
    for (const id of lg.clubIds) for (const pid of world.clubs[id].squad) {
      const p = world.people[pid] as Footballer;
      if (p && (!best || p.stats.goals > best.stats.goals)) best = p;
    }
    if (best && best.stats.goals > 0) lines.push(`מלך השערים: ${best.name} עם ${best.stats.goals}`);
  }
  const rival = world.people[world.career.rivalId] as Footballer | undefined;
  if (rival && rival.stats.apps > 0) lines.push(`${rival.name} סיים עם ${rival.stats.goals} שערים ב${rival.stats.apps} הופעות`);

  const moves = promoteRelegate(world);
  const promoted = !!c && moves.promoted.includes(c.id);
  const relegated = !!c && moves.relegated.includes(c.id);
  if (promoted) { world.career.trophies.push(`עלייה ליגה עם ${c!.name} ${world.season.year}`); pushHistory(world, 'promoted', `עלית ליגה עם ${c!.name}`); }
  if (relegated) pushHistory(world, 'relegated', `ירדת ליגה עם ${c!.name}`);
  lines.push(...moves.lines.filter((l) => !c || l.includes(c.name) || moves.lines.length <= 6).slice(0, 6));
  seasonEndClubs(world);

  // NPC development + ageing + retirement + regen
  npcSeasonDevelopment(world, rng);
  for (const k in world.people) {
    const p = world.people[k];
    if (p.id !== u.id) p.age++;
  }
  lines.push(...retireAndRegen(world, content, rng));
  retireOldStaff(world, content, rng);

  // memories fade a little: fame and relations drift toward neutral (family excepted)
  world.career.fame = Math.round(world.career.fame * 0.9 * 10) / 10;
  for (const k in world.people) {
    const p = world.people[k];
    const r = p.relations[u.id];
    if (r && p.role !== 'family') r.score = Math.round(r.score * 0.85);
  }
  // the user
  u.age++;
  world.career.seasonsPlayed++;
  u.form = Math.round(u.form / 2);
  u.morale = clamp(u.morale + 5, 0, 100);
  updateLifeStage(world, rng);
  // captaincy: old enough, important, liked by the coach
  if (c && !world.career.captain && u.age >= 27 && ovr(u) >= avg(c.squad.map((id) => ovr(world.people[id] as Footballer))) + 4) {
    const coach = world.people[c.managerId];
    if ((coach?.relations[u.id]?.score ?? 0) >= 20 || u.age >= 29) {
      world.career.captain = true;
      lines.push(`${u.name} מונה לקפטן של ${c.name}`);
      pushHistory(world, 'captain', `מונית לקפטן של ${c.name}`);
    }
  }
  let forcedRetire = false;
  if (u.age >= RETIRE_FORCED_AGE) {
    forcedRetire = true;
  } else if (u.age >= RETIRE_PROMPT_AGE) {
    addNews(world, { kind: 'career', headline: `בגיל ${u.age}, כולם שואלים: עוד עונה?` });
  }
  for (const l of lines.slice(0, 3)) addNews(world, { kind: 'league', headline: l });
  return { lines, champion, promoted, relegated, forcedRetire };
}

function retireOldStaff(world: World, content: Content, rng: Rng): void {
  void content; void rng;
  for (const c of world.clubs) {
    const m = world.people[c.managerId];
    if (m && m.age >= 70) {
      // promote someone from the free pool or keep the job open for a fresh face
      m.clubId = null;
      let pick: number | null = null;
      for (const k in world.people) { const p = world.people[k]; if (p.role === 'coach' && p.clubId == null && p.age < 66 && p.id !== m.id) { pick = p.id; break; } }
      if (pick != null) { c.managerId = pick; world.people[pick].clubId = c.id; } else m.clubId = c.id;
    }
  }
}

function updateLifeStage(world: World, rng: Rng): void {
  const u = userPlayer(world);
  const life = world.career.life;
  const lg = userLeague(world);
  if (u.age >= 18 && life.armyStatus === 'none') {
    if (world.career.startKind === 'raised_abroad' || (lg && lg.countryCode !== 'IL')) life.armyStatus = 'exempt';
    else if (ovr(u) >= 52 || (lg && lg.tier === 1)) life.armyStatus = 'outstanding_athlete';
    else life.armyStatus = 'serving';
    pushHistory(world, 'army', life.armyStatus === 'serving' ? 'התגייסת לצבא' : life.armyStatus === 'outstanding_athlete' ? 'קיבלת מעמד ספורטאי מצטיין' : 'קיבלת פטור משירות');
  }
  if (u.age >= 21 && (life.armyStatus === 'serving' || life.armyStatus === 'outstanding_athlete')) life.armyStatus = 'done';
  life.stage = u.age < 18 ? 'youth' : life.armyStatus === 'serving' ? 'army' : u.age >= 29 ? 'veteran' : 'pro';
  if (u.age >= 19 && life.home === 'parents' && world.career.money > 60000) life.home = 'rented';
  if (u.age >= 26 && life.home === 'rented' && world.career.money > 1_500_000) { life.home = 'own'; world.career.money -= 1_200_000; }
  if (!life.partner && u.age >= 22 && rng.chance(0.25)) {
    life.partner = rng.pick(['נועה', 'שירה', 'מאיה', 'יעל', 'דנה', 'רוני']);
    pushHistory(world, 'partner', `הכרת את ${life.partner}`);
  }
  if (life.partner && u.age >= 26 && life.kids < 3 && rng.chance(0.2)) { life.kids++; pushHistory(world, 'baby', 'נולד לך ילד'); }
}

/** National team call-ups during international windows. Returns Hebrew line or null. */
export function nationalWindow(world: World, rng: Rng): string | null {
  const u = userPlayer(world);
  if (u.injury || world.career.retired) return null;
  const o = ovr(u);
  const threshold = world.career.nationalCaps > 10 ? NATIONAL_TUNING.keep : NATIONAL_TUNING.callUp;
  const ratings = world.career.recentRatings ?? [];
  const form = ratings.length ? avg(ratings) : 6.3;
  if (o + (form - 6.5) * 3 < threshold || u.age < 18) return null;
  const first = world.career.nationalCaps === 0;
  world.career.nationalCaps += 1;
  world.history.flags.national_caps = world.career.nationalCaps;
  const scoreP = { ST: 0.35, W: 0.25, AM: 0.22, CM: 0.1, DM: 0.05, FB: 0.04, CB: 0.05, GK: 0 }[u.pos];
  const g = rng.chance(scoreP) ? 1 : 0;
  world.career.nationalGoals += g;
  world.career.fame = clamp(world.career.fame + (first ? 5 : 1), 0, 100);
  const coach = userClub(world) ? world.people[userClub(world)!.managerId] : undefined;
  changeRelation(coach, u.id, 1);
  if (first) {
    pushHistory(world, 'national_debut', 'קיבלת זימון ראשון לנבחרת');
    addNews(world, { kind: 'career', headline: `${u.name} זומן לנבחרת לראשונה` });
  }
  return first ? `זימון ראשון לנבחרת!${g ? ' ואפילו כבשת.' : ''}` : `עוד הופעה בנבחרת${g ? ', עם שער' : ''}.`;
}
