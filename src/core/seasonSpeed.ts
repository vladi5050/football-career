// Season speed: which weeks the user plays and which run automatically.
//   full     = every match (today's behaviour)
//   balanced = important matches: derbies, close table neighbours, top/bottom 3, the run-in of a race, and one in three anyway
//   key      = key matches only: derbies, direct rivals in the last 8 weeks, deciders, first match at a new club
// Pure functions of the world; the loop that runs the weeks lives in game.ts.
import type { Content } from './content';
import type { ActiveEvent, SeasonSpeed, TableRow, World } from './types';
import { userClub, userPlayer } from './helpers';
import { fixtureFor, sortedTable } from './schedule';

export const SPEED_TUNING = {
  closePlaces: 1, // balanced: opponent within this many table places
  edgeRows: 2, // balanced: top 2 / bottom 2
  raceWeeksBalanced: 6, // balanced: last N weeks of the season, when in a race
  raceWeeksKey: 8, // key: last N weeks, direct rivals
  racePoints: 6, // points from a zone line that still count as "in the race"
  oneInN: 3, // balanced: play at least one match in N
  deciderMatches: 3, // key: our last N league matches decide a race
};

export const SPEED_HE: Record<SeasonSpeed, string> = { full: 'כל משחק', balanced: 'משחקים חשובים', key: 'רק משחקי מפתח' };

export function seasonSpeed(world: World): SeasonSpeed {
  return world.settings.seasonSpeed ?? 'full';
}

type Race = 'title' | 'promotion' | 'relegation';

/** Zone lines of the user's league: [index of the last row inside the zone, race]. */
function zoneLines(world: World, rows: TableRow[]): [number, Race][] {
  const c = userClub(world);
  if (!c) return [];
  const lg = world.leagues[c.leagueId];
  const n = rows.length;
  const out: [number, Race][] = [];
  if (n >= 2) out.push([0, 'title']);
  if (lg.promotesTo != null && lg.promoteSpots > 0 && lg.promoteSpots < n) out.push([lg.promoteSpots - 1, 'promotion']);
  if (lg.relegatesTo != null && lg.relegateSpots > 0 && lg.relegateSpots < n) out.push([n - lg.relegateSpots - 1, 'relegation']);
  return out;
}

/** Races a club is in: within `racePoints` of a zone line, from either side. */
export function racesOf(world: World, clubId: number): Race[] {
  const c = userClub(world);
  if (!c) return [];
  const rows = sortedTable(world.season.tables[c.leagueId] ?? []);
  const i = rows.findIndex((r) => r.clubId === clubId);
  if (i < 0) return [];
  const pts = rows[i].pts;
  const out: Race[] = [];
  for (const [line, race] of zoneLines(world, rows)) {
    const inside = rows[line], outside = rows[line + 1];
    if (!inside || !outside) continue;
    const near = i <= line ? pts - outside.pts <= SPEED_TUNING.racePoints : inside.pts - pts <= SPEED_TUNING.racePoints;
    if (near) out.push(race);
  }
  return out;
}

/** Weeks left in the season including this one. */
function weeksLeft(world: World): number {
  return world.season.totalWeeks - world.season.week;
}

/** League matches the club still has, this one included. */
function matchesLeft(world: World, clubId: number): number {
  const c = world.clubs[clubId];
  return (world.season.fixtures[c.leagueId] ?? []).filter((f) => !f.played && f.week >= world.season.week && (f.home === clubId || f.away === clubId)).length;
}

const RACE_HE: Record<Race, string> = { title: 'על האליפות', promotion: 'על העלייה', relegation: 'על ההישארות' };

/**
 * Why this week's match must be played at the given speed (Hebrew reason), or null when it can run automatically.
 * 'full' always plays. No match this week, or the user injured: nothing to play.
 */
export function importantMatch(world: World, speed: SeasonSpeed): string | null {
  if (speed === 'full') return 'כל משחק';
  const c = userClub(world);
  if (!c) return null;
  const f = fixtureFor(world, c.id, world.season.week);
  if (!f || f.played) return null;
  const u = userPlayer(world);
  if (!world.history.flags.first_match_done) return 'המשחק הראשון בקריירה';
  if (u.injury) return null; // nothing to play from the stands
  const oppId = f.home === c.id ? f.away : f.home;
  const opp = world.clubs[oppId];
  if (c.rivalClubId === oppId || opp.rivalClubId === c.id) return `דרבי מול ${opp.name}`;
  if (world.career.matchClubId != null && world.career.matchClubId !== c.id) return 'המשחק הראשון במועדון החדש';
  const rows = sortedTable(world.season.tables[c.leagueId] ?? []);
  const me = rows.findIndex((r) => r.clubId === c.id);
  const them = rows.findIndex((r) => r.clubId === oppId);
  const myRaces = racesOf(world, c.id);
  const left = weeksLeft(world);
  if (speed === 'key') {
    if (myRaces.length && matchesLeft(world, c.id) <= SPEED_TUNING.deciderMatches) return `משחק מכריע במאבק ${RACE_HE[myRaces[0]]}`;
    if (left <= SPEED_TUNING.raceWeeksKey && myRaces.length) {
      const theirs = racesOf(world, oppId);
      const shared = myRaces.find((r) => theirs.includes(r));
      if (shared && Math.abs(me - them) <= SPEED_TUNING.closePlaces) return `יריבה ישירה במאבק ${RACE_HE[shared]}`;
    }
    return null;
  }
  // balanced
  const played = rows[me]?.p ?? 0;
  if (played >= 2 && me >= 0 && them >= 0) {
    if (Math.abs(me - them) <= SPEED_TUNING.closePlaces) return `${opp.name} צמודה אליכם בטבלה`;
    if (them < SPEED_TUNING.edgeRows) return `${opp.name} מהשתיים הראשונות בטבלה`;
    if (them >= rows.length - SPEED_TUNING.edgeRows) return `${opp.name} מהשתיים התחתונות בטבלה`;
  }
  if (left <= SPEED_TUNING.raceWeeksBalanced && myRaces.length) return `סוף העונה, ואתם במאבק ${RACE_HE[myRaces[0]]}`;
  if ((world.career.ffAutoMatches ?? 0) >= SPEED_TUNING.oneInN - 1) return 'משחק אחד מכל שלושה משחקים בכל מקרה';
  return null;
}

/** Events a fast-forward never answers for the player: transfer, contract, injury, captaincy, national team (and the other major ones). */
export function isStopEvent(content: Content, ev: Pick<ActiveEvent, 'templateId' | 'category'>, isMajor: (c: Content, e: Pick<ActiveEvent, 'templateId' | 'category'>) => boolean): boolean {
  return isMajor(content, ev) || ev.category === 'injury' || ev.category === 'agent';
}
