// Finishing moments: shot, long_shot, free_kick, penalty (taker + keeper), one_on_one, header.
import {
  BAR, GOAL_HALF, clamp, clamp01, envFor, fly, frameOnTarget, gradeTiming, launchToward, lerp, resolveChip, resolveDive,
  resolveShot, sampleFrames, timingQuality, windowHalfMs, type BallFrame, type Obstacle,
} from '../sim';
import type { Actor } from '../scene';
import {
  aimShot, attackCam, ballAtFeet, keeperCam, grassKick, gradeLabel, introCam, isSwipe, placeBall, playShot, range, sideOf, sparks,
  type MomentCtx, type MomentScript, type Resolution, type ScriptFactory,
} from './common';

function keeperFor(c: MomentCtx, x: number, z = 0.6): Actor {
  const k = c.s.addActor({ id: 'gk', team: 'opp', gk: true, x, z });
  if (c.spec.context.rivalInvolved) { k.mark = 'rival'; c.rivalActor = k; }
  return k;
}

/** keeper idles: shuffles to stay between ball and goal centre */
function keeperShuffle(c: MomentCtx, k: Actor, ballX: number, ballZ: number, at: number): void {
  const ang = Math.atan2(ballX, ballZ);
  const off = clamp(Math.sin(ang) * 1.6, -1.8, 1.8);
  c.s.moveTo(k, off + Math.sin(at * 3) * 0.15, k.z, 2.2);
}

// ------------------------------------------------------------------ shot & long shot

function makeShot(c: MomentCtx, long: boolean): MomentScript {
  const { s, rng, spec } = c;
  const side = sideOf(rng);
  const bx = long ? range(rng, -8, 8) : range(rng, -7, 7);
  const bz = long ? range(rng, 24, 30) : range(rng, 14, 20);
  s.ball.x = bx; s.ball.z = bz;
  const user = s.addActor({ id: 'user', team: 'user', x: bx - 0.35, z: bz + 0.7, mark: 'user' });
  const keeper = keeperFor(c, bx * 0.15, long ? 1.6 : 0.7);
  const presser = s.addActor({ id: 'd1', team: 'opp', x: bx + side * 6, z: bz - 3 });
  const blockers: Actor[] = [];
  const walls: Obstacle[] = [];
  const nB = long ? 3 : 1;
  for (let i = 0; i < nB; i++) {
    const zz = long ? range(rng, 12, bz - 6) : range(rng, 6, 10);
    const xx = bx * (zz / bz) + range(rng, -3.5, 3.5);
    blockers.push(s.addActor({ id: 'b' + i, team: 'opp', x: xx, z: zz }));
    walls.push({ x0: xx - 0.35, x1: xx + 0.35, z: zz, height: 1.85 });
  }
  s.addActor({ id: 'mate', team: 'mate', x: bx - side * range(rng, 6, 10), z: bz - range(rng, 4, 8) });
  if (long) s.addActor({ id: 'mate2', team: 'mate', x: bx + side * 9, z: bz - 12 });
  const cam = attackCam(c, bx, bz, long ? 0.6 : 0);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  const limit = (long ? 3.0 : 3.3) - spec.difficulty * 0.6;
  let res: Resolution | null = null;

  return {
    title: long ? 'בעיטה מרחוק!' : 'החלק לכיוון השער',
    sub: long ? 'החלקה מהירה = בעיטה חזקה' : 'קשת באצבע = כדור מסובב',
    input: 'swipe',
    timeLimit: limit,
    hint: () => {
      const b = s.p(bx, bz, 0);
      const gp = s.p(-side * 2.5, 0, 1.2);
      return { kind: 'swipe', x0: b.sx, y0: b.sy - 10, x1: lerp(b.sx, gp.sx, 0.6), y1: lerp(b.sy, gp.sy, 0.6), bend: 0, alpha: 0.9 };
    },
    tick: (dt, at) => {
      keeperShuffle(c, keeper, bx, bz, at);
      s.moveTo(presser, bx + side * 0.9, bz - 0.4, 6.4 / limit * 1.0);
      user.lean = Math.sin(at * 2.2) * 0.2;
      void dt;
    },
    gesture: (g) => {
      if (!isSwipe(g) || res) return null;
      const aim = aimShot(c, g, { x: bx, z: bz });
      const out = resolveShot(
        { from: { x: bx, z: bz, h: 0.11 }, target: { x: aim.x, h: aim.h }, power: g.power, curl: aim.curl, skill: spec.attackerSkill },
        { keeperX: keeper.x, react: c.react, reachMul: c.reachMul * (long ? 1.05 : 1), rain: spec.context.rain, walls },
        c.t, c.rng,
      );
      for (const b of blockers) { const p = sampleFrames(out.frames, 0.25); s.moveTo(b, p.x, b.z, 3); }
      s.moveTo(user, bx + 0.3, bz - 0.4, 3);
      res = {
        success: out.success, quality: out.quality, reason: out.result, goal: out.result === 'goal',
        play: playShot(c, out, user, keeper), slowmoAt: out.tContact,
      };
      return res;
    },
    timeout: () => {
      // the presser gets there first: blocked tame effort
      s.setPose(presser, 'slide', bx);
      const env = envFor(c.t, spec.context.rain);
      const fr = fly({ x: bx, z: bz, h: 0.05, vx: side * 4, vz: 3, vh: 2, spin: 0 }, env, (_b, tt) => tt > 1.2, 1.2).frames;
      return {
        success: false, quality: 0.08, reason: 'blocked', sub: 'חיכית יותר מדי',
        play: (dt, rt) => { placeBall(c, sampleFrames(fr, rt), dt); if (rt > 0.1) s.setPose(user, 'down'); return rt > 1.3; },
      };
    },
  };
}

