// Choreography helpers shared by the scenario files (pure data builders).
import type { Step, Target } from './types';

/** ball move; `arc` lifts it (lob) */
export const B = (to: Target, at = 0, d = 0.5, arc = 0): Step => ({ w: 'ball', to, at, d, arc });
/** magnet move */
export const M = (w: string, to: Target, at = 0, d = 0.5, pose?: Step['pose']): Step => ({ w, to, at, d, pose });

/** shot that beats the keeper ('gk'): he dives short */
export const score = (target: string, at = 0, d = 0.45, arc = 0, keeper = 'gk'): Step[] =>
  [B(target, at, d, arc), M(keeper, target === 'near' || target === 'nearTop' ? 'nearShort' : 'farShort', at + 0.06, 0.45, 'dive')];
/** the keeper ('gk') gets there */
export const saved = (target: string, at = 0, d = 0.45, arc = 0, keeper = 'gk'): Step[] =>
  [B(target, at, d, arc), M(keeper, target, at + 0.04, d - 0.02, 'dive'), B({ p: target, dy: 7, dx: 0 }, at + d, 0.45)];
/** the ball is passed to `to` and he moves on with it */
export const pass = (to: string, at = 0, d = 0.4, arc = 0, run: { dx?: number; dy?: number } = {}): Step[] =>
  [B(to, at, d, arc), ...(run.dx || run.dy ? [M(to, { id: to, dx: run.dx ?? 0, dy: run.dy ?? 0 }, at + d, 0.5), B({ id: to, dx: run.dx ?? 0, dy: (run.dy ?? 0) + (run.dy && run.dy < 0 ? -1.2 : 1.2) }, at + d, 0.5)] : [])];
/** `who` cuts out a ball travelling to `to`: he steps in, takes it and goes the other way */
export const cutOut = (who: string, to: string, at = 0, d = 0.4, away: Target = 'up'): Step[] =>
  [M(who, { id: to, dy: 3 }, at, d), B({ id: to, dy: 3 }, at, d), B(away, at + d + 0.05, 0.55), M(who, away, at + d + 0.05, 0.6)];
