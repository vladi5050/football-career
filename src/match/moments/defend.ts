// Defensive moments (camera behind our own goal): tackle, block, clearance, save, rush_out.
import {
  BAR, GOAL_HALF, clamp, clamp01, envFor, fly, frameOnTarget, gradeTiming, keeperReach, launchToward, lerp, resolveBlock,
  resolveClearance, resolveDive, resolveTackle, resolveTiming, sampleFrames, windowHalfMs, type BallFrame,
} from '../sim';
import type { Actor } from '../scene';
import {
  ballAtFeet, defendCam, keeperCam, grassKick, gradeLabel, introCam, isSwipe, placeBall, range, sideOf, sparks, swipeWorldDir,
  type MomentCtx, type Resolution, type ScriptFactory,
} from './common';
import { diveTarget, makeKeeperRes } from './attack';

function rivalize(c: MomentCtx, a: Actor): void {
  if (c.spec.context.rivalInvolved) { a.mark = 'rival'; c.rivalActor = a; }
}

/** opponent shot at our goal: ball frames from `from` to (tx, th) on the line */
function shotFrames(c: MomentCtx, from: { x: number; z: number }, tx: number, th: number, speed: number): BallFrame[] {
  const env = envFor(c.t, c.spec.context.rain);
  const b = launchToward({ x: from.x, z: from.z, h: 0.11 }, { x: tx, z: 0, h: th }, speed, 0, env);
  return fly(b, env, (bb) => bb.z < 0.25, 2).frames;
}

// ------------------------------------------------------------------ tackle