export const shot: ScriptFactory = (c) => makeShot(c, false);
export const long_shot: ScriptFactory = (c) => makeShot(c, true);

// ------------------------------------------------------------------ free kick

export const free_kick: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const bx = range(rng, -8, 8);
  const bz = range(rng, 18, 25);
  s.ball.x = bx; s.ball.z = bz;
  const user = s.addActor({ id: 'user', team: 'user', x: bx - 0.9, z: bz + 1.6, mark: 'user' });
  // wall 9.15m toward the near-post side
  const aimX = Math.sign(bx || 1) * 1.6;
  const dx = aimX - bx; const dz = -bz;
  const d = Math.hypot(dx, dz);
  const wx = bx + (dx / d) * 9.15; const wz = bz + (dz / d) * 9.15;
  const n = Math.abs(bx) > 6 ? 4 : 5;
  const wallActors: Actor[] = [];
  for (let i = 0; i < n; i++) {
    const ox = (i - (n - 1) / 2) * 0.62;
    wallActors.push(s.addActor({ id: 'w' + i, team: 'opp', x: wx + ox, z: wz }));
  }
  const wall: Obstacle = { x0: wx - (n / 2) * 0.62 - 0.1, x1: wx + (n / 2) * 0.62 + 0.1, z: wz, height: 2.15 };
  const keeper = keeperFor(c, -Math.sign(bx || 1) * 0.9, 0.6);
  s.addActor({ id: 'm1', team: 'mate', x: -Math.sign(bx || 1) * 6, z: 9 });
  s.addActor({ id: 'd2', team: 'opp', x: -Math.sign(bx || 1) * 5, z: 8 });
  s.addActor({ id: 'm2', team: 'mate', x: 2, z: 13 });
  s.addActor({ id: 'd3', team: 'opp', x: 1, z: 12 });
  s.wall = { x0: wall.x0, x1: wall.x1, z: wz };
  const cam = attackCam(c, bx, bz, 0.25);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  return {
    title: 'בעיטה חופשית',
    sub: 'החלק בקשת כדי לסובב מעל החומה',
    input: 'swipe',
    timeLimit: 4.5,
    hint: () => {
      const b = s.p(bx, bz, 0);
      const gp = s.p(-Math.sign(bx || 1) * 2.8, 0, 2);
      return { kind: 'swipe', x0: b.sx, y0: b.sy - 10, x1: lerp(b.sx, gp.sx, 0.65), y1: lerp(b.sy, gp.sy, 0.65), bend: 40 * Math.sign(bx || 1), alpha: 0.9 };
    },
    tick: (_dt, at) => {
      for (const w of wallActors) w.lean = Math.sin(at * 3 + w.x) * 0.1;
      keeperShuffle(c, keeper, -bx * 0.4, bz, at);
    },
    gesture: (g) => {
      if (!isSwipe(g) || res) return null;
      const aim = aimShot(c, g, { x: bx, z: bz });
      const out = resolveShot(
        { from: { x: bx, z: bz, h: 0.11 }, target: { x: aim.x, h: aim.h + 0.2 }, power: g.power * 0.9, curl: aim.curl, skill: spec.attackerSkill },
        { keeperX: keeper.x, react: c.react + 0.08, reachMul: c.reachMul, rain: spec.context.rain, walls: [wall] },
        c.t, c.rng,
      );
      s.moveTo(user, bx - 0.2, bz + 0.2, 4);
      const kick = playShot(c, out, user, keeper, (rt) => {
        // the wall jumps
        for (const w of wallActors) w.h = rt > 0.05 && rt < 0.6 ? Math.sin(((rt - 0.05) / 0.55) * Math.PI) * 0.45 : 0;
        if (rt > 0.05) for (const w of wallActors) c.s.setPose(w, 'jump');
      });
      res = { success: out.success, quality: out.quality, reason: out.result, goal: out.success, play: kick, slowmoAt: out.tContact };
      return res;
    },
    timeout: () => {
      const out = resolveShot(
        { from: { x: bx, z: bz, h: 0.11 }, target: { x: wx, h: 1.0 }, power: 0.4, curl: 0, skill: spec.attackerSkill },
        { keeperX: keeper.x, react: c.react, reachMul: c.reachMul, rain: spec.context.rain, walls: [wall] }, c.t, c.rng,
      );
      return { success: false, quality: 0.08, reason: out.result === 'goal' ? 'saved' : out.result, sub: 'בעיטה חלשה לחומה', play: playShot(c, { ...out, success: false }, user, keeper), slowmoAt: undefined };
    },
  };
};

