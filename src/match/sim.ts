// Pure key-moment logic: ball physics, keeper/defender decisions, timing and outcome resolution.
// NO Pixi / DOM imports here: everything is unit testable in Node.
//
// World coordinates (metres): x = lateral (0 = centre of the goal, + = right when facing the goal),
// z = distance from the goal line into the pitch (goal mouth at z = 0, net behind at z < 0),
// h = height above the grass.
import type { ContextMods, MomentKind, MomentSpec } from '../core/types';
import type { Tuning } from './tuning';

export const GOAL_HALF = 3.66;
export const BAR = 2.44;
export const BALL_R = 0.11;
export const NET_DEPTH = 1.8;

export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const clamp01 = (v: number) => clamp(v, 0, 1);

export function gaussian(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ------------------------------------------------------------------ ball physics

export interface Vec3 { x: number; z: number; h: number }
export interface Ball extends Vec3 { vx: number; vz: number; vh: number; /** lateral accel (m/s^2), + = to the right of travel */ spin: number }
export interface BallFrame extends Vec3 { t: number }
export interface BallEnv { gravity: number; friction: number; airDrag: number; bounce: number; spinDecay: number }

export function envFor(t: Tuning, rain: boolean): BallEnv {
  return {
    gravity: t.gravity,
    friction: t.groundFriction * (rain ? t.rainFriction : 1),
    airDrag: t.airDrag,
    bounce: t.bounce,
    spinDecay: t.spinDecay,
  };
}

/** One explicit-Euler step. Pure: returns a new ball. */
export function stepBall(b: Ball, dt: number, env: BallEnv): Ball {
  let { vx, vz, vh, spin } = b;
  const sp = Math.hypot(vx, vz);
  // spin: lateral acceleration perpendicular to horizontal velocity. Right of travel = (-vz, vx)/|v|
  if (sp > 0.5 && spin !== 0) {
    const rx = -vz / sp;
    const rz = vx / sp;
    const grip = b.h > 0.02 ? 1 : 0.8;
    vx += rx * spin * dt * grip;
    vz += rz * spin * dt * grip;
  }
  const onGround = b.h <= 0.001 && Math.abs(vh) < 0.01;
  const drag = onGround ? env.friction : env.airDrag;
  const k = Math.max(0, 1 - drag * dt);
  vx *= k;
  vz *= k;
  if (!onGround) vh -= env.gravity * dt;
  const x = b.x + vx * dt;
  const z = b.z + vz * dt;
  let h = b.h + vh * dt;
  if (h < 0) {
    h = 0;
    vh = Math.abs(vh) > 1.2 ? -vh * env.bounce : 0;
  }
  spin *= Math.max(0, 1 - env.spinDecay * dt);
  return { x, z, h, vx, vz, vh, spin };
}

/**
 * Launch velocity so that the ball (ignoring bounces) reaches `target` with horizontal speed `speed`.
 * `curl` = lateral acceleration (m/s^2): the launch is aimed off to the other side so it bends back in.
 */
export function launchToward(from: Vec3, target: Vec3, speed: number, curl: number, env: BallEnv): Ball {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.max(0.1, Math.hypot(dx, dz));
  const T = d / Math.max(1, speed);
  // compensate air drag (average speed loss) so the ball arrives roughly on time
  const sp = speed * (1 + (env.airDrag * T) / 2);
  const ux = dx / d;
  const uz = dz / d;
  // right of travel
  const rx = -uz;
  const rz = ux;
  const off = 0.5 * curl * T * T;
  const ax = target.x - rx * off;
  const az = target.z - rz * off;
  const ad = Math.max(0.1, Math.hypot(ax - from.x, az - from.z));
  const vh = (target.h - from.h + 0.5 * env.gravity * T * T) / T;
  return { x: from.x, z: from.z, h: from.h, vx: ((ax - from.x) / ad) * sp, vz: ((az - from.z) / ad) * sp, vh, spin: curl };
}

/**
 * Ground pass along world direction (dx,dz) that rolls ~dist metres. `bow` (-1..1) = how much the swipe
 * bowed to the right of travel: the ball starts out toward the bow and spin bends it back.
 */
export function rollPass(from: { x: number; z: number }, dx: number, dz: number, dist: number, bow: number, env: BallEnv): Ball {
  const l = Math.hypot(dx, dz) || 1;
  const ux = dx / l; const uz = dz / l;
  const th = clamp(bow * 2.2, -0.55, 0.55);
  // rotate toward the right of travel by th (right = (-uz, ux))
  const c = Math.cos(th); const s = Math.sin(th);
  const vx = ux * c + -uz * s;
  const vz = uz * c + ux * s;
  const speed = clamp(dist * env.friction + 2.5, 7, 30);
  const T = Math.max(0.4, Math.min(2.0, dist / (speed * 0.6)));
  const spin = th === 0 ? 0 : (-Math.sign(th) * 2 * dist * Math.abs(Math.sin(th))) / (T * T);
  return { x: from.x, z: from.z, h: 0.0, vx: vx * speed, vz: vz * speed, vh: 0, spin };
}

/** Integrate until `stop` returns true (or maxT). Frames sampled at 60 Hz. */
export function fly(b0: Ball, env: BallEnv, stop: (b: Ball, t: number) => boolean, maxT = 3, dt = 1 / 240): { frames: BallFrame[]; end: Ball } {
  let b = b0;
  let t = 0;
  const frames: BallFrame[] = [{ t: 0, x: b.x, z: b.z, h: b.h }];
  let next = 1 / 60;
  while (t < maxT) {
    b = stepBall(b, dt, env);
    t += dt;
    if (t >= next - 1e-9) {
      frames.push({ t, x: b.x, z: b.z, h: b.h });
      next += 1 / 60;
    }
    if (stop(b, t)) {
      if (frames[frames.length - 1].t !== t) frames.push({ t, x: b.x, z: b.z, h: b.h });
      break;
    }
  }
  return { frames, end: b };
}

/** First point where the path crosses plane z = zp (either direction). Interpolated. */
export function crossingAt(frames: BallFrame[], zp: number): BallFrame | null {
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if ((a.z - zp) * (b.z - zp) <= 0 && a.z !== b.z) {
      const u = (a.z - zp) / (a.z - b.z);
      return { t: lerp(a.t, b.t, u), x: lerp(a.x, b.x, u), z: zp, h: lerp(a.h, b.h, u) };
    }
  }
  return null;
}