export const tackle: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const x0 = range(rng, -10, 10);
  const user = s.addActor({ id: 'user', team: 'user', x: x0 * 0.8, z: 16, mark: 'user' });
  const drib = s.addActor({ id: 'drib', team: 'opp', x: x0, z: 30 });
  rivalize(c, drib);
  s.addActor({ id: 'gk', team: 'user', gk: true, x: 0, z: 0.8 });
  s.addActor({ id: 'cb', team: 'mate', x: -Math.sign(x0 || 1) * 8, z: 13 });
  s.addActor({ id: 'o2', team: 'opp', x: -Math.sign(x0 || 1) * 11, z: 22 });
  const speed = 5.2;
  const looseAt = range(rng, 1.0, 1.7);
  const ideal = looseAt + 0.32;
  const half = c.half;
  const ring = { x: 0, z: 0, r0: 3.0, r1: 0.8, t0: 0, dur: 1, color: 0xffe14d, hot: false, kind: 'shrink' as const };
  let ringOn = false;
  const cam = defendCam(c, { far: 27, near: 14, x: x0 * 0.7, yFar: 0.32, yNear: 0.8, back: 9, camH: 9 });
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  let ballPos = { x: x0, z: 29.3 };
  return {
    title: 'הקש כשהכדור בעיגול',
    sub: 'מוקדם מדי = עבירה',
    input: 'tap',
    timeLimit: ideal + half / 1000 + 0.25,
    hint: () => { const p = s.p(user.x, user.z - 3, 0); return { kind: 'tap', x0: p.sx, y0: p.sy, x1: 0, y1: 0, bend: 0, alpha: 0.75 }; },
    tick: (dt, at) => {
      // dribbler runs at the user; heavy touch at looseAt pushes the ball 2m ahead
      s.moveTo(drib, lerp(drib.x, user.x, 0.02), drib.z - speed * dt * 2, speed);
      if (at < looseAt) { ballAtFeet(c, drib, -1, dt, 0.6); ballPos = { x: s.ball.x, z: s.ball.z }; }
      else {
        const u = clamp01((at - looseAt) / 0.5);
        const tz = drib.z - 0.6 - 2.2 * Math.sin(u * Math.PI / 2);
        placeBall(c, { x: lerp(ballPos.x, user.x + 0.3, u * 0.5), z: Math.min(ballPos.z, tz), h: 0 }, dt);
        s.ball.glow = 1;
      }
      s.moveTo(user, lerp(user.x, drib.x, 0.05), Math.min(user.z, drib.z - 3.2), 1.4);
      if (!ringOn && at > ideal - 0.75) { ringOn = true; ring.t0 = s.time; ring.dur = ideal - at; s.rings.push(ring); }
      ring.x = s.ball.x; ring.z = s.ball.z;
      ring.hot = Math.abs((at - ideal) * 1000) < half;
    },
    gesture: (g, at) => {
      if (g.type !== 'tap' || res) return null;
      const err = (at - ideal) * 1000;
      const out = resolveTackle(err, half);
      gradeLabel(c, out.reason === 'foul' ? 'foul' : out.reason === 'beaten' ? 'beaten' : out.reason);
      s.rings.length = 0;
      s.ball.glow = 0;
      const env = envFor(c.t, spec.context.rain);
      s.setPose(user, 'slide', s.ball.x);
      s.moveTo(user, s.ball.x, s.ball.z - 0.2, 7);
      if (out.success) {
        const fr = fly({ x: s.ball.x, z: s.ball.z, h: 0.05, vx: sideOf(rng) * 7, vz: 4, vh: 1.8, spin: 0 }, env, (_b, tt) => tt > 1.3, 1.3).frames;
        let hit = false;
        res = {
          success: true, quality: out.quality, reason: out.reason, slowmoAt: 0.15,
          play: (dt, rt) => {
            if (rt > 0.15) {
              if (!hit) { hit = true; sparks(c, s.ball.x, s.ball.z, 0.2, 14); s.shake(5); s.crowdRoar(); }
              placeBall(c, sampleFrames(fr, rt - 0.15), dt);
              s.setPose(drib, 'jump'); drib.h = Math.max(0, Math.sin(Math.min(Math.PI, (rt - 0.15) * 5)) * 0.5);
            }
            return rt > 1.5;
          },
        };
      } else if (out.reason === 'foul') {
        res = {
          success: false, quality: out.quality, reason: 'foul', sub: 'כרטיס צהוב',
          play: (dt, rt) => {
            if (rt > 0.2 && drib.pose !== 'down') { s.setPose(drib, 'down'); s.shake(5); }
            ballAtFeet(c, drib, -1, dt, 0.8);
            return rt > 1.4;
          },
        };
      } else {
        const side = Math.sign(drib.x - user.x) || 1;
        res = {
          success: false, quality: out.quality, reason: 'beaten',
          play: (dt, rt) => {
            s.moveTo(drib, user.x + side * 2.5, user.z - 4, 7);
            if (rt > 0.15) ballAtFeet(c, drib, -1, dt, 0.7);
            return rt > 1.3;
          },
        };
      }
      return res;
    },
    timeout: () => {
      s.rings.length = 0; s.ball.glow = 0;
      gradeLabel(c, 'late');
      const side = Math.sign(drib.x - user.x) || 1;
      return {
        success: false, quality: 0.06, reason: 'beaten',
        play: (dt, rt) => { s.moveTo(drib, user.x + side * 2.5, user.z - 4, 7); ballAtFeet(c, drib, -1, dt, 0.7); return rt > 1.2; },
      };
    },
  };
};

// ------------------------------------------------------------------ block

