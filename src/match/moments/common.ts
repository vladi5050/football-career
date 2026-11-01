// Shared types and helpers for the per-kind moment scripts.
import type { MomentSpec } from '../../core/types';
import { frameCam, type Cam } from '../camera';
import type { Hud } from '../hud';
import type { Actor, Hint, Scene } from '../scene';
import type { Gesture, SwipeGesture } from '../swipe';
import { clamp, clamp01, lerp, sampleFrames, reactionTime, windowHalfMs, type BallFrame, type Rng, type ShotOutcome } from '../sim';
import type { Tuning } from '../tuning';

export interface MomentCtx {
  s: Scene;
  spec: MomentSpec;
  t: Tuning;
  rng: Rng;
  hud: Hud;
  /** tap window half-width (ms) for this spec incl. difficulty / skill / context */
  half: number;
  /** opponent reaction time (s) */
  react: number;
  /** keeper reach multiplier from difficulty / rival */
  reachMul: number;
  /** keeper (true) or taker for penalties */
  asKeeper: boolean;
  /** actor that gets the rival name tag */
  rivalActor: Actor | null;
  reducedMotion: boolean;
}

export interface Resolution {
  success: boolean;
  quality: number;
  reason: string;
  text?: string;
  sub?: string;
  goal?: boolean;
  /** advance the outcome animation; rt = seconds since resolution start (sim time). true = finished */
  play: (dt: number, rt: number) => boolean;
  /** rt of the decisive frame (slow motion kicks in around it) */
  slowmoAt?: number;
}

export interface MomentScript {
  title: string;
  sub?: string;
  input: 'swipe' | 'tap' | 'both';
  /** seconds the input stays open */
  timeLimit: number;
  hint: () => Hint | null;
  /** intro tick (camera is easing in; no input yet) */
  intro?: (dt: number) => void;
  /** action tick; at = seconds since action start. May return a resolution (e.g. after a locked input). */
  tick: (dt: number, at: number) => Resolution | void;
  /** react to a gesture. Resolution = done; 'lock' = accepted, the script resolves later in tick; null = ignored */
  gesture: (g: Gesture, at: number) => Resolution | 'lock' | null;
  timeout: (at: number) => Resolution;
}

export type ScriptFactory = (c: MomentCtx) => MomentScript;

export function buildCtx(base: Omit<MomentCtx, 'half' | 'react' | 'reachMul' | 'rivalActor'>): MomentCtx {
  const { spec, t } = base;
  const rival = spec.context.rivalInvolved;
  return {
    ...base,
    half: windowHalfMs(spec, t),
    react: reactionTime(spec.difficulty, t) * (rival ? 0.9 : 1),
    reachMul: lerp(0.85, 1.18, clamp01(spec.difficulty)) * (rival ? 1.06 : 1),
    rivalActor: null,
  };
}

// ------------------------------------------------------------------ cameras

/** Attacking broadcast view: goal at the top, action near the bottom. wide 0..1 pulls back. */
export function attackCam(c: MomentCtx, x: number, z: number, wide = 0): Cam {
  return frameCam(c.s.screen, {
    x: x * 0.6, zFar: -1.5, yFar: 0.24 - wide * 0.04, zNear: z + 1.2, yNear: 0.75 + wide * 0.02,
    back: 15 + wide * 14 + z * 0.1, camH: 11 + wide * 16, dir: -1,
  });
}

/** Intro framing: higher and wider, then attackCam eases in. */
export function introCam(cam: Cam): Cam {
  return { ...cam, h: cam.h * 1.35, f: cam.f * 0.82, hy: cam.hy - 30 };
}

/**
 * Defending view from behind our own goal (dir +1): ground z=near lands at yNear, z=far at yFar.
 * Keeper moments use a tight, low camera so the goal fills the width; outfield ones frame the duel.
 */
export function defendCam(c: MomentCtx, o: { far: number; near: number; x?: number; yFar?: number; yNear?: number; back?: number; camH?: number }): Cam {
  return frameCam(c.s.screen, {
    x: (o.x ?? 0) * 0.5, zFar: o.far, yFar: o.yFar ?? 0.3, zNear: o.near, yNear: o.yNear ?? 0.84,
    back: o.back ?? 12, camH: o.camH ?? 12, dir: 1,
  });
}