/** Ball position at time t along frames (linear). */
export function sampleFrames(frames: BallFrame[], t: number): BallFrame {
  if (t <= frames[0].t) return frames[0];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].t >= t) {
      const a = frames[i - 1];
      const b = frames[i];
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { t, x: lerp(a.x, b.x, u), z: lerp(a.z, b.z, u), h: lerp(a.h, b.h, u) };
    }
  }
  return frames[frames.length - 1];
}

// ------------------------------------------------------------------ difficulty / context

export function reactionTime(difficulty: number, t: Tuning): number {
  return lerp(t.reactEasy, t.reactHard, clamp01(difficulty));
}

export function contextWindowFactor(ctx: ContextMods, t: Tuning): number {
  let f = 1;
  if (ctx.lateClose) f *= t.lateCloseWindow;
  if (ctx.hostileCrowd) f *= t.hostileWindow;
  return f;
}

/** Half-width (ms) of a tap timing window for this spec. */
export function windowHalfMs(spec: Pick<MomentSpec, 'difficulty' | 'attackerSkill' | 'context'>, t: Tuning, base = t.tapWindowMs): number {
  const diff = lerp(1, t.hardWindowFactor, clamp01(spec.difficulty));
  const skill = 1 + t.skillWindowBonus * clamp01((spec.attackerSkill - 1) / 98);
  return base * diff * skill * contextWindowFactor(spec.context, t);
}