export const block: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const sx = range(rng, -8, 8);
  const sz = range(rng, 19, 24);
  const shooter = s.addActor({ id: 'shooter', team: 'opp', x: sx, z: sz + 4 });
  rivalize(c, shooter);
  const dz = sz - 4.2;
  const dx = sx * (dz / sz);
  const user = s.addActor({ id: 'user', team: 'user', x: dx, z: dz, mark: 'user' });
  const gk = s.addActor({ id: 'gk', team: 'user', gk: true, x: sx * 0.12, z: 0.8 });
  s.addActor({ id: 'cb', team: 'mate', x: sx + 7, z: 12 });
  s.addActor({ id: 'o2', team: 'opp', x: sx - 8, z: 13 });
  const strikeAt = range(rng, 1.2, 1.7);
  const teleAt = strikeAt - 0.5;
  // shot target in the goal: left / centre / right of the defender
  const lane = Math.floor(rng() * 3) - 1; // -1,0,1 (world x side relative to the defender)
  let tx = clamp(dx * (0 / dz) + lane * range(rng, 1.8, 3.1), -GOAL_HALF + 0.3, GOAL_HALF - 0.3);
  if (lane === 0) tx = clamp(sx * 0.1, -1, 1);
  const th = range(rng, 0.3, 1.1);
  const speed = lerp(22, 28, spec.difficulty);
  const frames = shotFrames(c, { x: sx, z: sz }, tx, th, speed);
  const cross = frames.find((f) => f.z <= dz) ?? frames[frames.length - 1];
  const tPass = strikeAt + cross.t;
  const cam = defendCam(c, { far: sz + 4, near: 0, x: sx * 0.5, yFar: 0.26, yNear: 0.9, back: 12, camH: 20 });
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  let swipe: { angle: number; at: number } | null = null;
  s.ball.x = sx; s.ball.z = sz + 3.4;
  // telegraph: faint cone on the ground toward the target from the shooter
  const tele = { x0: sx, z0: sz, x1: tx, z1: 1, color: 0xff5a5a, alpha: 0, width: 0.3, dashed: true };
  s.lanes.push(tele);
  const screenAngle = () => {
    const lat = cross.x - dx;
    if (Math.abs(lat) < 0.45) return -Math.PI / 2;
    const scr = Math.sign(lat * -s.cam.dir);
    return scr > 0 ? 0 : Math.PI;
  };
  return {
    title: 'החלק לכיוון הבעיטה',
    sub: 'הקו האדום מראה לאן הוא מכוון',
    input: 'both',
    timeLimit: tPass + 0.3,
    hint: () => { const p = s.p(dx, dz, 1); return { kind: 'swipe', x0: p.sx, y0: p.sy, x1: p.sx + (rng() < 0.5 ? -80 : 80), y1: p.sy, bend: 0, alpha: 0.75 }; },
    tick: (dt, at) => {
      if (at < strikeAt) {
        const u = clamp01(at / strikeAt);
        s.moveTo(shooter, sx + Math.sin(at * 2) * 0.3, lerp(sz + 4, sz + 0.7, u), 4.5);
        ballAtFeet(c, shooter, -1, dt, 0.6);
        if (at > teleAt) tele.alpha = clamp01((at - teleAt) / 0.3) * 0.8;
        s.moveTo(user, dx + Math.sin(at * 3) * 0.2, dz, 1.5);
      } else {
        if (shooter.pose !== 'kick') { s.setPose(shooter, 'kick'); grassKick(c, sx, sz); }
        if (!swipe || at < swipe.at + 0.01 || true) placeBall(c, sampleFrames(frames, at - strikeAt), dt);
      }
      if (swipe && at >= Math.min(tPass, swipe.at + 0.25) && !res) {
        const out = resolveBlock(swipe.angle, screenAngle(), tPass - swipe.at, c.react, 0.55 - spec.difficulty * 0.1);
        res = blockRes(out.success, out.quality, out.reason, at);
        return res;
      }
    },
    gesture: (g, at) => {
      if (swipe || res) return null;
      let angle = -Math.PI / 2;
      if (isSwipe(g)) angle = Math.atan2(g.dirY, g.dirX);
      swipe = { angle, at };
      // visual commitment
      const scrSide = Math.abs(Math.cos(angle)) < 0.5 ? 0 : Math.sign(Math.cos(angle));
      const worldSide = scrSide * -s.cam.dir;
      if (scrSide) { s.setPose(user, 'slide', dx + worldSide * 2); s.moveTo(user, dx + worldSide * 0.9, dz, 5); }
      else s.setPose(user, 'jump');
      return 'lock';
    },
    timeout: (at) => blockRes(false, 0.06, 'late', at),
  };

  function blockRes(success: boolean, quality: number, reason: string, at: number): Resolution {
    s.lanes.length = 0;
    gradeLabel(c, reason);
    const env = envFor(c.t, spec.context.rain);
    const t0 = Math.max(0, at - strikeAt);
    let defl: BallFrame[] | null = null;
    let tail: BallFrame[] | null = null;
    const gkr = keeperReach(gk.x, { x: tx, h: th }, frames[frames.length - 1].t, c.react, c.t, 1);
    return {
      success, quality, reason,
      slowmoAt: Math.max(0, cross.t - t0) - 0.05,
      play: (dt, rt) => {
        const ft = t0 + rt;
        if (success) {
          if (ft < cross.t) placeBall(c, sampleFrames(frames, ft), dt);
          else {
            if (!defl) { defl = fly({ x: cross.x, z: cross.z, h: cross.h, vx: (rng() - 0.5) * 12, vz: 8, vh: 4, spin: 0 }, env, (_b, tt) => tt > 1.3, 1.3).frames; sparks(c, cross.x, cross.z, cross.h, 16); s.shake(5); s.crowdRoar(); }
            placeBall(c, sampleFrames(defl, ft - cross.t), dt);
          }
        } else {
          const end = frames[frames.length - 1].t;
          if (ft < end) placeBall(c, sampleFrames(frames, ft), dt);
          else {
            if (!tail) {
              if (gkr.saved) { s.setPose(gk, 'dive', tx); tail = fly({ x: tx, z: 0.4, h: th, vx: Math.sign(tx || 1) * 4, vz: 6, vh: 2, spin: 0 }, env, (_b, tt) => tt > 1, 1).frames; sparks(c, tx, 0.4, th, 12); }
              else { s.setPose(gk, 'dive', tx); tail = fly(launchToward({ x: tx, z: 0.2, h: th }, { x: tx, z: -1.7, h: th }, 14, 0, env), env, (b) => b.z < -1.6, 0.5).frames; s.netHit(tx, th, 1); s.shake(6); }
            }
            placeBall(c, sampleFrames(tail, ft - end), dt);
          }
          if (ft > end - 0.25 && gk.pose !== 'dive') { s.setPose(gk, 'dive', tx); s.moveTo(gk, tx * 0.8, gk.z, 6); }
        }
        return rt > Math.max(0, cross.t - t0) + 1.3;
      },
    };
  }
};