// ------------------------------------------------------------------ penalty

export const penalty: ScriptFactory = (c) => (c.asKeeper ? penaltyKeeper(c) : penaltyTaker(c));

function penaltyTaker(c: MomentCtx): MomentScript {
  const { s, rng, spec } = c;
  s.ball.x = 0; s.ball.z = 11;
  const user = s.addActor({ id: 'user', team: 'user', x: -0.9, z: 12.4, mark: 'user' });
  const keeper = keeperFor(c, 0, 0.3);
  for (let i = 0; i < 4; i++) s.addActor({ id: 'r' + i, team: i % 2 ? 'opp' : 'mate', x: -10 + i * 6.5 + range(rng, -1, 1), z: 19 + range(rng, 0, 2) });
  const cam = attackCam(c, 0, 11.5, 0.05);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  return {
    title: 'פנדל',
    sub: 'החלק לפינה. חזק מדי = מעל המשקוף',
    input: 'swipe',
    timeLimit: 4.2,
    hint: () => {
      const b = s.p(0, 11, 0); const gp = s.p(2.6, 0, 1);
      return { kind: 'swipe', x0: b.sx, y0: b.sy - 8, x1: lerp(b.sx, gp.sx, 0.7), y1: lerp(b.sy, gp.sy, 0.7), bend: 0, alpha: 0.9 };
    },
    tick: (_dt, at) => {
      keeper.lean = Math.sin(at * 5) * 0.5;
      c.s.moveTo(keeper, Math.sin(at * 2.4) * 0.35, 0.3, 1.5);
    },
    gesture: (g) => {
      if (!isSwipe(g) || res) return null;
      const aim = aimShot(c, g, { x: 0, z: 11 });
      // the keeper guesses: harder spec => reads the side more often
      const readsIt = rng() < 0.22 + 0.3 * spec.difficulty;
      const aimSide = Math.abs(aim.x) > 0.9 ? (Math.sign(aim.x) as -1 | 1) : 0;
      const guess: -1 | 0 | 1 = readsIt ? aimSide : rng() < 0.15 ? 0 : (sideOf(rng));
      const out = resolveShot(
        { from: { x: 0, z: 11, h: 0.11 }, target: { x: aim.x, h: aim.h }, power: g.power, curl: aim.curl * 0.5, skill: spec.attackerSkill },
        { keeperX: 0, react: 0.05, reachMul: c.reachMul, rain: spec.context.rain, keeperGuess: guess }, c.t, c.rng,
      );
      // dive direction visual follows the guess
      const kd = out.keeper ?? null;
      const diveX = guess ? guess * 2.6 : 0;
      const shown = kd ? { ...kd, diveX: guess ? (kd.saved ? kd.diveX : diveX) : kd.diveX, diveStart: 0.04 } : { saved: false, margin: 1, reach: 0, needed: 0, diveX, diveH: 0.8, diveStart: 0.04 };
      s.moveTo(user, -0.25, 11.4, 5);
      res = {
        success: out.success, quality: out.quality, reason: out.result, goal: out.success,
        play: playShot(c, { ...out, keeper: shown }, user, keeper), slowmoAt: out.tContact,
      };
      return res;
    },
    timeout: () => {
      const out = resolveShot(
        { from: { x: 0, z: 11, h: 0.11 }, target: { x: 0.3, h: 0.5 }, power: 0.25, curl: 0, skill: spec.attackerSkill },
        { keeperX: 0, react: 0.1, reachMul: c.reachMul, rain: spec.context.rain, keeperGuess: 0 }, c.t, c.rng,
      );
      return { success: false, quality: 0.05, reason: 'saved', sub: 'בעיטה חלשה באמצע', play: playShot(c, { ...out, success: false }, user, keeper), slowmoAt: out.tContact };
    },
  };
}

