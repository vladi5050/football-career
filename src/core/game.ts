// Core API: newGame, apply(world, cmd, content), buildView. Phase machine:
// plan -> (event) -> prematch -> match -> postmatch -> plan     (week with a fixture)
// plan -> (event) -> weekend -> plan                              (week without a fixture)
// last week -> offseason -> plan (new season) ; negotiation is a modal phase that returns where it started ; retired is final.
import type { Content } from './content';
import type {
  ClubView, Command, Footballer, GamePhase, LiveMatch, MomentResult, MomentSpec, PersonView, View, WeekPlan, WeekReport, World,
} from './types';
import { makeRng, type Rng } from './rng';
import {
  addNews, avg, changeRelation, clamp, firstName, fmtMoney, ovr, pushHistory, relationOf, userClub, userLeague, userPlayer,
} from './helpers';
import { generateWorld } from './worldGen';
import { applyResult, fixtureFor, fixturesInWeek, isWindowOpen, nextFixture, sortedTable, windowName } from './schedule';
import {
  advanceLive, applyMomentResult, finalizeLive, resolveMomentAuto as resolveAuto, simFixture, startLiveMatch,
} from './matchSim';
import {
  applyPlanImmediate, applyTraining, autoPlan, defaultPlan, rollUserInjury, weeklyRecovery,
} from './development';
import { autoOptionId, checkPromises, compileEvents, resolveEvent, rollWeekEvents, syncFlags } from './events';
import { acceptCurrent, clubViewRole, marketWage, negotiateRound, openNegotiation, userWalkAway } from './negotiation';
import { activeLeagues, expireOffers, npcTransfers, sackings, spawnOffer, weeklyOffers } from './transfers';
import { nearGoals, updateGoals } from './goals';
import { endSeason, nationalWindow, RETIRE_FORCED_AGE, startSeason } from './season';

export interface ApplyOut { world: World; toast?: string[] }