/** Keeper view: goal ~ full width at the bottom, shooter near the top third. */
export function keeperCam(c: MomentCtx, shooterZ: number, x = 0): Cam {
  return defendCam(c, { far: shooterZ, near: 0, x: x * 0.3, yFar: 0.3, yNear: 0.86, back: 12, camH: 18 });
}

// ------------------------------------------------------------------ gesture helpers

export function isSwipe(g: Gesture): g is SwipeGesture { return g.type === 'swipe'; }

/**
 * Shot aim from a swipe in the attacking view: the swipe direction is cast from the ball's screen
 * position to the goal line (=> lateral target); swipe length vs distance to goal + power => height.
 */
export function aimShot(c: MomentCtx, g: SwipeGesture, ball: { x: number; z: number }): { x: number; h: number; curl: number } {
  const s = c.s;
  const bp = s.p(ball.x, ball.z, 0);
  const gl = s.p(0, 0, 0).sy;
  const curl = g.curl ? -Math.sign(g.curve) * clamp(Math.abs(g.curve) / 0.3, 0.45, 1) : 0;
  if (g.dirY > -0.08) return { x: ball.x + Math.sign(g.dirX || 1) * 14, h: 0.3, curl };
  const dist = Math.max(40, bp.sy - gl);
  const u = (gl - bp.sy) / g.dirY;
  const sx = bp.sx + g.dirX * u;
  const w = s.ground2world(sx, gl + 0.5);
  const x = w ? w.x : ball.x;
  const reach = g.length / dist;
  const h = clamp(0.12 + 1.35 * reach + (g.power - 0.5) * 1.7, 0, 4.5);
  return { x, h, curl };
}

/** Swipe direction mapped to world ground direction (via unprojecting both ends). */
export function swipeWorldDir(c: MomentCtx, g: SwipeGesture): { x: number; z: number } {
  const a = c.s.ground2world(g.start.x, g.start.y);
  const b = c.s.ground2world(g.end.x, g.end.y);
  if (a && b && Math.hypot(b.x - a.x, b.z - a.z) > 0.2) {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }
  const dir = c.s.cam.dir;
  // fallback: screen right = +x for dir -1 (mirrored for dir +1); screen up = away from camera
  return { x: g.dirX * -dir, z: g.dirY * -dir };
}

// ------------------------------------------------------------------ animation helpers

export function placeBall(c: MomentCtx, f: { x: number; z: number; h: number }, dt: number): void {
  const b = c.s.ball;
  const sp = Math.hypot(f.x - b.x, f.z - b.z) / Math.max(1e-3, dt);
  b.rot += Math.min(40, sp) * dt * 0.9;
  b.x = f.x; b.z = f.z; b.h = f.h;
}

/** Keep the ball at a dribbler's feet (slightly ahead toward `dirZ`). */
export function ballAtFeet(c: MomentCtx, a: Actor, dirZ: number, dt: number, ahead = 0.55): void {
  const touch = 0.25 + 0.3 * Math.abs(Math.sin(a.phase * 0.5));
  placeBall(c, { x: a.x + 0.15, z: a.z + dirZ * (ahead + (a.moving > 0.2 ? touch : 0)), h: 0 }, dt);
}

export function grassKick(c: MomentCtx, x: number, z: number, n = 10): void {
  const q = c.s.p(x, z, 0);
  c.s.burst(q.sx, q.sy, n, [0x3fa34d, 0x2c7a37, 0x8bd17c, 0xe8f5e0], 160, { size: 2.6, g: 500, life: 0.6, up: 120 });
}

export function sparks(c: MomentCtx, x: number, z: number, h: number, n = 16, colors = [0xffffff, 0xfff2a0, 0xffd84a]): void {
  const q = c.s.p(x, z, h);
  c.s.burst(q.sx, q.sy, n, colors, 340, { size: 2.6, g: 300, life: 0.6, kind: 'streak' });
}

/**
 * Standard shot playback: ball along outcome frames, keeper dive, net ripple + celebration on goal,
 * sparks on saves, clang on the woodwork.
 */