/** Keeper-side dive mapping: swipe screen direction -> dive point in the goal plane (dir +1 view mirrors x). */
export function diveTarget(dirX: number, dirY: number, keeperX: number, power: number): { x: number; h: number } {
  const mirror = -1; // defend camera: screen right = world -x
  const x = clamp(keeperX + mirror * dirX * (2.4 + power * 1.4), -GOAL_HALF - 0.4, GOAL_HALF + 0.4);
  const h = clamp(0.35 + Math.max(0, -dirY) * 2.1, 0.2, BAR + 0.1);
  return { x, h };
}

function penaltyKeeper(c: MomentCtx): MomentScript {
  const { s, rng, spec } = c;
  s.ball.x = 0; s.ball.z = 11;
  const user = s.addActor({ id: 'user', team: 'user', gk: true, x: 0, z: 0.3, mark: 'user' });
  const taker = s.addActor({ id: 'taker', team: 'opp', x: 1.6, z: 14.5 });
  if (spec.context.rivalInvolved) { taker.mark = 'rival'; c.rivalActor = taker; }
  for (let i = 0; i < 4; i++) s.addActor({ id: 'r' + i, team: i % 2 ? 'opp' : 'mate', x: -10 + i * 6.5, z: 19 + range(rng, 0, 2) });
  const cam = keeperCam(c, 13);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  const strikeAt = range(rng, 1.4, 1.9);
  let tx = sideOf(rng) * range(rng, 1.4, 3.2 + spec.difficulty * 0.2);
  const th = range(rng, 0.2, 1.2 + spec.difficulty * 1.0);
  const speed = lerp(19, 27, spec.difficulty);
  const env = envFor(c.t, spec.context.rain);
  let frames: BallFrame[] | null = null;
  let arrive = 0;
  let dive: { x: number; h: number; at: number } | null = null;
  let switched = false;
  const build = () => {
    const b = launchToward({ x: 0, z: 11, h: 0.11 }, { x: tx, z: 0, h: th }, speed, 0, env);
    frames = fly(b, env, (bb) => bb.z < 0.2, 1.5).frames;
    arrive = strikeAt + frames[frames.length - 1].t;
  };
  build();
  let res: Resolution | null = null;
  return {
    title: 'פנדל נגדך',
    sub: 'החלק לכיוון שבו הכדור נכנס',
    input: 'swipe',
    timeLimit: strikeAt + 1.2,
    hint: () => {
      const k = s.p(0, 0.3, 1);
      return { kind: 'swipe', x0: k.sx, y0: k.sy, x1: k.sx + 90, y1: k.sy - 40, bend: 0, alpha: 0.85 };
    },
    tick: (dt, at) => {
      user.lean = Math.sin(at * 6) * 0.4;
      if (at < strikeAt) {
        const u = clamp01((at - 0.2) / (strikeAt - 0.2));
        s.moveTo(taker, lerp(1.6, 0.5, u), lerp(14.5, 11.6, u), 4.5);
        placeBall(c, { x: 0, z: 11, h: 0 }, dt);
      } else if (frames) {
        if (taker.pose !== 'kick') { s.setPose(taker, 'kick'); grassKick(c, 0, 11); }
        placeBall(c, sampleFrames(frames, at - strikeAt), dt);
      }
      if (dive && at >= arrive - 0.02 && !res) {
        const out = resolveDive({ x: dive.x, h: dive.h }, { x: tx, h: th }, arrive - dive.at, c.t, 1 / c.reachMul + 0.1);
        const success = out.success;
        res = makeKeeperRes(c, success, out.quality, success ? 'keeper_save' : 'keeper_goal', frames!, arrive - strikeAt, tx, th, user, strikeAt, at);
        return res;
      }
    },
    gesture: (g, at) => {
      if (dive || res) return null;
      const dx = g.type === 'swipe' ? g.dirX : 0;
      const dy = g.type === 'swipe' ? g.dirY : -0.3;
      const p = g.type === 'swipe' ? g.power : 0.2;
      const d = diveTarget(dx, dy, 0, p);
      dive = { ...d, at };
      // diving way before the kick lets the taker change his mind
      if (at < strikeAt - 0.3 && !switched && rng() < 0.4 + 0.4 * spec.difficulty && Math.sign(d.x) === Math.sign(tx)) {
        switched = true; tx = -tx; build();
      }
      if (Math.abs(d.x) > 0.5 || d.h > 1.5) { s.setPose(user, 'dive', d.x); s.moveTo(user, d.x * 0.85, 0.3, 6); }
      else s.setPose(user, 'jump');
      return 'lock';
    },
    timeout: (at) => {
      const out = frameOnTarget(tx, th);
      const saved = out !== 'in';
      return makeKeeperRes(c, saved, saved ? 0.4 : 0.06, saved ? 'keeper_save' : 'keeper_goal', frames!, arrive - strikeAt, tx, th, user, strikeAt, at);
    },
  };
}