export function newGame(cmd: Extract<Command, { type: 'newCareer' }>, content: Content): World {
  compileEvents(content);
  const seed = cmd.seed ?? ((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0);
  const world = generateWorld(content, seed, { pos: cmd.pos, firstName: cmd.firstName, lastName: cmd.lastName, shirt: cmd.shirt, clubsOverride: cmd.clubsOverride });
  const rng = makeRng(world.rngState);
  startSeason(world, content, rng, 1, 2026);
  world.phase = 'plan';
  if (world.career.startStory) addNews(world, { kind: 'career', headline: world.career.startStory });
  return world;
}

/** Auto-resolve a key moment from abilities only (contract API). */
export function resolveMomentAuto(spec: MomentSpec, rng: Rng): MomentResult {
  return resolveAuto(spec, rng);
}

// ------------------------------------------------------------------ apply

export function apply(world: World, cmd: Command, content: Content): ApplyOut {
  if (cmd.type === 'newCareer') return { world: newGame(cmd, content) };
  const rng = makeRng(world.rngState);
  const toast: string[] = [];
  if (world.career.retired && cmd.type !== 'setAutoMoments') return { world, toast: ['הקריירה הסתיימה'] };
  switch (cmd.type) {
    case 'setPlan':
      if (world.phase !== 'plan') { toast.push('אפשר לתכנן רק בתחילת השבוע'); break; }
      doPlan(world, content, rng, cmd.plan, toast);
      break;
    case 'quickWeek': quickWeek(world, content, rng, toast); break;
    case 'resolveEvent': {
      const r = resolveEvent(world, content, cmd.uid, cmd.optionId, rng);
      toast.push(...r.notes);
      if (world.phase === 'event' && !world.inbox.length) enterMatchOrWeekend(world, content, rng);
      afterEffects(world, content, rng, toast);
      break;
    }
    case 'startMatch':
      if (world.phase !== 'prematch') { toast.push('אין משחק לפתוח עכשיו'); break; }
      startMatch(world, content, rng, toast);
      break;
    case 'momentResult': {
      const live = world.live;
      if (world.phase !== 'match' || !live) break;
      const m = live.moments[live.pendingMomentIndex];
      if (!m || m.id !== cmd.result.momentId) { toast.push('הרגע הזה כבר עבר'); break; }
      applyMomentResult(world, live, cmd.result, rng);
      advanceLive(world, live, rng);
      if (live.finished) finishMatch(world, content, rng, toast);
      break;
    }
    case 'simRestOfMatch': {
      if (world.phase !== 'match' || !world.live) break;
      simRest(world, rng);
      finishMatch(world, content, rng, toast);
      break;
    }
    case 'finishWeek':
      if (world.phase === 'postmatch' || world.phase === 'weekend') advanceWeek(world, content, rng, toast);
      else if (world.phase === 'offseason') beginNextSeason(world, content, rng, toast);
      else toast.push('השבוע עוד לא נגמר');
      break;
    case 'respondOffer': {
      const offer = world.career.offers.find((o) => o.id === cmd.offerId);
      if (!offer) { toast.push('ההצעה כבר לא בתוקף'); break; }
      if (!['plan', 'postmatch', 'weekend', 'offseason'].includes(world.phase)) { toast.push('אפשר לטפל בהצעות בין המשחקים'); break; }
      if (cmd.action === 'reject') {
        world.career.offers = world.career.offers.filter((o) => o.id !== offer.id);
        pushHistory(world, 'rejected_offer', `דחית את ${world.clubs[offer.fromClubId].name}`);
        const ag = world.people[world.career.agentId];
        if (ag?.archetype === 'shark') changeRelation(ag, userPlayer(world).id, -2);
        // loyalty noticed at home
        const coach = userClub(world) ? world.people[userClub(world)!.managerId] : undefined;
        changeRelation(coach, userPlayer(world).id, 2);
        toast.push('דחית את ההצעה');
      } else {
        const r = openNegotiation(world, content, rng, offer.fromClubId, offer, world.phase);
        if (typeof r === 'string') toast.push(r);
        else world.phase = 'negotiation';
      }
      break;
    }
    case 'requestRenewal': {
      const c = userClub(world);
      if (!c) break;
      if (!['plan', 'postmatch', 'weekend', 'offseason'].includes(world.phase)) { toast.push('אפשר לבקש חידוש בין המשחקים'); break; }
      const r = openNegotiation(world, content, rng, c.id, null, world.phase);
      if (typeof r === 'string') toast.push(r);
      else world.phase = 'negotiation';
      break;
    }
    case 'negotiate': {
      if (world.phase !== 'negotiation') break;
      toast.push(negotiateRound(world, content, rng, cmd.demand));
      closeNegotiationIfDone(world);
      break;
    }
    case 'acceptNegotiation':
      if (world.phase !== 'negotiation') break;
      toast.push(...acceptCurrent(world, content));
      closeNegotiationIfDone(world);
      break;
    case 'walkAway':
      if (world.phase !== 'negotiation') break;
      toast.push(userWalkAway(world));
      closeNegotiationIfDone(world);
      break;
    case 'retire': {
      const u = userPlayer(world);
      if (u.age < 30) { toast.push('מוקדם מדי לפרוש'); break; }
      if (world.phase === 'match' || world.phase === 'negotiation') { toast.push('לא באמצע זה'); break; }
      retireUser(world, 'בחרת לתלות את הנעליים');
      toast.push('תלית את הנעליים');
      break;
    }
    case 'setAutoMoments': world.settings.autoMoments = cmd.value; break;
  }
  return { world, toast: toast.length ? toast : undefined };
}

function closeNegotiationIfDone(world: World): void {
  const n = world.career.negotiation;
  if (n && n.status !== 'open') world.phase = (n.returnPhase ?? 'plan') as GamePhase;
}

function doPlan(world: World, content: Content, rng: Rng, plan: WeekPlan, toast: string[]): void {
  world.career.lastPlan = plan;
  toast.push(...applyPlanImmediate(world, plan, rng));
  rollWeekEvents(world, content, rng);
  if (world.inbox.length) world.phase = 'event';
  else enterMatchOrWeekend(world, content, rng);
}

function quickWeek(world: World, content: Content, rng: Rng, toast: string[]): void {
  if (world.phase === 'plan') {
    const u = userPlayer(world);
    const plan = world.career.lastPlan ?? defaultPlan(u);
    world.career.lastPlan = plan;
    toast.push(...applyPlanImmediate(world, autoPlan(u, plan), rng));
    rollWeekEvents(world, content, rng);
    world.phase = 'event';
  }
  if (world.phase === 'event') {
    while (world.inbox.length) {
      const ev = world.inbox[0];
      toast.push(...resolveEvent(world, content, ev.uid, autoOptionId(content, ev), rng).notes);
    }
    enterMatchOrWeekend(world, content, rng);
    afterEffects(world, content, rng, toast);
  }
}

/** Engine-meaningful flags set by event effects (captain, renewal request, army, farewell). */
function afterEffects(world: World, content: Content, rng: Rng, toast: string[]): void {
  const s = syncFlags(world);
  if (s.openRenewal && world.phase !== 'negotiation' && world.phase !== 'event') {
    const c = userClub(world);
    if (!c) return;
    const r = openNegotiation(world, content, rng, c.id, null, world.phase);
    if (typeof r === 'string') toast.push(r);
    else world.phase = 'negotiation';
  }
}

function enterMatchOrWeekend(world: World, content: Content, rng: Rng): void {
  const c = userClub(world);
  const f = c ? fixtureFor(world, c.id, world.season.week) : null;
  if (f && !f.played) { world.phase = 'prematch'; return; }
  completeWeek(world, content, rng, null);
  world.phase = 'weekend';
}

function startMatch(world: World, content: Content, rng: Rng, toast: string[]): void {
  const live = startLiveMatch(world, rng);
  if (!live) { completeWeek(world, content, rng, null); world.phase = 'weekend'; return; }
  world.live = live;
  world.phase = 'match';
  const u = userPlayer(world);
  if (!live.moments.length) {
    toast.push(u.injury ? 'אתה פצוע. צופה מהיציע.' : 'לא נכנסת לסגל המשחק הזה');
    simRest(world, rng);
    finishMatch(world, content, rng, toast);
    return;
  }
  if (world.settings.autoMoments) { simRest(world, rng); finishMatch(world, content, rng, toast); return; }
  advanceLive(world, live, rng);
  if (live.finished) finishMatch(world, content, rng, toast);
}

function simRest(world: World, rng: Rng): void {
  const live = world.live!;
  const u = userPlayer(world);
  let guard = 0;
  while (!live.finished && guard++ < 20) {
    const m = live.moments[live.pendingMomentIndex];
    if (m) {
      advanceLive(world, live, rng); // refresh context first
      const cur = live.moments[live.pendingMomentIndex];
      if (cur) applyMomentResult(world, live, resolveAuto(cur, rng, u.pos), rng);
    }
    advanceLive(world, live, rng);
  }
}

function finishMatch(world: World, content: Content, rng: Rng, toast: string[]): void {
  const live = world.live!;
  finalizeLive(world, live, rng);
  completeWeek(world, content, rng, live);
  world.phase = 'postmatch';
  void toast;
}

// ------------------------------------------------------------------ week completion

function completeWeek(world: World, content: Content, rng: Rng, live: LiveMatch | null): void {
  const u = userPlayer(world);
  const c = userClub(world);
  const week = world.season.week;
  const meanwhile: string[] = [];
  let headline: string | null = null;
  let notable = false;
  let minutes = 0;
  let rating: number | null = null;

  // ---- user's match aftermath
  if (live && live.youth) {
    const f = live.fixture;
    const us = live.isHome ? f.hg : f.ag, them = live.isHome ? f.ag : f.hg;
    const result = us > them ? 1 : us < them ? -1 : 0;
    rating = live.userRating;
    minutes = live.userMinutes;
    world.career.recentMinutes = [...(world.career.recentMinutes ?? []), Math.round(minutes * 0.7)].slice(-5);
    world.career.recentRatings = [...(world.career.recentRatings ?? []), rating].slice(-5);
    u.form = clamp(Math.round((u.form * 0.6 + (rating - 6.5) * 2) * 10) / 10, -10, 10);
    u.morale = clamp(u.morale + result * 2 - 1, 0, 100);
    world.career.lastMatch = { absWeek: world.absWeek, result, rating, started: false, minutes: 0 };
    const opp = world.clubs[live.oppClubId].name;
    headline = live.userGoals >= 2 ? `בנוער: צמד של ${firstName(u.name)} נגד ${opp}` : live.userGoals === 1 ? `בנוער: ${firstName(u.name)} כבש נגד ${opp}`
      : rating >= 7.8 ? `בנוער: משחק גדול של ${firstName(u.name)}` : `בנוער: ${us}-${them} נגד ${opp}`;
    if (rating >= 7.8) { const coach = c ? world.people[c.managerId] : undefined; changeRelation(coach, u.id, 1); }
  } else if (live) {
    const f = live.fixture;
    applyResult(world, live.leagueId, f);
    minutes = live.userMinutes;
    const played = live.started || live.subMinute != null;
    const us = live.isHome ? f.hg : f.ag, them = live.isHome ? f.ag : f.hg;
    const result = us > them ? 1 : us < them ? -1 : 0;
    world.career.recentMinutes = [...(world.career.recentMinutes ?? []), minutes].slice(-5);
    if (played) {
      rating = live.userRating;
      world.career.recentRatings = [...(world.career.recentRatings ?? []), rating].slice(-5);
      u.form = clamp(Math.round((u.form * 0.6 + (rating - 6.5) * 2.5) * 10) / 10, -10, 10);
      if (live.started) world.history.flags.starts_total = (world.history.flags.starts_total ?? 0) + 1;
      const coach = c ? world.people[c.managerId] : undefined;
      if (rating >= 8) changeRelation(coach, u.id, 1);
      else if (rating <= 5.2) changeRelation(coach, u.id, -2);
      const bonus = u.contract?.bonuses.find((b) => b.kind === 'goal');
      if (bonus && live.userGoals) world.career.money += bonus.amount * live.userGoals;
      const app = u.contract?.bonuses.find((b) => b.kind === 'appearance');
      if (app) world.career.money += app.amount;
      if (live.userGoals && u.careerStats.goals === live.userGoals) {
        pushHistory(world, 'first_goal', `כבשת את השער הראשון שלך נגד ${world.clubs[live.oppClubId].name}`);
        notable = true;
        headline = `השער הראשון של ${firstName(u.name)}!`;
      }
      const lgStr = world.leagues[live.leagueId].strength;
      world.career.fame = clamp(world.career.fame + ((rating >= 8 ? 1 : rating >= 7.3 ? 0.3 : 0) + live.userGoals * (live.derby ? 1 : 0.3)) * (lgStr / 60), 0, 100);
    } else {
      u.morale = clamp(u.morale - (u.injury ? 1 : 3), 0, 100);
    }
    u.morale = clamp(u.morale + result * 3, 0, 100);
    world.career.lastMatch = { absWeek: world.absWeek, result, rating: rating ?? 0, started: live.started, minutes };
    if (!headline) headline = matchHeadline(world, live, result, rating);
    if (live.derby && result === 1 && played) { notable = true; pushHistory(world, 'derby_win', `ניצחתם בדרבי נגד ${world.clubs[live.oppClubId].name}`); }
    if ((rating ?? 0) >= 8.3 || live.userGoals >= 2 || (live.derby && live.userGoals > 0)) notable = true;
    if (live.highlights.some((h) => h.kind === 'goal' && h.minute >= 85) && played && result >= 0 && live.userGoals) notable = true;
  }

  // ---- other fixtures, every league
  const rival = world.people[world.career.rivalId] as Footballer | undefined;
  const statsLeagues = new Set<number>();
  if (c) statsLeagues.add(c.leagueId);
  if (rival?.clubId != null) statsLeagues.add(world.clubs[rival.clubId].leagueId);
  for (const l of activeLeagues(world)) if (l.simLevel !== 'result') statsLeagues.add(l.id);
  let upset: string | null = null;
  let upsetMargin = 0;
  for (const lg of world.leagues) {
    for (const f of fixturesInWeek(world, lg.id, week)) {
      if (f.played) continue;
      simFixture(world, f, rng, statsLeagues.has(lg.id));
      applyResult(world, lg.id, f);
      if (c && lg.id === c.leagueId) {
        const m = Math.abs(f.hg - f.ag);
        if (m > upsetMargin) { upsetMargin = m; upset = `${world.clubs[f.home].name} ${f.hg}-${f.ag} ${world.clubs[f.away].name}`; }
      }
    }
  }
  if (upset && upsetMargin >= 3) meanwhile.push(upset);
  if (rival && rival.clubId != null) {
    const rf = fixtureFor(world, rival.clubId, week);
    const rg = rf?.scorers?.filter((s) => s.playerId === rival.id).length ?? 0;
    if (rg > 0) meanwhile.push(`${rival.name} ${rg > 1 ? `כבש ${rg}` : 'כבש'} ל${world.clubs[rival.clubId].name}`);
  }

  // ---- training, injuries, money
  const gains = applyTraining(world, world.career.lastPlan ?? defaultPlan(u), rng);
  const inj = rollUserInjury(world, rng, world.career.lastPlan ?? defaultPlan(u), minutes);
  if (inj) notable = true;
  if (u.contract) world.career.money += Math.round((u.contract.monthlyWage * 12) / 52);
  world.career.money = Math.round(world.career.money - (world.career.life.home === 'rented' ? 900 : 0));

  // ---- the world moves
  meanwhile.push(...sackings(world, content, rng));
  meanwhile.push(...npcTransfers(world, content, rng));
  const offer = weeklyOffers(world, content, rng);
  if (offer) { notable = true; addNews(world, { kind: 'transfer', headline: `${world.clubs[offer.fromClubId].name} מתעניינים ב${u.name}` }); }
  if ((week + 1) % 9 === 0) {
    const n = nationalWindow(world, rng);
    if (n) { meanwhile.unshift(n); if (n.startsWith('זימון ראשון')) notable = true; }
  }
  meanwhile.push(...checkPromises(world));
  const goalLines = updateGoals(world);
  if (goalLines.length) notable = true;
  meanwhile.push(...goalLines);

  const report: WeekReport = {
    absWeek: world.absWeek, seasonWeek: week,
    result: live && !live.youth ? { home: live.fixture.home, away: live.fixture.away, hg: live.fixture.hg, ag: live.fixture.ag } : null,
    userRating: rating, userGoals: live?.userGoals ?? 0, userAssists: live?.userAssists ?? 0, gains,
    headline: headline ?? (inj ? `${firstName(u.name)} נפצע` : null), meanwhile: meanwhile.slice(0, 5), openLoops: openLoops(world),
    nearGoals: nearGoals(world), notable,
  };
  world.lastWeekReport = report;
}

function matchHeadline(world: World, live: LiveMatch, result: number, rating: number | null): string {
  const u = userPlayer(world);
  const fn = firstName(u.name);
  const opp = world.clubs[live.oppClubId].name;
  if (rating == null) return u.injury ? `${fn} צפה מהיציע` : `${fn} לא שותף נגד ${opp}`;
  if (live.userGoals >= 3) return `שלושער של ${fn}!`;
  if (live.userGoals === 2) return `צמד של ${fn} נגד ${opp}`;
  if (live.derby && result === 1) return `הדרבי צבוע בצבעים שלכם`;
  if (live.userGoals === 1 && result === 1) return `${fn} מכריע נגד ${opp}`;
  if (rating >= 8) return `הצגה של ${fn}`;
  if (rating <= 5.2) return `ערב קשה ל${fn}`;
  if (result === -1) return `הפסד ל${opp}`;
  if (result === 0) return `תיקו מול ${opp}`;
  return `ניצחון על ${opp}`;
}

function openLoops(world: World): string[] {
  const out: string[] = [];
  const u = userPlayer(world);
  const c = userClub(world);
  const due = world.pending.filter((p) => p.atWeek - world.absWeek <= 4).sort((a, b) => a.atWeek - b.atWeek)[0];
  if (due) {
    const who = Object.values(due.cast).map((id) => world.people[id]?.name).find(Boolean);
    out.push(who ? `${who} עוד יחזור לעניין` : 'משהו מתבשל מאחורי הקלעים');
  }
  if (u.injury) out.push(`עוד ${u.injury.weeksLeft} שבועות לחזרה מ${u.injury.kind}`);
  if (world.career.offers.length) out.push(`יש הצעה מ${world.clubs[world.career.offers[0].fromClubId].name} על השולחן`);
  if (c) {
    const f = nextFixture(world, c.id, world.season.week + 1);
    if (f && (f.home === c.rivalClubId || f.away === c.rivalClubId)) out.push(`דרבי בשבוע הבא נגד ${world.clubs[c.rivalClubId!].name}`);
  }
  const pr = world.career.promises.find((p) => p.kept === null);
  if (pr) out.push(`${pr.text}. עוד ${Math.max(0, pr.dueWeek - world.absWeek)} שבועות נראה`);
  if (u.contract && u.contract.endSeason <= world.season.number) out.push('החוזה שלך נגמר בסוף העונה');
  const rival = world.people[world.career.rivalId] as Footballer | undefined;
  if (rival && !rival.retired && u.pos !== 'GK') out.push(`${firstName(rival.name)} עם ${rival.stats.goals} שערים, אתה עם ${u.stats.goals}`);
  if (!isWindowOpen(world)) {
    const mid = Math.floor(world.season.totalWeeks / 2) - 1;
    if (world.season.week < mid && mid - world.season.week <= 3) out.push('חלון ההעברות של ינואר נפתח בקרוב');
  }
  if (u.age >= 33) out.push('הגוף מאט. אולי זו העונה האחרונה');
  return out.slice(0, 3);
}

// ------------------------------------------------------------------ week / season transitions

function advanceWeek(world: World, content: Content, rng: Rng, toast: string[]): void {
  world.live = null;
  world.inbox = [];
  world.season.week++;
  world.absWeek++;
  expireOffers(world);
  weeklyRecovery(world);
  if (world.season.week >= world.season.totalWeeks) {
    const rep = endSeason(world, content, rng);
    toast.push(...rep.lines.slice(0, 3));
    world.lastWeekReport = {
      absWeek: world.absWeek, seasonWeek: world.season.week, result: null, userRating: null, userGoals: 0, userAssists: 0, gains: [],
      headline: rep.champion ? 'אלופים!' : rep.promoted ? 'עולים ליגה!' : rep.relegated ? 'ירידה כואבת' : 'העונה הסתיימה',
      meanwhile: rep.lines.slice(0, 5), openLoops: openLoops(world), nearGoals: nearGoals(world), notable: true,
    };
    if (rep.forcedRetire) { retireUser(world, `בגיל ${RETIRE_FORCED_AGE} הגוף אמר את המילה האחרונה`); return; }
    if ((world.history.flags.farewell ?? 0) >= 1) { retireUser(world, 'משחק פרידה, והנעליים נתלו'); return; }
    world.phase = 'offseason';
    // summer window: a few offers
    const n = (rng.chance(0.3 + world.career.fame / 200) ? 1 : 0) + (world.career.fame > 60 && rng.chance(0.5) ? 1 : 0);
    for (let i = 0; i < n; i++) spawnOffer(world, content, rng, rng.chance(0.3) ? 'bigger' : rng.chance(0.2) ? 'abroad' : 'any');
    const u = userPlayer(world);
    if (u.contract && u.contract.endSeason <= world.season.number) {
      toast.push('החוזה שלך נגמר. אפשר לבקש חידוש או לבחור הצעה');
      if (!world.career.offers.length) spawnOffer(world, content, rng, 'any');
    }
    return;
  }
  world.phase = 'plan';
  const w = windowName(world);
  if (w === 'january' && world.season.week === Math.floor(world.season.totalWeeks / 2) - 1) toast.push('חלון ההעברות של ינואר נפתח');
}

function beginNextSeason(world: World, content: Content, rng: Rng, toast: string[]): void {
  const u = userPlayer(world);
  // expired contract: auto-resolve so the player always has a club
  if (u.contract && u.contract.endSeason <= world.season.number) {
    const c = userClub(world)!;
    const role = clubViewRole(world, c.id, u);
    if (role !== 'backup' || u.age < 21) {
      const wage = Math.round((marketWage(world, content, c.id, u) * 0.9) / 100) * 100;
      u.contract = { ...u.contract, monthlyWage: wage, endSeason: world.season.number + 2, role };
      toast.push(`חידשת ב${c.name} לשנתיים, ${fmtMoney(wage)} לחודש`);
      pushHistory(world, 'renewed', `חידשת חוזה ב${c.name}`);
    } else {
      const best = world.career.offers[0] ?? spawnOffer(world, content, rng, 'lower') ?? spawnOffer(world, content, rng, 'any');
      if (best) {
        const neg = openNegotiation(world, content, rng, best.fromClubId, best, 'offseason');
        if (typeof neg !== 'string') { toast.push(...acceptCurrent(world, content)); }
      }
      if (u.contract.endSeason <= world.season.number) {
        u.contract = { ...u.contract, endSeason: world.season.number + 1, role: 'backup', monthlyWage: Math.round(u.contract.monthlyWage * 0.8) };
        toast.push('אף אחד לא הציע. נשארת בחוזה קצר ומקוצץ');
      }
    }
  }
  world.absWeek++;
  startSeason(world, content, rng, world.season.number + 1, world.season.year + 1);
  world.career.negotiation = null;
  world.phase = 'plan';
  toast.push(`עונה ${world.season.number} מתחילה`);
}

function retireUser(world: World, reason: string): void {
  const u = userPlayer(world);
  world.career.retired = true;
  world.career.retirementReason = reason;
  world.career.life.stage = 'retired';
  u.retired = true;
  world.phase = 'retired';
  world.live = null;
  world.inbox = [];
  pushHistory(world, 'retired', reason);
  addNews(world, { kind: 'career', headline: `${u.name} פורש: ${u.careerStats.goals} שערים ב${u.careerStats.apps} הופעות` });
}

// ------------------------------------------------------------------ view

function clubView(world: World, id: number): ClubView {
  const c = world.clubs[id];
  const lg = world.leagues[c.leagueId];
  return { id: c.id, name: c.name, short: c.short, city: c.city, colors: c.colors, crest: c.crest, reputation: c.reputation, leagueName: lg.name, country: lg.country, stadium: c.stadium };
}

function personView(world: World, id: number | null | undefined): PersonView | null {
  if (id == null) return null;
  const p = world.people[id];
  if (!p) return null;
  const v: PersonView = { id: p.id, name: p.name, role: p.role, traits: p.traits, relation: Math.round(relationOf(p, world.career.playerId)), age: p.age, clubId: p.clubId };
  if (p.archetype) v.archetype = p.archetype;
  return v;
}

export function potentialRange(world: World, p: Footballer): [number, number] {
  const hw = clamp(Math.round(10 - (p.age - 16) * 0.9), 2, 10);
  const off = Math.round((((world.seed >>> 3) % 7) - 3) * hw / 4);
  const lo = clamp(Math.round(p.potential - hw + off), 1, 99);
  return [lo, clamp(lo + hw * 2, lo, 99)];
}

export function buildView(world: World): View {
  const u = userPlayer(world);
  const c = userClub(world);
  const lg = userLeague(world);
  const table = lg ? sortedTable(world.season.tables[lg.id] ?? []).map((r) => {
    const cl = world.clubs[r.clubId];
    return { ...r, form: r.form.slice(), name: cl.name, short: cl.short, colors: cl.colors, crest: cl.crest };
  }) : [];
  let nf: View['nextFixture'] = null;
  if (c && world.phase !== 'offseason' && world.phase !== 'retired') {
    const f = nextFixture(world, c.id, world.season.week);
    if (f) {
      const oppId = f.home === c.id ? f.away : f.home;
      nf = { opp: clubView(world, oppId), home: f.home === c.id, week: f.week, derby: c.rivalClubId === oppId || world.clubs[oppId].rivalClubId === c.id };
    }
  }
  const rival = world.people[world.career.rivalId] as Footballer | undefined;
  const rv = rival ? personView(world, rival.id) : null;
  const offerClubs: Record<number, ClubView> = {};
  for (const o of world.career.offers) offerClubs[o.fromClubId] = clubView(world, o.fromClubId);
  if (world.career.negotiation) offerClubs[world.career.negotiation.clubId] = clubView(world, world.career.negotiation.clubId);
  const k = world.career;
  return {
    phase: world.phase, seed: world.seed, absWeek: world.absWeek,
    season: { number: world.season.number, year: world.season.year, week: world.season.week, totalWeeks: world.season.totalWeeks, themes: world.season.themes.slice() },
    player: {
      id: u.id, name: u.name, age: u.age, pos: u.pos, attr: { ...u.attr }, overall: Math.floor(ovr(u)), potentialRange: potentialRange(world, u),
      form: u.form, fitness: Math.round(u.fitness), morale: Math.round(u.morale), injury: u.injury ? { ...u.injury } : null,
      contract: u.contract ? { ...u.contract, bonuses: u.contract.bonuses.slice() } : null, stats: { ...u.stats }, careerStats: { ...u.careerStats }, shirt: u.shirt ?? 0,
    },
    club: c ? clubView(world, c.id) : null,
    league: lg ? { id: lg.id, name: lg.name, country: lg.country } : null,
    table, nextFixture: nf,
    agent: personView(world, k.agentId)!,
    coach: c ? personView(world, c.managerId) : null,
    rival: rv && rival ? { ...rv, clubName: rival.clubId != null ? world.clubs[rival.clubId].name : '', goals: rival.stats.goals, overall: Math.floor(ovr(rival)) } : null,
    career: JSON.parse(JSON.stringify({
      money: k.money, fame: k.fame, goals: k.goals, specialties: k.specialties, life: k.life, lastPlan: k.lastPlan, startKind: k.startKind,
      trophies: k.trophies, history: k.history, nationalCaps: k.nationalCaps, nationalGoals: k.nationalGoals, captain: k.captain, offers: k.offers,
      negotiation: k.negotiation ? { ...k.negotiation, hiddenCeiling: 0 } : null, retired: k.retired, retirementReason: k.retirementReason, seasonsPlayed: k.seasonsPlayed,
    })),
    inbox: world.inbox.map((e) => ({ ...e })),
    news: world.news.slice(0, 20),
    live: world.live ? JSON.parse(JSON.stringify(world.live)) : null,
    lastWeekReport: world.lastWeekReport,
    offerClubs,
  };
}

/** Average helper exported for tools. */
export const _avg = avg;