export interface TimingGrade { grade: 'early' | 'perfect' | 'good' | 'late'; hit: boolean; accuracy: number }

/** err = tapTime - idealTime (ms). Inside ±half => hit. accuracy 1 at 0 error, 0 at the window edge. */
export function gradeTiming(errMs: number, halfMs: number): TimingGrade {
  const a = Math.abs(errMs);
  if (a <= halfMs) {
    const accuracy = clamp01(1 - a / halfMs);
    return { grade: accuracy > 0.6 ? 'perfect' : 'good', hit: true, accuracy };
  }
  return { grade: errMs < 0 ? 'early' : 'late', hit: false, accuracy: 0 };
}

/** Timing moments: quality from accuracy if hit, small consolation if close. */
export function timingQuality(g: TimingGrade, errMs: number, halfMs: number): number {
  if (g.hit) return clamp01(0.55 + 0.45 * g.accuracy);
  const over = (Math.abs(errMs) - halfMs) / halfMs; // 0 just outside
  return clamp01(0.3 - 0.2 * Math.min(1, over));
}

export function aimNoise(skill: number, power: number, t: Tuning): number {
  const s = lerp(t.aimNoiseLow, t.aimNoiseHigh, clamp01((skill - 1) / 98));
  return s * (0.55 + 0.75 * power * power);
}

// ------------------------------------------------------------------ keeper

export interface KeeperDecision { saved: boolean; margin: number; reach: number; needed: number; diveX: number; diveH: number; diveStart: number }

/** Can a keeper standing at keeperX on the line reach point (x,h) that arrives after tArrive seconds? */
export function keeperReach(keeperX: number, pt: { x: number; h: number }, tArrive: number, react: number, t: Tuning, reachMul = 1): KeeperDecision {
  const dx = pt.x - keeperX;
  // heights between 0.2m and 1.7m are comfortable; top corners cost extra
  const dh = Math.max(0, pt.h - 1.7) * 1.1 + Math.max(0, 0.15 - pt.h);
  const needed = Math.hypot(dx, dh);
  const avail = Math.min(3.6, (t.keeperReach + t.keeperDiveSpeed * Math.max(0, tArrive - react)) * reachMul);
  const saved = needed <= avail;
  const u = needed > 0 ? Math.min(1, avail / needed) : 1;
  return {
    saved, margin: needed - avail, reach: avail, needed,
    diveX: keeperX + dx * u, diveH: clamp(0.4 + (pt.h - 0.4) * u, 0.25, 2.4), diveStart: react,
  };
}

export type ShotResult = 'goal' | 'saved' | 'post' | 'wide' | 'over' | 'blocked' | 'weak';

export function frameOnTarget(x: number, h: number): 'in' | 'post' | 'wide' | 'over' {
  const ax = Math.abs(x);
  if (ax < GOAL_HALF - BALL_R && h < BAR - BALL_R) return 'in';
  if ((ax < GOAL_HALF + BALL_R && ax >= GOAL_HALF - BALL_R && h < BAR + BALL_R) || (h >= BAR - BALL_R && h < BAR + BALL_R && ax < GOAL_HALF + BALL_R)) return 'post';
  if (h >= BAR) return 'over';
  return 'wide';
}

// ------------------------------------------------------------------ shots

export interface ShotInput { from: Vec3; target: { x: number; h: number }; power: number; /** -1..1 */ curl: number; skill: number }
export interface Obstacle { x0: number; x1: number; z: number; height: number }
export interface ShotSetup {
  keeperX: number;
  react: number;
  reachMul: number;
  rain: boolean;
  walls?: Obstacle[];
  /** extra speed multiplier (e.g. headers are slower) */
  speedMul?: number;
  /** penalties: keeper commits to a side before the kick (-1 left, 1 right, 0 stays) */
  keeperGuess?: -1 | 0 | 1;
}
export interface ShotOutcome {
  result: ShotResult;
  success: boolean;
  quality: number;
  frames: BallFrame[];
  /** time the ball reaches the goal plane / keeper / wall */
  tContact: number;
  crossing: BallFrame | null;
  keeper: KeeperDecision | null;
  aimed: { x: number; h: number };
}