/** Resolution for keeper-type moments (save / penalty as keeper). Continues the ball from `at`. */
export function makeKeeperRes(
  c: MomentCtx, saved: boolean, quality: number, reason: string, frames: BallFrame[], flight: number,
  tx: number, th: number, keeper: Actor, strikeAt: number, at: number,
): Resolution {
  const s = c.s;
  const env = envFor(c.t, c.spec.context.rain);
  const t0 = at - strikeAt; // seconds into the flight when the resolution starts
  const parry = saved && frameOnTarget(tx, th) === 'in'
    ? fly({ x: tx, z: 0.5, h: th, vx: Math.sign(tx || 1) * 4, vz: 5, vh: 2.5, spin: 0 }, env, (_b, tt) => tt > 1.2, 1.2).frames
    : null;
  const tail = !parry ? fly(launchToward({ x: tx, z: 0.2, h: th }, { x: tx * 1.05, z: -1.7, h: Math.max(0.2, th - 0.3) }, 14, 0, env), env, (b) => b.z < -1.6, 0.6).frames : null;
  let hit = false;
  const goal = !saved && frameOnTarget(tx, th) === 'in';
  return {
    success: saved, quality, reason, goal: false,
    slowmoAt: Math.max(0, flight - t0),
    play: (dt, rt) => {
      const ft = t0 + rt;
      if (ft < flight) placeBall(c, sampleFrames(frames, ft), dt);
      else {
        if (!hit) {
          hit = true;
          if (parry) { sparks(c, tx, 0.4, th, 20); s.shake(6); s.crowdRoar(); }
          else if (goal) { s.netHit(tx, th, 1.1); s.shake(6); }
        }
        const lt = ft - flight;
        if (parry) placeBall(c, sampleFrames(parry, lt), dt);
        else if (tail) placeBall(c, sampleFrames(tail, lt), dt);
      }
      if (keeper.pose === 'dive') keeper.h = 0.5 * Math.sin(Math.min(Math.PI, keeper.poseT * 4));
      return rt > Math.max(0.2, flight - t0) + 1.0;
    },
  };
}

// ------------------------------------------------------------------ one on one