// ------------------------------------------------------------------ clearance

export const clearance: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const side = sideOf(rng);
  const ux = range(rng, -4, 4);
  const uz = range(rng, 7, 11);
  const user = s.addActor({ id: 'user', team: 'user', x: ux, z: uz, mark: 'user' });
  const striker = s.addActor({ id: 'st', team: 'opp', x: ux - side * 1.0, z: uz + 1.6 });
  rivalize(c, striker);
  const gk = s.addActor({ id: 'gk', team: 'user', gk: true, x: side * 0.6, z: 0.8 });
  s.addActor({ id: 'o2', team: 'opp', x: -side * 5, z: 9 });
  s.addActor({ id: 'm2', team: 'mate', x: -side * 4, z: 7.5 });
  const crosser = s.addActor({ id: 'cr', team: 'opp', x: side * 26, z: 12 });
  const env = envFor(c.t, spec.context.rain);
  const launchAt = 0.25;
  const inFr = fly(launchToward({ x: side * 26, z: 12.5, h: 0.1 }, { x: ux, z: uz, h: 0.9 }, 19, 0, env), env, (b) => Math.hypot(b.x - ux, b.z - uz) < 0.3 || (b.h < 0.05 && b.vh < 0), 3).frames;
  const arrive = launchAt + inFr[inFr.length - 1].t;
  s.ball.x = side * 26; s.ball.z = 12.5;
  const cam = defendCam(c, { far: 20, near: 1, x: ux * 0.7, back: 12, camH: 13 });
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  let queued: { wx: number; wz: number; power: number } | null = null;
  const lateBy = 0.55 + (1 - spec.difficulty) * 0.3;
  return {
    title: 'הרחק את הכדור!',
    sub: 'החלק חזק הרחק מהשער, עדיף לצדדים',
    input: 'swipe',
    timeLimit: arrive + lateBy,
    hint: () => { const p = s.p(ux, uz, 0.5); return { kind: 'swipe', x0: p.sx, y0: p.sy, x1: p.sx + 60 * -side, y1: p.sy - 150, bend: 0, alpha: 0.85 }; },
    tick: (dt, at) => {
      if (at < launchAt) placeBall(c, { x: side * 26, z: 12.5, h: 0 }, dt);
      else {
        if (crosser.pose !== 'kick') { s.setPose(crosser, 'kick'); grassKick(c, side * 26, 12.5); }
        if (at < arrive) placeBall(c, sampleFrames(inFr, at - launchAt), dt);
      }
      s.moveTo(striker, ux + side * 0.3, uz + 0.5 + Math.max(0, 1.6 - at), 2.5);
      if (queued && at >= arrive - 0.05 && !res) { res = clearRes(queued); return res; }
    },
    gesture: (g, at) => {
      if (!isSwipe(g) || res || queued) return null;
      const d = swipeWorldDir(c, g);
      queued = { wx: d.x, wz: d.z, power: g.power };
      if (at < arrive - 0.05) return 'lock';
      res = clearRes(queued);
      return res;
    },
    timeout: () => {
      s.setPose(striker, 'kick');
      const fr = shotFrames(c, { x: s.ball.x, z: s.ball.z }, -side * 2.2, 0.6, 22);
      gradeLabel(c, 'late');
      let hit = false;
      return {
        success: false, quality: 0.05, reason: 'loose',
        play: (dt, rt) => {
          placeBall(c, sampleFrames(fr, rt), dt);
          if (!hit && rt > fr[fr.length - 1].t) { hit = true; s.setPose(gk, 'dive', -side * 2.2); sparks(c, -side * 2.2, 0.4, 0.6); s.shake(4); }
          return rt > fr[fr.length - 1].t + 0.9;
        },
      };
    },
  };

  function clearRes(q: { wx: number; wz: number; power: number }): Resolution {
    const out = resolveClearance(q.wx, q.wz, q.power);
    s.setPose(user, 'kick');
    s.shake(4);
    const from = { x: s.ball.x, z: s.ball.z, h: Math.max(0.2, s.ball.h) };
    let fr: BallFrame[];
    if (out.reason === 'own_goal_danger') {
      fr = shotFrames(c, from, side * 2.8, 1.2, 18);
      s.setPose(gk, 'dive', side * 2.8);
      s.moveTo(gk, side * 2.4, gk.z, 6);
    } else {
      const dist = lerp(10, 48, q.power);
      const l = Math.hypot(q.wx, q.wz) || 1;
      const tgt = { x: from.x + (q.wx / l) * dist, z: from.z + (q.wz / l) * dist, h: 0 };
      fr = fly(launchToward(from, tgt, lerp(14, 30, q.power), 0, env), env, (_b, tt) => tt > 2.2, 2.2).frames;
      if (!out.success) s.moveTo(striker, tgt.x, tgt.z, 5);
    }
    sparks(c, from.x, from.z, from.h, 10, [0xffffff]);
    return {
      success: out.success, quality: out.quality, reason: out.reason, slowmoAt: 0.02,
      play: (dt, rt) => {
        placeBall(c, sampleFrames(fr, rt), dt);
        if (out.success && rt > 0.4 && rt < 0.45) s.crowdRoar();
        return rt > 1.6;
      },
    };
  }
};