export function resolveShot(inp: ShotInput, setup: ShotSetup, t: Tuning, rng: Rng): ShotOutcome {
  const env = envFor(t, setup.rain);
  const sigma = aimNoise(inp.skill, inp.power, t);
  let tx = inp.target.x + gaussian(rng) * sigma;
  let th = Math.max(0, inp.target.h + gaussian(rng) * sigma * 0.5);
  if (setup.rain) {
    tx += (rng() * 2 - 1) * t.rainDeviation;
    th += (rng() * 2 - 1) * t.rainDeviation * 0.4;
  }
  const speed = lerp(t.shotSpeedMin, t.shotSpeedMax, clamp01(inp.power)) * (setup.speedMul ?? 1);
  const curl = clamp(inp.curl, -1, 1) * t.maxCurlAccel;
  const b0 = launchToward(inp.from, { x: tx, z: 0, h: th }, speed, curl, env);
  const walls = setup.walls ?? [];
  let wallHit: BallFrame | null = null;
  const flight = fly(b0, env, (b, tt) => {
    for (const w of walls) {
      if (Math.abs(b.z - w.z) < 0.25 && b.x > w.x0 && b.x < w.x1 && b.h < w.height) { wallHit = { t: tt, x: b.x, z: b.z, h: b.h }; return true; }
    }
    return b.z < -0.05 || (Math.hypot(b.vx, b.vz) < 1.5 && b.h < 0.05);
  }, 4);
  const frames = flight.frames;
  const aimed = { x: tx, h: th };

  if (wallHit) {
    const w = wallHit as BallFrame;
    const reb = fly(
      { x: w.x, z: w.z, h: w.h, vx: (rng() - 0.5) * 6, vz: 7 + rng() * 4, vh: 3 + rng() * 2, spin: 0 },
      env, (_b, tt) => tt > 1.2, 1.2,
    );
    return {
      result: 'blocked', success: false, quality: 0.18, tContact: w.t, crossing: null, keeper: null, aimed,
      frames: frames.concat(reb.frames.slice(1).map((f) => ({ ...f, t: f.t + w.t }))),
    };
  }

  const cross = crossingAt(frames, 0);
  if (!cross) {
    return { result: 'weak', success: false, quality: 0.08, frames, tContact: frames[frames.length - 1].t, crossing: null, keeper: null, aimed };
  }
  const where = frameOnTarget(cross.x, cross.h);
  // Extend path a little past the line for wide / over / goal (net) visuals
  const tail = (until: number) => {
    const end = flight.end;
    const more = fly(end, env, (b) => b.z < until || b.z > 5, 1.0);
    return frames.concat(more.frames.slice(1).map((f) => ({ ...f, t: f.t + frames[frames.length - 1].t })));
  };
  if (where === 'wide' || where === 'over') {
    const miss = where === 'wide' ? Math.abs(cross.x) - GOAL_HALF : cross.h - BAR;
    return {
      result: where, success: false, quality: clamp01(0.28 - miss * 0.12), frames: tail(-6), tContact: cross.t,
      crossing: cross, keeper: null, aimed,
    };
  }
  if (where === 'post') {
    const back = fly(
      { x: cross.x, z: 0.05, h: cross.h, vx: -Math.sign(cross.x) * (2 + rng() * 3), vz: 9 + rng() * 4, vh: 2, spin: 0 },
      env, (_b, tt) => tt > 1.2, 1.2,
    );
    const pre = frames.filter((f) => f.t <= cross.t);
    return {
      result: 'post', success: false, quality: 0.42, crossing: cross, keeper: null, aimed, tContact: cross.t,
      frames: pre.concat([cross], back.frames.slice(1).map((f) => ({ ...f, t: f.t + cross.t }))),
    };
  }
  const guess = setup.keeperGuess ?? 0;
  const curlMul = Math.abs(inp.curl) > 0.3 ? 0.93 : 1;
  let kd = keeperReach(guess ? guess * 1.1 : setup.keeperX, cross, cross.t, guess ? 0.02 : setup.react, t, setup.reachMul * curlMul);
  if (guess && cross.x * guess < -0.5) kd = { ...kd, saved: false, margin: Math.max(kd.margin, 0.5) };
  if (guess === 0 && setup.keeperGuess === 0 && Math.abs(cross.x) < 1.1 && cross.h < 1.9) kd = { ...kd, saved: true };
  if (kd.saved) {
    const pre = frames.filter((f) => f.t <= cross.t - 0.01);
    const contact: BallFrame = { t: cross.t, x: cross.x, z: 0.35, h: cross.h };
    const parry = fly(
      { x: contact.x, z: contact.z, h: contact.h, vx: Math.sign(cross.x - setup.keeperX || 1) * (3 + rng() * 3), vz: 6 + rng() * 5, vh: 2.5 + rng() * 2, spin: 0 },
      env, (_b, tt) => tt > 1.3, 1.3,
    );
    const corner = clamp01(kd.needed / 3.2);
    return {
      result: 'saved', success: false, quality: clamp01(0.28 + 0.25 * corner), crossing: cross, keeper: kd, aimed, tContact: cross.t,
      frames: pre.concat([contact], parry.frames.slice(1).map((f) => ({ ...f, t: f.t + cross.t }))),
    };
  }
  const q = clamp01(0.62 + 0.38 * clamp01(kd.margin / 1.4));
  return { result: 'goal', success: true, quality: q, frames: tail(-NET_DEPTH + 0.15), tContact: cross.t, crossing: cross, keeper: kd, aimed };
}