export const one_on_one: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const x0 = range(rng, -6, 6);
  const z0 = range(rng, 24, 27);
  const user = s.addActor({ id: 'user', team: 'user', x: x0, z: z0, mark: 'user' });
  const keeper = keeperFor(c, 0, 0.8);
  const chaser = s.addActor({ id: 'chaser', team: 'opp', x: x0 + sideOf(rng) * 2.5, z: z0 + 4 });
  const runSpeed = 6.4;
  const kSpeed = 3.6 + spec.difficulty * 0.8;
  const cam = attackCam(c, x0 * 0.6, z0 - 1, 0.1);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  const IDEAL = 5.0;
  const closing = runSpeed + kSpeed;
  const ring = { x: 0, z: 0.8, r0: 3.2, r1: 1.1, t0: 0, dur: 1, color: 0xffffff, hot: false, kind: 'pulse' as const };
  s.rings.push(ring);
  const gap = () => Math.hypot(user.x - keeper.x, user.z - keeper.z);
  return {
    title: 'אחד על אחד',
    sub: 'הקש כשהעיגול ירוק כדי לעקוף · החלק למעלה לצ\'יפ',
    input: 'both',
    timeLimit: 3.2,
    hint: () => { const k = s.p(keeper.x, keeper.z, 0); return { kind: 'tap', x0: k.sx, y0: k.sy - 30, x1: 0, y1: 0, bend: 0, alpha: 0.8 }; },
    tick: (dt, at) => {
      const tz = 0.5; const dz = user.z - tz;
      const dirx = -user.x / Math.max(1, dz);
      s.moveTo(user, user.x + dirx * runSpeed * dt * 2, user.z - runSpeed * dt * 2, runSpeed);
      ballAtFeet(c, user, -1, dt, 0.7);
      if (at > 0.35) s.moveTo(keeper, lerp(keeper.x, user.x, 0.3), Math.min(user.z - 1, keeper.z + kSpeed * dt * 2), kSpeed);
      s.moveTo(chaser, user.x + 1.2, user.z + 1.4, runSpeed * 0.92);
      ring.x = keeper.x; ring.z = keeper.z;
      s.followCam = attackCam(c, user.x * 0.6, Math.max(9, user.z - 1), 0.1);
      const gp = gap();
      ring.hot = Math.abs(gp - IDEAL) < (c.half / 1000) * closing;
      if (gp < 1.3 && !res) {
        res = smother();
        return res;
      }
    },
    gesture: (g) => {
      if (res) return null;
      const gp = gap();
      const ux = user.x; const uz = user.z;
      if (g.type === 'tap') {
        const errMs = -((gp - IDEAL) / closing) * 1000;
        const grade = gradeTiming(errMs, c.half);
        gradeLabel(c, grade.grade);
        if (!grade.hit) { res = grade.grade === 'early' ? keeperReads() : smother(); return res; }
        // round the keeper and finish into the empty net
        const side = keeper.x > ux ? -1 : 1;
        const env = envFor(c.t, spec.context.rain);
        const rx = ux + side * 2.6; const rz = uz - 2.2;
        const touch = fly(launchToward({ x: ux, z: uz - 0.5, h: 0 }, { x: rx, z: rz, h: 0 }, 9, 0, env), env, (_b, tt) => tt > 0.35, 0.35).frames;
        const fin = fly(launchToward({ x: rx, z: rz, h: 0.1 }, { x: side * -0.6, z: -1.2, h: 0.3 }, 16, 0, env), env, (b) => b.z < -1.5, 1.5).frames;
        let netted = false;
        s.setPose(keeper, 'dive', ux - side * 1);
        s.moveTo(keeper, ux - side * 0.6, keeper.z, 5);
        const tNet = 0.55 + (fin.find((f) => f.z <= 0)?.t ?? 0.4);
        res = {
          success: true, quality: timingQuality(grade, errMs, c.half), reason: 'goal', goal: true, slowmoAt: 0.2,
          play: (dt, rt) => {
            if (rt < 0.35) { placeBall(c, sampleFrames(touch, rt), dt); s.moveTo(user, rx - side * 0.4, rz + 0.5, 7); }
            else if (rt >= 0.55) { if (user.pose !== 'kick' && rt < 0.7) s.setPose(user, 'kick'); placeBall(c, sampleFrames(fin, rt - 0.55), dt); }
            if (!netted && rt >= tNet) { netted = true; const f = sampleFrames(fin, rt - 0.55); s.netHit(f.x, 0.4, 1); s.flash(0.4); s.shake(8); s.confetti(); s.crowdRoar(); s.setPose(user, 'celebrate'); }
            return rt > tNet + 1.1;
          },
        };
        return res;
      }
      if (g.type === 'swipe') {
        if (g.dirY > -0.3) return null; // sideways swipe: ignore
        const aim = aimShot(c, g, { x: ux, z: uz });
        const out = resolveChip(gp, g.power, aim.x);
        const env = envFor(c.t, spec.context.rain);
        const land = out.success ? { x: clamp(aim.x, -2.8, 2.8), z: -0.6, h: 0.5 } : out.reason === 'over' ? { x: aim.x, z: -2, h: 3.6 } : out.reason === 'wide' ? { x: aim.x, z: -1, h: 1 } : { x: keeper.x, z: keeper.z, h: 2.0 };
        const ch = fly(launchToward({ x: ux, z: uz - 0.6, h: 0.1 }, land, 11, 0, env), env, (b) => b.z < land.z - 0.05 || b.z < -1.6, 2).frames;
        const tl = ch[ch.length - 1].t;
        let done = false;
        s.setPose(user, 'kick');
        if (!out.success && out.reason !== 'over' && out.reason !== 'wide') { s.setPose(keeper, 'jump'); }
        else { s.setPose(keeper, 'jump'); }
        res = {
          success: out.success, quality: out.quality, reason: out.success ? 'goal' : out.reason === 'keeper_home' || out.reason === 'smothered' || out.reason === 'short' ? 'saved' : out.reason,
          goal: out.success, slowmoAt: tl * 0.5,
          play: (dt, rt) => {
            placeBall(c, sampleFrames(ch, rt), dt);
            keeper.h = keeper.pose === 'jump' ? Math.max(0, Math.sin(Math.min(Math.PI, rt * 4)) * 0.4) : 0;
            if (!done && rt >= tl) {
              done = true;
              if (out.success) { s.netHit(land.x, 0.6, 1); s.flash(0.4); s.confetti(); s.shake(8); s.crowdRoar(); s.setPose(user, 'celebrate'); }
              else sparks(c, land.x, land.z, land.h, 10);
            }
            return rt > tl + 1.0;
          },
        };
        return res;
      }
      return null;
    },
    timeout: () => smother(),
  };

  function smother(): Resolution {
    s.setPose(keeper, 'slide', c.s.ball.x);
    s.moveTo(keeper, c.s.ball.x, c.s.ball.z, 6);
    gradeLabel(c, 'late');
    return {
      success: false, quality: 0.15, reason: 'saved',
      play: (dt, rt) => {
        if (rt > 0.15) placeBall(c, { x: keeper.x + 0.3, z: keeper.z, h: 0.1 }, dt);
        if (rt > 0.3 && user.pose !== 'down') s.setPose(user, 'down');
        return rt > 1.4;
      },
    };
  }
  function keeperReads(): Resolution {
    s.moveTo(keeper, user.x, user.z - 1, 5);
    return {
      success: false, quality: 0.2, reason: 'saved',
      play: (dt, rt) => {
        if (rt > 0.25) { s.setPose(keeper, 'slide', user.x); placeBall(c, { x: keeper.x, z: keeper.z + 0.4, h: 0.1 }, dt); }
        return rt > 1.4;
      },
    };
  }
};

