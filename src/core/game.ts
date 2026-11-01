// Core API: newGame, apply(world, cmd, content), buildView. Phase machine:
// plan -> (event) -> prematch -> match -> postmatch -> plan     (week with a fixture)
// plan -> (event) -> weekend -> plan                              (week without a fixture)
// last week -> offseason -> plan (new season) ; negotiation is a modal phase that returns where it started ; retired is final.
import type { Content } from './content';
import type {
  AttrKey, ClubView, Command, Footballer, GamePhase, LiveMatch, MomentResult, MomentSpec, PersonView, SkipMatch, SkipSummary, View, WeekPlan, WeekReport, World,
} from './types';
import { makeRng, type Rng } from './rng';
import {
  ATTR_KEYS, addNews, avg, changeRelation, clamp, count, firstName, fmtMoney, ovr, pre, pushHistory, relationOf, userClub, userLeague, userPlayer,
} from './helpers';
import { generateWorld } from './worldGen';
import { applyResult, fixtureFor, fixturesInWeek, isWindowOpen, matchWeeks, SEASON_EXTRA_WEEKS, nextFixture, sortedTable, tablePosition, windowName } from './schedule';
import { lifeSeasonStep, weeklyLivingCost } from './life';
import {
  advanceLive, applyMomentResult, decideLineup, finalizeLive, resolveMomentAuto as resolveAuto, simFixture, startLiveMatch,
} from './matchSim';
import {
  applyPlanImmediate, applyTraining, autoPlan, clubFacilities, defaultPlan, persistenceOf, rollPersistence, rollUserInjury, trackAttrProgress,
  trainingWhy, weeklyPersistence, weeklyRecovery,
} from './development';
import { importantMatch, isStopEvent, seasonSpeed } from './seasonSpeed';
import { autoOptionId, checkPromises, compileEvents, resolveEvent, rollWeekEvents, syncFlags } from './events';
import { acceptCurrent, negotiateRound, openNegotiation, ROLE_HE as SQUAD_ROLE_HE, userWalkAway } from './negotiation';
import { activeLeagues, atReserve, expireOffers, npcTransfers, RESERVE_TUNING, reserveCallUp, reserveRelease, sackings, spawnOffer, weeklyOffers } from './transfers';
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
  userPlayer(world).persistence = rollPersistence(seed);
  if (cmd.seasonSpeed && cmd.seasonSpeed !== 'full') world.settings.seasonSpeed = cmd.seasonSpeed;
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
  if (world.career.retired && cmd.type !== 'setAutoMoments' && cmd.type !== 'setSeasonSpeed') return { world, toast: ['הקריירה הסתיימה'] };
  world.career.eventOutcome = null;
  switch (cmd.type) {
    case 'setPlan':
      if (world.phase !== 'plan') { toast.push('אפשר לתכנן רק בתחילת השבוע'); break; }
      doPlan(world, content, rng, cmd.plan, toast);
      break;
    case 'quickWeek':
      if (cmd.untilNext && world.phase === 'plan') fastForward(world, content, rng, toast, true);
      else quickWeek(world, content, rng, toast);
      break;
    case 'resolveEvent': {
      const r = resolveEvent(world, content, cmd.uid, cmd.optionId, rng);
      world.career.eventOutcome = r.outcome ?? null; // the outcome sheet shows the notes
      if (!r.outcome) toast.push(...r.notes);
      if (world.phase === 'event' && !world.inbox.length) enterMatchOrWeekend(world, content, rng, toast);
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
      else { toast.push('השבוע עוד לא נגמר'); break; }
      // faster season speeds: the weeks that don't need the player run by themselves, up to the next stop
      if (seasonSpeed(world) !== 'full' && phaseOf(world) === 'plan') fastForward(world, content, rng, toast, false);
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
    case 'setSeasonSpeed':
      if (cmd.value === 'full') delete world.settings.seasonSpeed;
      else world.settings.seasonSpeed = cmd.value;
      break;
  }
  return { world, toast: toast.length ? toast : undefined };
}

function closeNegotiationIfDone(world: World): void {
  const n = world.career.negotiation;
  if (n && n.status !== 'open') world.phase = (n.returnPhase ?? 'plan') as GamePhase;
}

function doPlan(world: World, content: Content, rng: Rng, plan: WeekPlan, toast: string[]): void {
  world.career.lastPlan = plan;
  world.career.quickFlow = false;
  toast.push(...applyPlanImmediate(world, plan, rng));
  rollWeekEvents(world, content, rng);
  if (world.inbox.length) world.phase = 'event';
  else enterMatchOrWeekend(world, content, rng, toast);
}