// ------------------------------------------------------------------ save

export const save: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const sx = range(rng, -10, 10);
  const sz = range(rng, 13, 19);
  const shooter = s.addActor({ id: 'shooter', team: 'opp', x: sx, z: sz + 4 });
  rivalize(c, shooter);
  const user = s.addActor({ id: 'user', team: 'user', gk: true, x: sx * 0.12, z: 0.6, mark: 'user' });
  s.addActor({ id: 'cb', team: 'mate', x: sx + sideOf(rng) * 4, z: sz + 2 });
  s.addActor({ id: 'o2', team: 'opp', x: -sx * 0.6, z: 9 });
  s.addActor({ id: 'm2', team: 'mate', x: -sx * 0.4, z: 7 });
  const strikeAt = range(rng, 1.15, 1.7);
  let tx = sideOf(rng) * range(rng, 0.9, 3.3);
  const th = range(rng, 0.15, 1.5 + spec.difficulty * 0.8);
  const speed = lerp(19, 27, spec.difficulty);
  let frames = shotFrames(c, { x: sx, z: sz }, tx, th, speed);
  let arrive = strikeAt + frames[frames.length - 1].t;
  s.ball.x = sx; s.ball.z = sz + 3.4;
  const cam = keeperCam(c, sz + 3, sx);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  let dive: { x: number; h: number; at: number } | null = null;
  return {
    title: 'החלק לכיוון הבעיטה',
    sub: 'השוער יזנק לאן שתחליק',
    input: 'swipe',
    timeLimit: arrive + 0.15,
    hint: () => { const k = s.p(user.x, user.z, 1); return { kind: 'swipe', x0: k.sx, y0: k.sy, x1: k.sx - 90, y1: k.sy - 50, bend: 0, alpha: 0.85 }; },
    tick: (dt, at) => {
      user.lean = dive ? user.lean : Math.sin(at * 7) * 0.35;
      if (at < strikeAt) {
        const u = clamp01(at / strikeAt);
        s.moveTo(shooter, sx, lerp(sz + 4, sz + 0.7, u), 5);
        ballAtFeet(c, shooter, -1, dt, 0.6);
        if (!dive) s.moveTo(user, clamp(s.ball.x * 0.13, -1.2, 1.2), 0.6 + u * 0.4, 1.5);
      } else {
        if (shooter.pose !== 'kick') { s.setPose(shooter, 'kick'); grassKick(c, sx, sz); s.shake(2); }
        placeBall(c, sampleFrames(frames, at - strikeAt), dt);
      }
      if (dive && at >= arrive - 0.02 && !res) {
        const out = resolveDive({ x: dive.x, h: dive.h }, { x: tx, h: th }, arrive - dive.at, c.t, 1 / c.reachMul + 0.12);
        gradeLabel(c, out.reason === 'late' ? 'late' : out.reason === 'wrong_way' ? 'wrong_way' : out.reason);
        res = makeKeeperRes(c, out.success, out.quality, out.reason, frames, arrive - strikeAt, tx, th, user, strikeAt, at);
        return res;
      }
    },
    gesture: (g, at) => {
      if (dive || res) return null;
      const dx = g.type === 'swipe' ? g.dirX : 0;
      const dy = g.type === 'swipe' ? g.dirY : -0.4;
      const pw = g.type === 'swipe' ? g.power : 0.3;
      const d = diveTarget(dx, dy, user.x, pw);
      dive = { ...d, at };
      // committing long before the strike: the shooter may go the other way
      if (at < strikeAt - 0.25 && rng() < 0.35 + 0.4 * spec.difficulty && Math.sign(d.x) === Math.sign(tx)) {
        tx = -tx; frames = shotFrames(c, { x: sx, z: sz }, tx, th, speed); arrive = strikeAt + frames[frames.length - 1].t;
      }
      if (Math.abs(d.x - user.x) > 0.6 || d.h > 1.6) { s.setPose(user, 'dive', d.x); s.moveTo(user, lerp(user.x, d.x, 0.8), user.z, 6.5); }
      else s.setPose(user, 'jump');
      return 'lock';
    },
    timeout: (at) => {
      const onT = frameOnTarget(tx, th);
      const straight = Math.abs(tx - user.x) < 0.7 && th < 1.8;
      const saved = onT !== 'in' || straight;
      return makeKeeperRes(c, saved, saved ? 0.35 : 0.05, saved ? 'off_target' : 'frozen', frames, arrive - strikeAt, tx, th, user, strikeAt, at);
    },
  };
};