// ------------------------------------------------------------------ directional moments

/** Smallest absolute difference between two angles (radians). */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export interface SimpleOutcome { success: boolean; quality: number; reason: string }

/** dribble: swipe to the side opposite the defender's lean, at the moment he commits. */
export function resolveDribble(side: -1 | 1, leanSide: -1 | 1, errMs: number, halfMs: number): SimpleOutcome {
  const g = gradeTiming(errMs, halfMs * 1.25);
  if (g.grade === 'early') return { success: false, quality: 0.2, reason: 'early' };
  if (g.grade === 'late') return { success: false, quality: 0.15, reason: 'late' };
  if (side === leanSide) return { success: false, quality: 0.25, reason: 'wrong_side' };
  return { success: true, quality: clamp01(0.6 + 0.4 * g.accuracy), reason: g.grade };
}

/** tackle: too early = foul, too late = beaten. */
export function resolveTackle(errMs: number, halfMs: number): SimpleOutcome {
  const g = gradeTiming(errMs, halfMs);
  if (g.grade === 'early') return { success: false, quality: errMs < -halfMs * 1.8 ? 0.05 : 0.15, reason: 'foul' };
  if (g.grade === 'late') return { success: false, quality: timingQuality(g, errMs, halfMs), reason: 'beaten' };
  return { success: true, quality: timingQuality(g, errMs, halfMs), reason: g.grade };
}

/** generic timing (interception, rush_out, header contact). */
export function resolveTiming(errMs: number, halfMs: number): SimpleOutcome {
  const g = gradeTiming(errMs, halfMs);
  return { success: g.hit, quality: timingQuality(g, errMs, halfMs), reason: g.grade };
}