const MAJOR_CATEGORIES = new Set(['transfer', 'army', 'national']);
const MAJOR_EFFECT = /^\s*(offer\(|squadRole\(|flag\(\s*(captain|farewell|want_renewal|army_serving|outstanding_athlete|nation_undecided)\s*\))/;

/** Major decisions (transfer, contract, army, national team, captaincy, retirement) are never auto-resolved. */
export function isMajorEvent(content: Content, ev: { templateId: string; category: string }): boolean {
  if (MAJOR_CATEGORIES.has(ev.category)) return true;
  const t = content.events.find((x) => x.id === ev.templateId);
  return !!t && t.options.some((o) => o.effects.some((e) => MAJOR_EFFECT.test(e)));
}

/** Quick week: repeat the last plan, auto-answer minor events, skip pre-match and go straight into the match. Stops on a major decision. */
function quickWeek(world: World, content: Content, rng: Rng, toast: string[], keep: (c: Content, ev: { templateId: string; category: string }) => boolean = isMajorEvent): void {
  if (world.phase === 'plan') {
    const u = userPlayer(world);
    const plan = world.career.lastPlan ?? defaultPlan(u);
    world.career.lastPlan = plan;
    toast.push(...applyPlanImmediate(world, autoPlan(u, plan), rng));
    rollWeekEvents(world, content, rng);
    world.phase = 'event';
  }
  world.career.quickFlow = true;
  if (world.phase === 'event') {
    for (const ev of world.inbox.slice()) {
      if (keep(content, ev)) continue;
      const opt = autoOptionId(content, ev);
      const text = ev.options.find((o) => o.id === opt)?.text;
      world.career.autoAnswered = [...(world.career.autoAnswered ?? []), text ? `${ev.title}: ${text}` : ev.title].slice(-3);
      toast.push(...resolveEvent(world, content, ev.uid, opt, rng).notes);
    }
    if (world.inbox.length) {
      if (world.history.flags.major_toast_week !== world.absWeek) toast.push('יש החלטה גדולה שמחכה לך');
      world.history.flags.major_toast_week = world.absWeek;
      return;
    }
    enterMatchOrWeekend(world, content, rng, toast);
    afterEffects(world, content, rng, toast);
  } else if (world.phase === 'prematch') {
    startMatch(world, content, rng, toast);
  }
}

export const FF_MAX_WEEKS = 60;

/**
 * Fast-forward: run quick weeks one after another until the next stop. A stop is an important match for the season speed
 * ('full' uses the 'balanced' rules here, so the button still means something), a decision the player must make
 * (transfer, contract, injury, captaincy, national team), a new offer, a new injury, a first national call-up,
 * a negotiation, the offseason or retirement. `force`: the current week runs even if it is important (the player asked).
 * Moments are auto-resolved in the auto weeks; the summary goes to career.lastSkip.
 */
function fastForward(world: World, content: Content, rng: Rng, toast: string[], force: boolean): void {
  if (world.phase !== 'plan') return;
  const speed = seasonSpeed(world) === 'full' ? 'balanced' : seasonSpeed(world);
  const u = userPlayer(world);
  const c0 = userClub(world);
  const posBefore = c0 ? tablePosition(world, c0.id) : 0;
  const attrBefore = { ...u.attr };
  const matches: SkipMatch[] = [];
  const autoEvents: string[] = [];
  const keep = (ct: Content, ev: { templateId: string; category: string }): boolean => isStopEvent(ct, ev, isMajorEvent);
  const prevAuto = world.settings.autoMoments;
  let weeks = 0;
  let reason = '';
  let at: SkipSummary['at'] = 'plan';
  world.settings.autoMoments = true;
  try {
    for (let guard = 0; guard < FF_MAX_WEEKS; guard++) {
      if (world.phase !== 'plan') { reason = phaseStop(world); at = 'weekend'; break; }
      if (!(force && weeks === 0)) {
        const imp = importantMatch(world, speed);
        if (imp) { reason = imp; at = 'plan'; world.career.ffAutoMatches = 0; break; }
      }
      const offersBefore = new Set(world.career.offers.map((o) => o.id));
      const injuredBefore = !!u.injury;
      const capsBefore = world.career.nationalCaps;
      const club = userClub(world);
      const hadFixture = !!(club && fixtureFor(world, club.id, world.season.week));
      quickWeek(world, content, rng, [], keep);
      const ph = phaseOf(world);
      if (ph !== 'postmatch' && ph !== 'weekend') {
        // a decision is waiting (event), or a negotiation opened mid-week
        reason = ph === 'event' ? 'יש החלטה שמחכה לך' : phaseStop(world);
        at = 'event';
        world.career.ffWeek = world.absWeek; // after the decision, this week's match still runs by itself
        if (hadFixture) world.career.ffAutoMatches = (world.career.ffAutoMatches ?? 0) + 1;
        break;
      }
      weeks++;
      const rep = world.lastWeekReport;
      if (rep?.autoEvents) autoEvents.push(...rep.autoEvents);
      const live = world.live;
      if (live && club) {
        const f = live.fixture;
        const us = live.isHome ? f.hg : f.ag, them = live.isHome ? f.ag : f.hg;
        const played = live.started || live.subMinute != null;
        matches.push({
          seasonWeek: world.season.week, oppId: live.oppClubId, oppName: world.clubs[live.oppClubId].name, home: live.isHome, us, them,
          rating: played ? Math.round(live.userRating * 10) / 10 : null, goals: live.userGoals, assists: live.userAssists, ...(live.youth ? { youth: true } : {}),
        });
      }
      if (hadFixture) world.career.ffAutoMatches = (world.career.ffAutoMatches ?? 0) + 1;
      const newOffer = world.career.offers.find((o) => !offersBefore.has(o.id));
      if (newOffer) { reason = `הצעה חדשה ${pre('מ', world.clubs[newOffer.fromClubId].name)}`; at = 'weekend'; break; }
      if (u.injury && !injuredBefore) { reason = `נפצעת: ${u.injury.kind}`; at = 'weekend'; break; }
      if (capsBefore === 0 && world.career.nationalCaps > 0) { reason = 'זימון ראשון לנבחרת'; at = 'weekend'; break; }
      advanceWeek(world, content, rng, []);
    }
  } finally {
    world.settings.autoMoments = prevAuto;
  }
  if (!weeks) return; // nothing ran
  const gains = ATTR_KEYS.filter((k: AttrKey) => Math.round(u.attr[k] * 10) - Math.round(attrBefore[k] * 10) >= 1)
    .map((k) => ({ key: k, before: attrBefore[k], after: u.attr[k] }));
  const c1 = userClub(world);
  const posAfter = c1 && phaseOf(world) !== 'offseason' && phaseOf(world) !== 'retired' ? tablePosition(world, c1.id) : (world.career.history[world.career.history.length - 1]?.position ?? 0);
  world.career.lastSkip = {
    absWeek: world.absWeek, weeks, matches, posBefore, posAfter: c1?.id === c0?.id ? posAfter : 0, gains, autoEvents: autoEvents.slice(-8),
    stopReason: reason || 'עצרנו כאן', at,
  };
  if (weeks) toast.push(weeks === 1 ? `שבוע אחד רץ אוטומטית. ${reason}` : `${weeks} שבועות רצו אוטומטית. ${reason}`);
}

/** The phase, read fresh (TypeScript would keep a narrowed value across the calls that change it). */
const phaseOf = (world: World): GamePhase => world.phase;

function phaseStop(world: World): string {
  if (world.phase === 'offseason') return 'העונה הסתיימה';
  if (world.phase === 'retired') return 'הקריירה הסתיימה';
  if (world.phase === 'negotiation') return 'משא ומתן על חוזה';
  if (world.phase === 'event') return 'יש החלטה שמחכה לך';
  return 'עצרנו כאן';
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

function enterMatchOrWeekend(world: World, content: Content, rng: Rng, toast: string[] = []): void {
  const c = userClub(world);
  const f = c ? fixtureFor(world, c.id, world.season.week) : null;
  if (f && !f.played) {
    // the matchday decision is made now, so pre-match tells the truth
    world.career.prematch = decideLineup(world, rng);
    world.phase = 'prematch';
    if (world.career.quickFlow) startMatch(world, content, rng, toast);
    return;
  }
  world.career.prematch = null;
  completeWeek(world, content, rng, null);
  world.phase = 'weekend';
}

function startMatch(world: World, content: Content, rng: Rng, toast: string[]): void {
  const live = startLiveMatch(world, rng, world.career.prematch);
  world.career.prematch = null;
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
  if (world.settings.autoMoments || world.career.ffWeek === world.absWeek) { simRest(world, rng); finishMatch(world, content, rng, toast); return; }
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
  if (live) world.history.flags.first_match_done = 1;
  if (live && !live.youth) world.career.matchClubId = live.userClubId;
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
    const res = result > 0 ? `ניצחון ${Math.max(us, them)}-${Math.min(us, them)}` : result < 0 ? `הפסד ${Math.max(us, them)}-${Math.min(us, them)}` : `תיקו ${us}-${them}`;
    headline = live.userGoals >= 2 ? `בנוער: צמד של ${firstName(u.name)} נגד ${opp}` : live.userGoals === 1 ? `בנוער: ${firstName(u.name)} כבש נגד ${opp}`
      : rating >= 7.6 ? `בנוער: משחק גדול של ${firstName(u.name)}` : `${res} בנוער מול ${opp}`;
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
      if (u.careerStats.apps === 1) {
        // senior debut: rare at 15-17, always celebrated
        const how = live.started ? 'בהרכב' : `מהספסל בדקה ${live.subMinute}`;
        pushHistory(world, 'senior_debut', `ערכת בכורה בבוגרים נגד ${world.clubs[live.oppClubId].name}, ${how}`);
        addNews(world, { kind: 'career', headline: `הבכורה של ${u.name} בבוגרים`, body: `בגיל ${u.age}, נגד ${world.clubs[live.oppClubId].name}` });
        world.career.fame = clamp(world.career.fame + (u.age <= 17 ? 3 : 1), 0, 100);
        u.morale = clamp(u.morale + 6, 0, 100);
        notable = true;
        headline = u.age <= 17 ? `בגיל ${u.age}: הבכורה של ${firstName(u.name)} בבוגרים!` : `הבכורה של ${firstName(u.name)} בבוגרים`;
      }
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
    // the rival footballer in this match: remembered for event conditions (rivalScoredLast)
    const rv = world.people[world.career.rivalId] as Footballer | undefined;
    if (rv && rv.clubId === live.oppClubId) world.history.flags.rival_scored_last = (f.scorers ?? []).some((x) => x.playerId === rv.id) ? 1 : 0;
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
    if (rg > 0) meanwhile.push(`${rival.name} ${rg === 2 ? 'כבש צמד' : rg > 2 ? `כבש ${rg} שערים` : 'כבש'} ${pre('ל', world.clubs[rival.clubId].name)}`);
  }

  // ---- training, injuries, money
  const gains = applyTraining(world, world.career.lastPlan ?? defaultPlan(u), rng);
  const why = u.injury ? undefined : trainingWhy(world); // before the weekly drift: the week's own conditions
  weeklyPersistence(world, world.career.lastPlan ?? defaultPlan(u));
  trackAttrProgress(world);
  const inj = rollUserInjury(world, rng, world.career.lastPlan ?? defaultPlan(u), minutes);
  if (inj) notable = true;
  // a year of wages is paid over the season's weeks; living costs follow life choices
  if (u.contract) world.career.money += Math.round((u.contract.monthlyWage * 12) / Math.max(20, world.season.totalWeeks));
  world.career.money = Math.round(world.career.money - weeklyLivingCost(world));

  // ---- the world moves
  meanwhile.push(...sackings(world, content, rng));
  meanwhile.push(...npcTransfers(world, content, rng));
  const offer = weeklyOffers(world, content, rng);
  if (offer) { notable = true; addNews(world, { kind: 'transfer', headline: `${world.clubs[offer.fromClubId].name} מתעניינים ${pre('ב', u.name)}` }); }
  if (!matchWeeks(world.season.totalWeeks, SEASON_EXTRA_WEEKS).includes(week)) {
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
  if (world.career.autoAnswered?.length) { report.autoEvents = world.career.autoAnswered; world.career.autoAnswered = []; }
  if (why) report.trainingWhy = why;
  if (!gains.length) report.gainsNote = u.injury ? 'פצוע. השבוע בלי אימונים.' : u.age >= 30 ? 'השבוע בלי שינוי במספרים. שומרים על מה שיש.' : 'השבוע בלי שינוי שרואים במספרים. העבודה מצטברת.';
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
  if (rating <= 5.2) return `ערב קשה ${pre('ל', fn)}`;
  if (result === -1) return `הפסד ${pre('ל', opp)}`;
  if (result === 0) return `תיקו מול ${opp}`;
  return `ניצחון על ${opp}`;
}

/** Up to 3 "what's next" lines. Urgent ones first, the rest rotate week to week so the list stays fresh. */
function openLoops(world: World): string[] {
  const urgent: string[] = [];
  const pool: string[] = [];
  const u = userPlayer(world);
  const c = userClub(world);
  const k = world.career;
  const due = world.pending.filter((p) => p.atWeek - world.absWeek <= 4).sort((a, b) => a.atWeek - b.atWeek)[0];
  if (due) {
    const who = Object.values(due.cast).map((id) => world.people[id]?.name).find(Boolean);
    const soon = due.atWeek - world.absWeek <= 1;
    (soon ? urgent : pool).push(who ? (soon ? `${who} עוד יחזור לעניין, אולי כבר השבוע` : `${who} עוד יחזור לעניין`) : 'משהו מתבשל מאחורי הקלעים');
  }
  if (u.injury) urgent.push(u.injury.weeksLeft === 1 ? `עוד שבוע אחד לחזרה ${pre('מ', u.injury.kind)}` : `עוד ${u.injury.weeksLeft} שבועות לחזרה ${pre('מ', u.injury.kind)}`);
  if (k.offers.length) {
    const o = k.offers[world.absWeek % k.offers.length];
    const left = o.expiresWeek - world.absWeek;
    const club = world.clubs[o.fromClubId].name;
    urgent.push(left <= 1 ? `ההצעה ${pre('מ', club)} פגה השבוע` : `יש הצעה ${pre('מ', club)} על השולחן, עוד ${left} שבועות`);
  }
  const pr = k.promises.find((p) => p.kept === null);
  if (pr) {
    const left = Math.max(0, pr.dueWeek - world.absWeek);
    pool.push(left <= 1 ? `${pr.text}. השבוע נראה` : `${pr.text}. עוד ${left} שבועות נראה`);
  }
  if (c) {
    const f = nextFixture(world, c.id, world.season.week + 1);
    if (f) {
      const oppId = f.home === c.id ? f.away : f.home;
      const opp = world.clubs[oppId];
      const inWeeks = f.week - world.season.week;
      const when = inWeeks <= 1 ? 'בשבוע הבא' : `בעוד ${inWeeks} שבועות`;
      if (oppId === c.rivalClubId || opp.rivalClubId === c.id) urgent.push(`דרבי ${when} נגד ${opp.name}`);
      else pool.push(`${when}: ${f.home === c.id ? 'בבית' : 'בחוץ'} מול ${opp.name}, מקום ${tablePosition(world, oppId)} בטבלה`);
    }
  }
  if (u.contract) {
    const tw = Math.max(1, world.season.totalWeeks);
    const months = Math.max(0, (u.contract.endSeason - world.season.number) * 12 + Math.round(((tw - world.season.week) / tw) * 10));
    if (u.contract.endSeason <= world.season.number) pool.push(months <= 1 ? 'החוזה שלך נגמר בעוד חודש' : `החוזה שלך נגמר בעוד ${months} חודשים`);
    else if (months <= 18) pool.push(`עוד ${count(months, 'חודש', 'חודשים')} לסוף החוזה`);
  }
  const ng = nearGoals(world)[0];
  if (ng) pool.push(ng.text);
  const rival = world.people[world.career.rivalId] as Footballer | undefined;
  if (rival && !rival.retired && u.pos !== 'GK' && rival.clubId != null) {
    const rf = fixtureFor(world, rival.clubId, world.season.week);
    const rg = rf?.played ? rf.scorers?.filter((x) => x.playerId === rival.id).length ?? 0 : 0;
    // only when there is news: he scored this week, or the race is on (both scoring), and not every week
    const race = (n: number): string => (n ? count(n, 'שער', 'שערים') : 'עוד בלי שערים');
    if (rg > 0) pool.push(`${firstName(rival.name)} ${rg === 1 ? 'כבש' : rg === 2 ? 'כבש צמד' : `כבש ${rg}`} השבוע. ${race(rival.stats.goals)} לו העונה, ${race(u.stats.goals)} לך`);
    else if (rival.stats.goals > 0 && u.stats.goals > 0 && world.season.week % 4 === 0) pool.push(`המרוץ מול ${firstName(rival.name)}: ${count(rival.stats.goals, 'שער', 'שערים')} לו, ${count(u.stats.goals, 'שער', 'שערים')} לך`);
  }
  if (!isWindowOpen(world)) {
    const mid = Math.floor(world.season.totalWeeks / 2) - 1;
    if (world.season.week < mid && mid - world.season.week <= 3) pool.push('חלון ההעברות של ינואר נפתח בקרוב');
  }
  if (u.age >= 33) pool.push('הגוף מאט. אולי זו העונה האחרונה');
  const out = urgent.slice(0, 2);
  if (pool.length) {
    const start = world.absWeek % pool.length;
    for (let i = 0; i < pool.length && out.length < 3; i++) out.push(pool[(start + i) % pool.length]);
  }
  if (!out.length) out.push('שבוע חדש, הזדמנות חדשה');
  return out.slice(0, 3);
}

// ------------------------------------------------------------------ week / season transitions

function advanceWeek(world: World, content: Content, rng: Rng, toast: string[]): void {
  world.live = null;
  world.career.lastSkip = null;
  world.career.quickFlow = false;
  world.career.prematch = null;
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
      meanwhile: rep.lines.slice(0, 5), openLoops: openLoops(world), nearGoals: nearGoals(world), notable: true, gainsNote: 'העונה נגמרה. הגוף נח לפני הבאה.',
    };
    if (rep.forcedRetire) { retireUser(world, `בגיל ${RETIRE_FORCED_AGE} הגוף אמר את המילה האחרונה`); return; }
    if ((world.history.flags.farewell ?? 0) >= 1) { retireUser(world, 'משחק פרידה, והנעליים נתלו'); return; }
    world.phase = 'offseason';
    // a reserve (B) team player who is good enough goes up to the parent's first team
    // ...and one who has outgrown it is let go, so the summer finds him a first-team club
    const called = reserveCallUp(world, content) ?? reserveRelease(world);
    if (called) toast.unshift(called);
    // summer window: a few offers
    const n = (rng.chance(0.3 + world.career.fame / 200) ? 1 : 0) + (world.career.fame > 60 && rng.chance(0.5) ? 1 : 0);
    for (let i = 0; i < n; i++) spawnOffer(world, content, rng, rng.chance(0.3) ? 'bigger' : rng.chance(0.2) ? 'abroad' : 'any');
    const u = userPlayer(world);
    // still at a reserve team: the agent finds a first-team club
    if (atReserve(world) && u.age >= RESERVE_TUNING.agentPushAge) spawnOffer(world, content, rng, 'any');
    if (u.contract && u.contract.endSeason <= world.season.number) {
      toast.push('החוזה שלך נגמר. אפשר לבקש חידוש או לבחור הצעה');
      if (!world.career.offers.length) spawnOffer(world, content, rng, 'any');
    }
    return;
  }
  world.phase = 'plan';
  const w = windowName(world);
  if (w === 'january' && world.season.week === Math.floor(world.season.totalWeeks / 2) - 1) {
    toast.push('חלון ההעברות של ינואר נפתח');
    const called = reserveCallUp(world, content);
    if (called) toast.push(called);
  }
}

function contractExpired(world: World): boolean {
  const u = userPlayer(world);
  return !!u.contract && u.contract.endSeason <= world.season.number;
}

/** Value of an offer to the user: wage, weighted by the role he would get. */
function offerScore(o: { wage: number; role: string }): number {
  return o.wage * ({ star: 1.3, starter: 1.15, rotation: 1, prospect: 0.95, backup: 0.8 } as Record<string, number>)[o.role];
}

/**
 * Offseason -> next season. With an expired contract the UI asks first ("לבדוק הצעות" / "המועדון יחליט");
 * pressing on means the club decides, in one press: the best pending offer, else a renewal, else a club the agent finds,
 * else a short fallback deal.
 */
function beginNextSeason(world: World, content: Content, rng: Rng, toast: string[]): void {
  const u = userPlayer(world);
  if (contractExpired(world)) {
    const c = userClub(world)!;
    const pending = world.career.offers.filter((o) => o.expiresWeek >= world.absWeek).sort((a, b) => offerScore(b) - offerScore(a));
    const sign = (r: ReturnType<typeof openNegotiation>): boolean => {
      if (typeof r === 'string') return false;
      const n = world.career.negotiation;
      const terms = n ? { club: world.clubs[n.clubId].name, ...n.currentOffer } : null;
      const lines = acceptCurrent(world, content);
      world.career.negotiation = null;
      if (contractExpired(world)) return false;
      // the club decided: say exactly what was signed (club, wage, role, years)
      if (terms) {
        const line = `המועדון החליט: ${terms.club}, ${fmtMoney(terms.wage)} לחודש, ${SQUAD_ROLE_HE[terms.role]}, ${pre('ל', count(terms.years, 'שנה', 'שנים', true))}`;
        toast.unshift(line);
        addNews(world, { kind: 'transfer', headline: line });
      } else toast.push(...lines);
      return true;
    };
    let done = false;
    for (const o of pending) { if (sign(openNegotiation(world, content, rng, o.fromClubId, o, 'offseason'))) { done = true; break; } }
    if (!done) done = sign(openNegotiation(world, content, rng, c.id, null, 'offseason'));
    if (!done) {
      // from a reserve team any first-team club will do; elsewhere a step down to play comes first
      const o = atReserve(world) ? spawnOffer(world, content, rng, 'any') ?? spawnOffer(world, content, rng, 'lower')
        : spawnOffer(world, content, rng, 'lower') ?? spawnOffer(world, content, rng, 'any');
      if (o) done = sign(openNegotiation(world, content, rng, o.fromClubId, o, 'offseason'));
    }
    if (!done && contractExpired(world)) {
      u.contract = { ...u.contract!, endSeason: world.season.number + 1, role: 'backup', monthlyWage: Math.round(u.contract!.monthlyWage * 0.8 / 100) * 100 };
      toast.unshift(`אף אחד לא סגר איתך. נשארת ${pre('ב', c.name)}: ${fmtMoney(u.contract.monthlyWage)} לחודש, ${SQUAD_ROLE_HE.backup}, לעונה אחת`);
      pushHistory(world, 'short_deal', `נשארת ${pre('ב', c.name)} בחוזה קצר`);
    }
  }
  world.absWeek++;
  startSeason(world, content, rng, world.season.number + 1, world.season.year + 1);
  world.career.negotiation = null;
  world.phase = 'plan';
  toast.push(`עונה ${world.season.number} מתחילה`);
  toast.push(...lifeSeasonStep(world).slice(0, 2));
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
  addNews(world, { kind: 'career', headline: `${u.name} פורש: ${count(u.careerStats.goals, 'שער', 'שערים')} ${pre('ב', count(u.careerStats.apps, 'הופעה', 'הופעות', true))}` });
}

// ------------------------------------------------------------------ view

function clubView(world: World, id: number): ClubView {
  const c = world.clubs[id];
  const lg = world.leagues[c.leagueId];
  return { id: c.id, name: c.name, short: c.short, city: c.city, colors: c.colors, crest: c.crest, reputation: c.reputation, leagueName: lg.name, country: lg.country, stadium: c.stadium, facilities: clubFacilities(world, id) };
}

function personView(world: World, id: number | null | undefined): PersonView | null {
  if (id == null) return null;
  const p = world.people[id];
  if (!p) return null;
  const v: PersonView = { id: p.id, name: p.name, role: p.role, traits: p.traits, relation: Math.round(relationOf(p, world.career.playerId)), age: p.age, clubId: p.clubId };
  if (p.archetype) v.archetype = p.archetype;
  return v;
}

/** How much overall a player can still add at this age (scout's realism). */
function growthLeft(age: number): number {
  return age <= 18 ? 40 : age <= 21 ? 26 : age <= 24 ? 12 : age <= 27 ? 5 : age <= 29 ? 2 : 0.5;
}

/** Scout's potential estimate: centred on what is really reachable, width by agent (mentor narrow, uncle wide), narrowing with age. */
export function potentialRange(world: World, p: Footballer): [number, number] {
  const o = ovr(p);
  const reach = Math.max(o, Math.min(p.potential, o + growthLeft(p.age)));
  const ag = world.people[world.career.agentId];
  const base = ag?.archetype === 'mentor' ? 3 : ag?.archetype === 'shark' ? 5 : 7;
  const hw = Math.max(1, Math.round(base * clamp((31 - p.age) / 14, 0.3, 1)));
  const jitter = ((world.seed >>> 5) % 3) - 1; // the scout is never exactly right
  const centre = reach + jitter;
  const lo = clamp(Math.round(centre - hw), 1, 99);
  const hi = clamp(Math.round(Math.min(centre + hw, o + growthLeft(p.age) + 1)), lo, 99);
  return [Math.max(lo, Math.min(Math.floor(o), hi)), hi];
}

/** Every club of the career (history + current), for the career-end timeline and share card. */
function careerClubs(world: World): Record<number, ClubView> {
  const out: Record<number, ClubView> = {};
  for (const h of world.career.history) if (world.clubs[h.clubId]) out[h.clubId] = clubView(world, h.clubId);
  const c = userClub(world);
  if (c) out[c.id] = clubView(world, c.id);
  return out;
}

/** "The decision that changed everything" and "the person who mattered most", from the career's own history. */
export function careerStory(world: World): { turningPoint?: string; keyPerson?: string } {
  const out: { turningPoint?: string; keyPerson?: string } = {};
  const h = world.career.history;
  const u = userPlayer(world);
  // the move with the biggest jump in league level
  let best = 0;
  for (let i = 1; i < h.length; i++) {
    if (h[i].clubId === h[i - 1].clubId) continue;
    const a = world.leagues[h[i - 1].leagueId], b = world.leagues[h[i].leagueId];
    if (!a || !b) continue;
    const jump = Math.abs(b.strength - a.strength) + (a.countryCode !== b.countryCode ? 8 : 0) + 1;
    if (jump > best) {
      best = jump;
      const from = world.clubs[h[i - 1].clubId]?.name ?? 'המועדון הקודם';
      const to = world.clubs[h[i].clubId]?.name ?? 'מועדון חדש';
      const age = u.age - (world.season.number - h[i].season);
      out.turningPoint = `המעבר ${pre('מ', from)} ${pre('ל', to)}, בגיל ${Math.max(16, age)}`;
    }
  }
  if (!out.turningPoint) {
    const tags = ['moved_abroad', 'came_home', 'title', 'national_debut', 'senior_debut', 'first_goal'];
    for (const t of tags) {
      const e = world.history.entries.find((x) => x.tag === t && x.text);
      if (e) { out.turningPoint = e.text; break; }
    }
  }
  // the person with the strongest bond (or feud), memories count double
  const ROLE_HE: Record<string, string> = { coach: 'המאמן', agent: 'הסוכן', family: 'מהמשפחה', player: 'שחקן', journalist: 'עיתונאי', chairman: 'יו״ר' };
  let top: { name: string; role: string; v: number; neg: boolean } | null = null;
  for (const k in world.people) {
    const p = world.people[k];
    if (p.id === u.id) continue;
    const r = p.relations[u.id];
    if (!r) continue;
    const v = Math.abs(r.score) + r.memories.reduce((s, m) => s + Math.abs(m.weight), 0) * 2;
    if (!top || v > top.v) top = { name: p.name, role: p.id === world.career.rivalId ? 'המתחרה' : ROLE_HE[p.role] ?? '', v, neg: r.score < 0 };
  }
  if (top && top.v >= 10) out.keyPerson = `${top.name}, ${top.role}${top.neg ? '. לא תמיד לטובה' : ''}`;
  return out;
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
  const teammates = c ? c.squad.filter((id) => id !== u.id).map((id) => personView(world, id)).filter((p): p is PersonView => !!p) : [];
  const people: Record<number, PersonView> = {};
  const ids = new Set<number>([k.agentId, k.rivalId]);
  if (c) ids.add(c.managerId);
  for (const e of world.inbox) for (const id of Object.values(e.cast)) ids.add(id);
  for (const id of ids) { const pv = personView(world, id); if (pv) people[id] = pv; }
  return {
    phase: world.phase, seed: world.seed, absWeek: world.absWeek,
    season: { number: world.season.number, year: world.season.year, week: world.season.week, totalWeeks: world.season.totalWeeks, themes: world.season.themes.slice() },
    player: {
      id: u.id, name: u.name, age: u.age, pos: u.pos, attr: { ...u.attr }, overall: Math.floor(ovr(u)), potentialRange: potentialRange(world, u),
      form: u.form, fitness: Math.round(u.fitness), morale: Math.round(u.morale), injury: u.injury ? { ...u.injury } : null,
      contract: u.contract ? { ...u.contract, bonuses: u.contract.bonuses.slice() } : null, stats: { ...u.stats }, careerStats: { ...u.careerStats }, shirt: u.shirt ?? 0,
      persistence: Math.round(persistenceOf(world)),
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
      negotiation: k.negotiation ? { ...k.negotiation, hiddenCeiling: 0, final: !!k.negotiation.final } : null, retired: k.retired, retirementReason: k.retirementReason, seasonsPlayed: k.seasonsPlayed,
      ...(k.renewalBlockedUntil != null && k.renewalBlockedUntil > world.absWeek ? { renewalBlockedUntil: k.renewalBlockedUntil } : {}),
    })),
    inbox: world.inbox.map((e) => ({ ...e })),
    news: world.news.slice(0, 20),
    live: world.live ? JSON.parse(JSON.stringify(world.live)) : null,
    lastWeekReport: world.lastWeekReport,
    eventOutcome: world.career.eventOutcome ?? null,
    offerClubs,
    teammates,
    people,
    leagueZones: lg ? {
      promote: lg.promotesTo != null ? lg.promoteSpots : 0, relegate: lg.relegatesTo != null ? lg.relegateSpots : 0, champion: 1,
      rounds: c ? (world.season.fixtures[lg.id] ?? []).filter((f) => f.home === c.id || f.away === c.id).length : undefined,
    } : undefined,
    settings: { autoMoments: world.settings.autoMoments, seasonSpeed: seasonSpeed(world) },
    skip: k.lastSkip && k.lastSkip.absWeek === world.absWeek ? JSON.parse(JSON.stringify(k.lastSkip)) : null,
    careerClubs: careerClubs(world),
    careerStory: careerStory(world),
    ...(world.phase === 'prematch' && k.prematch ? { prematch: { lineup: k.prematch.lineup, reason: k.prematch.reason, subMinute: k.prematch.subMinute } } : {}),
  };
}

/** Average helper exported for tools. */
export const _avg = avg;