export function playShot(c: MomentCtx, out: ShotOutcome, shooter: Actor | null, keeper: Actor | null, extra?: (rt: number, dt: number) => void): Resolution['play'] {
  const s = c.s;
  let contact = false;
  let kicked = false;
  let dove = false;
  const last = out.frames[out.frames.length - 1].t;
  return (dt, rt) => {
    if (!kicked) {
      kicked = true;
      if (shooter) s.setPose(shooter, 'kick');
      grassKick(c, out.frames[0].x, out.frames[0].z, 12);
      s.shake(3);
    }
    placeBall(c, sampleFrames(out.frames, rt), dt);
    if (keeper && !dove) {
      const kd = out.keeper;
      const cross = out.crossing;
      const start = kd ? kd.diveStart : c.react + 0.05;
      if (rt >= start && cross) {
        dove = true;
        const tx = clamp(kd ? kd.diveX : clamp(cross.x, keeper.x - 2.5, keeper.x + 2.5), -3.2, 3.2);
        if (Math.abs(tx - keeper.x) > 0.6 || (kd && kd.diveH > 1.6)) {
          s.setPose(keeper, 'dive', tx);
          s.moveTo(keeper, tx, keeper.z, 7);
        } else {
          s.setPose(keeper, 'jump');
          s.moveTo(keeper, tx, keeper.z, 4);
        }
      }
    }
    if (keeper && dove) {
      const lift = keeper.pose === 'dive' ? Math.min(0.9, (out.keeper?.diveH ?? 0.6) * 0.45) : 0.3;
      const u = clamp01((rt - (out.keeper?.diveStart ?? 0)) / 0.5);
      keeper.h = lift * Math.sin(Math.PI * Math.min(1, u * 0.9));
    }
    if (!contact && rt >= out.tContact) {
      contact = true;
      const cr = out.crossing;
      if (out.result === 'goal' && cr) {
        s.netHit(cr.x, cr.h, 1.2);
        s.flash(0.45);
        s.shake(9);
        s.crowdRoar();
        s.confetti();
        if (shooter) { s.setPose(shooter, 'celebrate'); s.moveTo(shooter, shooter.x + 2, shooter.z + 2, 3); }
      } else if (out.result === 'saved' && cr) {
        sparks(c, cr.x, 0.3, cr.h, 18);
        s.shake(5);
      } else if (out.result === 'post' && cr) {
        sparks(c, cr.x, 0, cr.h, 22, [0xffffff, 0xd8e4f0]);
        s.shake(7);
      } else if (out.result === 'blocked') {
        const f = sampleFrames(out.frames, out.tContact);
        sparks(c, f.x, f.z, f.h, 12, [0xffffff]);
        s.shake(4);
      }
    }
    extra?.(rt, dt);
    return rt > Math.max(last, out.tContact) + 0.55;
  };
}

/** Simple frames-only playback. */
export function playFrames(c: MomentCtx, frames: BallFrame[], dur: number, extra?: (rt: number, dt: number) => void): Resolution['play'] {
  return (dt, rt) => {
    placeBall(c, sampleFrames(frames, rt), dt);
    extra?.(rt, dt);
    return rt >= dur;
  };
}

/** Timing feedback popup. */
export function gradeLabel(c: MomentCtx, grade: string): void {
  const map: Record<string, [string, string]> = {
    perfect: ['מושלם!', '#4dff88'], good: ['טוב', '#ffe14d'], early: ['מוקדם מדי', '#ff8a4d'], late: ['מאוחר מדי', '#ff8a4d'],
    foul: ['מוקדם מדי', '#ff4d4d'], beaten: ['מאוחר מדי', '#ff8a4d'], wrong_side: ['הצד הלא נכון', '#ff8a4d'], wrong_way: ['לכיוון הלא נכון', '#ff8a4d'],
  };
  const m = map[grade];
  if (m) c.hud.showGrade(m[0], m[1]);
}

/** Small random helpers */
export const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];
export const sideOf = (rng: Rng): -1 | 1 => (rng() < 0.5 ? -1 : 1);
export const range = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