/** block: swipe toward where the shot goes (angles in screen radians), before it passes. */
export function resolveBlock(swipeAngle: number, shotAngle: number, swipeBeforeArrivalS: number, react: number, tolRad = 0.5): SimpleOutcome {
  const d = angleDiff(swipeAngle, shotAngle);
  if (swipeBeforeArrivalS < 0) return { success: false, quality: 0.1, reason: 'late' };
  if (d > tolRad * 1.6) return { success: false, quality: 0.15, reason: 'wrong_way' };
  const acc = clamp01(1 - d / (tolRad * 1.6));
  // reacting in less time than the defender's human reaction is a reflex save: bonus
  const reflex = swipeBeforeArrivalS < react ? 0.1 : 0;
  if (d > tolRad) return { success: false, quality: 0.3 + 0.1 * acc, reason: 'deflected' };
  return { success: true, quality: clamp01(0.55 + 0.35 * acc + reflex), reason: 'block' };
}

/**
 * clearance: (wx, wz) = swipe direction in world coords, + z = away from goal. power 0..1.
 * Away from goal and strong enough = success; towards the flanks is safer.
 */
export function resolveClearance(wx: number, wz: number, power: number): SimpleOutcome {
  const len = Math.hypot(wx, wz) || 1;
  const away = wz / len; // cos of angle from straight out
  const lateral = Math.abs(wx / len);
  if (away < -0.2) return { success: false, quality: 0.02, reason: 'own_goal_danger' };
  if (away < 0.26) return { success: false, quality: 0.12, reason: 'sideways' };
  if (power < 0.28) return { success: false, quality: 0.15 + power * 0.3, reason: 'weak' };
  const q = 0.5 + 0.3 * clamp01((power - 0.28) / 0.6) + 0.2 * clamp01(lateral / 0.7);
  return { success: true, quality: clamp01(q), reason: 'cleared' };
}

/**
 * keeper dive (save / penalty as keeper): dive target vs actual crossing.
 * swipeLead = seconds between swipe and ball arrival (negative = too late).
 */
export function resolveDive(dive: { x: number; h: number }, ball: { x: number; h: number }, swipeLead: number, t: Tuning, reachMul = 1): SimpleOutcome & { dist: number } {
  const onFrame = frameOnTarget(ball.x, ball.h);
  if (onFrame === 'wide' || onFrame === 'over') return { success: true, quality: 0.6, reason: 'off_target', dist: 0 };
  if (onFrame === 'post') return { success: true, quality: 0.55, reason: 'post', dist: 0 };
  const dist = Math.hypot(dive.x - ball.x, (dive.h - ball.h) * 0.8);
  if (swipeLead < 0.06) return { success: false, quality: 0.1, reason: 'late', dist };
  const reach = t.keeperReach * 1.25 * reachMul + Math.min(0.5, swipeLead * 0.8);
  if (dist > reach) return { success: false, quality: clamp01(0.3 - (dist - reach) * 0.15), reason: 'wrong_way', dist };
  const acc = clamp01(1 - dist / reach);
  const corner = clamp01(Math.abs(ball.x) / GOAL_HALF);
  return { success: true, quality: clamp01(0.58 + 0.25 * acc + 0.17 * corner), reason: acc > 0.6 ? 'perfect' : 'good', dist };
}

/** one-on-one chip (keeperDist = gap shooter→keeper, m): works when the keeper has come out close and the chip is soft enough to dip under the bar. */
export function resolveChip(keeperDist: number, power: number, aimX: number): SimpleOutcome {
  if (Math.abs(aimX) > GOAL_HALF + 0.3) return { success: false, quality: 0.12, reason: 'wide' };
  if (power > 0.8) return { success: false, quality: 0.18, reason: 'over' };
  if (keeperDist > 10) return { success: false, quality: 0.25, reason: 'keeper_home' };
  if (keeperDist < 1.8) return { success: false, quality: 0.2, reason: 'smothered' };
  if (power < 0.18) return { success: false, quality: 0.2, reason: 'short' };
  const sweet = 1 - Math.abs(power - 0.48) / 0.32; // 0.48 = ideal lob weight
  const near = clamp01((10 - keeperDist) / 6);
  if (sweet < 0.05) return { success: false, quality: 0.3, reason: 'saved' };
  return { success: true, quality: clamp01(0.55 + 0.25 * sweet + 0.2 * near), reason: 'chip' };
}