// ------------------------------------------------------------------ rush out

export const rush_out: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const sx = range(rng, -6, 6);
  const st = s.addActor({ id: 'st', team: 'opp', x: sx, z: 23 });
  rivalize(c, st);
  const user = s.addActor({ id: 'user', team: 'user', gk: true, x: 0, z: 0.7, mark: 'user' });
  const chaser = s.addActor({ id: 'cb', team: 'mate', x: sx + sideOf(rng) * 3, z: 26 });
  const speed = 6.2;
  const heavyAt = range(rng, 0.9, 1.4);
  const ideal = heavyAt + 0.12;
  const half = windowHalfMs(spec, c.t, 230);
  const cam = keeperCam(c, 21, sx);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  const env = envFor(c.t, spec.context.rain);
  let res: Resolution | null = null;
  let loose: { x: number; z: number } | null = null;
  const ring = { x: 0, z: 0, r0: 2.4, r1: 1.1, t0: 0, dur: 0.6, color: 0x4dff88, hot: false, kind: 'pulse' as const };
  return {
    title: 'צא מהקו בזמן!',
    sub: 'הקש כשהחלוץ נוגע בכדור רחוק מדי',
    input: 'tap',
    timeLimit: ideal + half / 1000 + 0.45,
    hint: () => { const p = s.p(0, 6, 0); return { kind: 'tap', x0: p.sx, y0: p.sy, x1: 0, y1: 0, bend: 0, alpha: 0.75 }; },
    tick: (dt, at) => {
      s.moveTo(st, lerp(st.x, 0, 0.01), st.z - speed * dt * 2, speed);
      s.moveTo(chaser, st.x + 1, st.z + 2.5, speed * 0.95);
      if (at < heavyAt) ballAtFeet(c, st, -1, dt, 0.6);
      else {
        if (!loose) { loose = { x: s.ball.x, z: s.ball.z }; s.rings.push(ring); ring.t0 = s.time; }
        const u = clamp01((at - heavyAt) / 0.6);
        placeBall(c, { x: loose.x, z: loose.z - 3.2 * Math.sin(u * Math.PI / 2), h: 0 }, dt);
        ring.x = s.ball.x; ring.z = s.ball.z;
        ring.hot = Math.abs((at - ideal) * 1000) < half;
        s.ball.glow = 1;
      }
      if (!res) s.moveTo(user, clamp(s.ball.x * 0.15, -1, 1), 0.7 + clamp01(at / 2) * 0.8, 1.6);
    },
    gesture: (g, at) => {
      if (g.type !== 'tap' || res) return null;
      const err = (at - ideal) * 1000;
      const out = resolveTiming(err, half);
      gradeLabel(c, out.reason);
      s.rings.length = 0; s.ball.glow = 0;
      if (out.success) {
        const bx = s.ball.x; const bz = s.ball.z - 1.5;
        let hit = false;
        s.moveTo(user, bx, bz, 8);
        res = {
          success: true, quality: out.quality, reason: out.reason, slowmoAt: 0.35,
          play: (dt, rt) => {
            if (rt > 0.15 && user.pose !== 'slide') s.setPose(user, 'slide', bx + 0.5);
            if (rt < 0.4) { const u = rt / 0.4; placeBall(c, { x: bx, z: lerp(s.ball.z, bz, u * 0.2), h: 0 }, dt); }
            else { if (!hit) { hit = true; sparks(c, bx, bz, 0.3, 14); s.shake(5); s.crowdRoar(); } placeBall(c, { x: user.x + 0.2, z: user.z + 0.3, h: 0.25 }, dt); if (rt > 0.5 && st.pose !== 'jump') { s.setPose(st, 'jump'); } st.h = Math.max(0, Math.sin(Math.min(Math.PI, (rt - 0.5) * 5)) * 0.5); }
            return rt > 1.5;
          },
        };
        return res;
      }
      if (out.reason === 'early') {
        // came too soon: the striker lifts it over you
        s.moveTo(user, s.ball.x, s.ball.z - 4, 6);
        const fr = fly(launchToward({ x: s.ball.x, z: s.ball.z, h: 0.1 }, { x: 0.5, z: -0.8, h: 0.6 }, 11, 0, env), env, (b) => b.z < -1.2, 2).frames;
        let net = false;
        res = {
          success: false, quality: out.quality, reason: 'early', slowmoAt: 0.5,
          play: (dt, rt) => {
            if (rt > 0.2) { if (st.pose !== 'kick') s.setPose(st, 'kick'); placeBall(c, sampleFrames(fr, rt - 0.2), dt); }
            if (!net && rt - 0.2 > fr[fr.length - 1].t - 0.1) { net = true; s.netHit(0.5, 0.6, 1); s.shake(5); }
            return rt > fr[fr.length - 1].t + 1.1;
          },
        };
        return res;
      }
      res = lateRes(out.quality);
      return res;
    },
    timeout: () => lateRes(0.05),
  };

  function lateRes(q: number): Resolution {
    s.rings.length = 0; s.ball.glow = 0;
    gradeLabel(c, 'late');
    const tx = -Math.sign(user.x || 1) * range(rng, 2, 3.2);
    const fr = shotFrames(c, { x: s.ball.x, z: s.ball.z }, tx, 0.5, 20);
    let net = false;
    s.moveTo(user, user.x + 0.5, user.z + 1.2, 4);
    return {
      success: false, quality: q, reason: 'late', slowmoAt: fr[fr.length - 1].t + 0.15,
      play: (dt, rt) => {
        if (rt > 0.15) { if (st.pose !== 'kick') s.setPose(st, 'kick'); placeBall(c, sampleFrames(fr, rt - 0.15), dt); }
        if (rt > 0.35 && user.pose !== 'dive') s.setPose(user, 'dive', tx);
        if (!net && rt - 0.15 >= fr[fr.length - 1].t) { net = true; s.netHit(tx, 0.5, 1); s.shake(5); }
        return rt > fr[fr.length - 1].t + 1.2;
      },
    };
  }
};

export { BAR, gradeTiming };