// ------------------------------------------------------------------ header

export const header: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const side = sideOf(rng);
  const ux = range(rng, -2.5, 2.5);
  const uz = range(rng, 7, 10.5);
  const user = s.addActor({ id: 'user', team: 'user', x: ux, z: uz + 1.5, mark: 'user' });
  const marker = s.addActor({ id: 'marker', team: 'opp', x: ux + side * 0.8, z: uz - 0.6 });
  const crosser = s.addActor({ id: 'crosser', team: 'mate', x: side * 25, z: 13 });
  const keeper = keeperFor(c, side * 0.8, 0.7);
  s.addActor({ id: 'd2', team: 'opp', x: -ux + side * 2, z: 6 });
  s.addActor({ id: 'm2', team: 'mate', x: -side * 5, z: 11 });
  s.addActor({ id: 'd3', team: 'opp', x: -side * 6, z: 9.5 });
  const env = envFor(c.t, spec.context.rain);
  const launchAt = 0.35;
  const head = { x: ux, z: uz, h: 2.0 };
  const crossBall = launchToward({ x: side * 25, z: 13.6, h: 0.1 }, { x: ux, z: uz - 0.3, h: head.h }, 20, -side * 2.5, env);
  const crossFr = fly(crossBall, env, (b) => b.h < 0.1 && b.vh < 0, 3).frames;
  // arrival: closest point to head height near the user's spot
  let arr = crossFr[crossFr.length - 1].t;
  let best = 1e9;
  for (const f of crossFr) { const d = Math.hypot(f.x - ux, f.z - (uz - 0.3)); if (d < best) { best = d; arr = f.t; } }
  const ideal = launchAt + arr;
  const half = windowHalfMs(spec, c.t, 175);
  s.ball.x = side * 25; s.ball.z = 13.6;
  const ring = { x: ux, z: uz - 0.3, r0: 3.2, r1: 0.75, t0: 0, dur: 1, color: 0xffe14d, hot: false, kind: 'shrink' as const };
  const cam = attackCam(c, ux * 0.5, uz + 3, 0.15);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  let tapAt = -1;
  return {
    title: 'הקש כשהכדור בעיגול',
    sub: 'הקש בצד ימין/שמאל של המסך לבחירת פינה',
    input: 'tap',
    timeLimit: ideal + half / 1000 + 0.35,
    hint: () => { const p = s.p(ux, uz - 0.3, 0); return { kind: 'tap', x0: p.sx, y0: p.sy, x1: 0, y1: 0, bend: 0, alpha: 0.8 }; },
    intro: () => { if (!s.rings.includes(ring)) { ring.t0 = s.time + c.t.introSeconds + launchAt; ring.dur = arr; s.rings.push(ring); } },
    tick: (dt, at) => {
      if (at < launchAt) { placeBall(c, { x: side * 25, z: 13.6, h: 0 }, dt); s.moveTo(crosser, side * 25 - side * 0.6, 14.2, 2); }
      else {
        if (crosser.pose !== 'kick' && at < launchAt + 0.2) { s.setPose(crosser, 'kick'); grassKick(c, side * 25, 13.6); }
        if (tapAt < 0) placeBall(c, sampleFrames(crossFr, at - launchAt), dt);
      }
      s.moveTo(user, ux, uz, 3);
      s.moveTo(marker, ux + side * 0.7, uz - 0.5, 3);
      ring.hot = Math.abs((at - ideal) * 1000) < half;
      void ring;
    },
    gesture: (g, at) => {
      if (g.type !== 'tap' || res) return null;
      tapAt = at;
      const errMs = (at - ideal) * 1000;
      const grade = gradeTiming(errMs, half);
      gradeLabel(c, grade.grade);
      s.rings.length = 0;
      s.setPose(user, 'header');
      const jumpStart = s.time;
      const jump = () => { const u = clamp01((s.time - jumpStart) / 0.6); user.h = Math.sin(u * Math.PI) * 0.55; };
      if (!grade.hit) {
        const rest = crossFr.filter((f) => f.t >= at - launchAt);
        const fr = rest.length > 1 ? rest.map((f) => ({ ...f, t: f.t - (at - launchAt) })) : crossFr;
        res = {
          success: false, quality: timingQuality(grade, errMs, half), reason: 'miss', sub: grade.grade === 'early' ? 'קפצת מוקדם מדי' : 'הכדור עבר מעליך',
          play: (dt, rt) => { jump(); placeBall(c, sampleFrames(fr, rt), dt); if (rt > 0.3) s.moveTo(marker, s.ball.x, s.ball.z, 4); return rt > 1.5; },
        };
        return res;
      }
      const left = g.x < s.screen.w / 2;
      const tx = (left ? -1 : 1) * lerp(1.6, 3.1, grade.accuracy);
      const from = { x: ux, z: uz - 0.3, h: 2.2 };
      const out = resolveShot(
        { from, target: { x: tx, h: lerp(1.6, 0.35, grade.accuracy) }, power: lerp(0.25, 0.65, grade.accuracy), curl: 0, skill: spec.attackerSkill },
        { keeperX: keeper.x, react: c.react, reachMul: c.reachMul * 0.95, rain: spec.context.rain, speedMul: 0.8 }, c.t, c.rng,
      );
      // ball has to finish its flight to the head first
      const toHead = Math.max(0, ideal - at);
      const inbound = crossFr.filter((f) => f.t >= at - launchAt).map((f) => ({ ...f, t: f.t - (at - launchAt) }));
      const shotPlay = playShot(c, out, null, keeper);
      let headed = false;
      res = {
        success: out.success, quality: clamp01(out.quality * 0.75 + grade.accuracy * 0.25), reason: out.result, goal: out.success,
        slowmoAt: toHead + out.tContact,
        play: (dt, rt) => {
          jump();
          if (rt < toHead && inbound.length > 1) { placeBall(c, sampleFrames(inbound, rt), dt); return false; }
          if (!headed) { headed = true; sparks(c, from.x, from.z, from.h, 8, [0xffffff]); }
          return shotPlay(dt, rt - toHead);
        },
      };
      return res;
    },
    timeout: () => {
      s.rings.length = 0;
      const env2 = envFor(c.t, false);
      const fr = fly({ x: s.ball.x, z: s.ball.z, h: Math.max(1.8, s.ball.h), vx: side * 3, vz: 12, vh: 6, spin: 0 }, env2, (_b, tt) => tt > 1.3, 1.3).frames;
      s.setPose(marker, 'jump');
      return {
        success: false, quality: 0.06, reason: 'miss', sub: 'המגן הקדים אותך',
        play: (dt, rt) => {
          marker.h = Math.max(0, Math.sin(Math.min(Math.PI, rt * 5)) * 0.4);
          placeBall(c, sampleFrames(fr, rt), dt);
          return rt > 1.2;
        },
      };
    },
  };
};

export { BAR };