/**
 * Pass delivery (through_ball / cross): who gets to the ball first along `frames`?
 * receivers / defenders run toward the ball after their reaction time with limited speed and reach.
 */
export interface Runner { id: string; x: number; z: number; vx: number; vz: number; speed: number; reach: number; react: number; maxRun: number; /** max contact height */ headH: number }
export interface DeliveryOutcome { winner: string | null; t: number; at: BallFrame | null; byTeam: 'mate' | 'opp' | null }

export function runnerPosAt(r: Runner, t: number): { x: number; z: number } {
  return { x: r.x + r.vx * t, z: r.z + r.vz * t };
}

export function resolveDelivery(frames: BallFrame[], mates: Runner[], opps: Runner[]): DeliveryOutcome {
  for (const f of frames) {
    if (f.t < 0.12) continue;
    for (const [team, list] of [['opp', opps], ['mate', mates]] as const) {
      for (const r of list) {
        if (f.h > r.headH) continue;
        const base = runnerPosAt(r, f.t);
        const d = Math.hypot(f.x - base.x, f.z - base.z);
        const extra = Math.min(r.maxRun, r.speed * Math.max(0, f.t - r.react));
        if (d <= r.reach + extra) return { winner: r.id, t: f.t, at: f, byTeam: team };
      }
    }
  }
  return { winner: null, t: frames[frames.length - 1].t, at: null, byTeam: null };
}

// ------------------------------------------------------------------ no input

/** A weak, fail-ish attempt when the player never acted. */
export function noInputResult(kind: MomentKind): SimpleOutcome {
  switch (kind) {
    case 'save': case 'rush_out': case 'block': case 'tackle': case 'interception': case 'clearance':
      return { success: false, quality: 0.08, reason: 'frozen' };
    default:
      return { success: false, quality: 0.1, reason: 'hesitated' };
  }
}

/** Hebrew headline for the end banner. */
export function resultText(kind: MomentKind, success: boolean, reason: string): string {
  if (reason === 'foul') return 'עבירה!';
  if (reason === 'skipped') return '';
  switch (kind) {
    case 'shot': case 'long_shot': case 'free_kick': case 'header': case 'one_on_one':
      if (success) return 'גול!';
      if (reason === 'saved') return 'הצלה של השוער';
      if (reason === 'post') return 'קורה!';
      if (reason === 'blocked') return 'נחסם';
      return 'החטאה';
    case 'penalty':
      if (reason === 'keeper_save') return 'הצלה!';
      if (reason === 'keeper_goal') return 'גול ליריבה';
      if (success) return 'גול!';
      return reason === 'saved' ? 'הצלה של השוער' : 'החטאה';
    case 'save': return success ? 'הצלה!' : 'גול ליריבה';
    case 'rush_out': return success ? 'יציאה מושלמת!' : 'עבר אותך';
    case 'interception': return success ? 'חטיפה!' : 'פספוס';
    case 'tackle': return success ? 'תיקול נקי!' : 'עבר אותך';
    case 'block': return success ? 'חסימה!' : 'לא הגעת';
    case 'clearance': return success ? 'הרחקה!' : reason === 'own_goal_danger' ? 'כמעט שער עצמי' : 'הכדור נשאר ברחבה';
    case 'dribble': return success ? 'עבר אותו!' : 'איבד את הכדור';
    case 'through_ball': return success ? 'מסירת זהב!' : 'נחטף';
    case 'cross': return success ? 'הגבהה מדויקת!' : 'ההגנה הרחיקה';
    default: return success ? 'הצליח!' : 'לא הלך';
  }
}
