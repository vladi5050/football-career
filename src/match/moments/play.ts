// Build-up moments: dribble, through_ball, cross, interception.
import {
  clamp, clamp01, envFor, fly, gradeTiming, launchToward, lerp, reactionTime, resolveDelivery, resolveDribble, resolveTiming,
  rollPass, sampleFrames, timingQuality, windowHalfMs, type BallFrame, type Runner,
} from '../sim';
import type { Actor } from '../scene';
import {
  attackCam, ballAtFeet, defendCam, grassKick, gradeLabel, introCam, isSwipe, placeBall, range, sideOf, sparks, swipeWorldDir,
  type MomentCtx, type Resolution, type ScriptFactory,
} from './common';

function markRival(c: MomentCtx, a: Actor): void {
  if (c.spec.context.rivalInvolved) { a.mark = 'rival'; c.rivalActor = a; }
}

// ------------------------------------------------------------------ dribble

export const dribble: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const ux = range(rng, -6, 6);
  const user = s.addActor({ id: 'user', team: 'user', x: ux, z: 34, mark: 'user' });
  const def = s.addActor({ id: 'def', team: 'opp', x: ux + range(rng, -0.5, 0.5), z: 25 });
  markRival(c, def);
  s.addActor({ id: 'd2', team: 'opp', x: ux + sideOf(rng) * 9, z: 22 });
  s.addActor({ id: 'm1', team: 'mate', x: ux - 8, z: 30 });
  s.addActor({ id: 'm2', team: 'mate', x: clamp(ux + 10, -25, 25), z: 26 });
  s.addActor({ id: 'gk', team: 'opp', gk: true, x: 0, z: 0.8 });
  const lean: -1 | 1 = sideOf(rng); // world x side the defender leans to
  const leanAt = range(rng, 0.5, 0.9);
  const commitAt = leanAt + range(rng, 0.55, 0.85) + spec.difficulty * 0.1;
  const half = windowHalfMs(spec, c.t, 200);
  const speed = 4.6;
  const cam = attackCam(c, ux, 33, 0.3);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  const ring = { x: def.x, z: def.z, r0: 3, r1: 1.0, t0: 0, dur: 1, color: 0xff5a5a, hot: false, kind: 'shrink' as const };
  let res: Resolution | null = null;
  let ringOn = false;
  return {
    title: 'החלק ימינה או שמאלה',
    sub: 'ברגע שהמגן נכנס, לצד השני ממנו',
    input: 'swipe',
    timeLimit: commitAt + half / 1000 * 1.25 + 0.2,
    hint: () => { const p = s.p(user.x, user.z, 1); return { kind: 'swipe', x0: p.sx - 50, y0: p.sy - 20, x1: p.sx + 50, y1: p.sy - 30, bend: 0, alpha: 0.8 }; },
    tick: (dt, at) => {
      // defender sits 2.2m in front at the commit moment
      const meetZ = 34 - speed * commitAt - 0.2;
      s.moveTo(user, user.x, user.z - speed * dt * 3, speed);
      ballAtFeet(c, user, -1, dt, 0.6);
      s.followCam = attackCam(c, user.x, user.z - 1, 0.3);
      if (at < commitAt) {
        s.moveTo(def, lerp(def.x, user.x, 0.2), Math.max(meetZ - 2.2, def.z - 0.8 * dt), 1.5);
        def.lean = at > leanAt ? clamp((at - leanAt) / 0.3, 0, 1) * lean * -s.cam.dir * 0.9 : 0;
      }
      if (!ringOn && at > commitAt - 0.75) { ringOn = true; ring.t0 = s.time; ring.dur = commitAt - at; s.rings.push(ring); }
      ring.x = def.x; ring.z = def.z;
      ring.hot = Math.abs((at - commitAt) * 1000) < half * 1.25;
      if (at >= commitAt && def.pose !== 'slide') { s.setPose(def, 'slide', def.x + lean * 1.5); s.moveTo(def, def.x + lean * 0.9, user.z - 0.3, 6); }
    },
    gesture: (g, at) => {
      if (!isSwipe(g) || res) return null;
      if (Math.abs(g.dirX) < 0.35) return null;
      const side = (Math.sign(g.dirX) * -s.cam.dir) as -1 | 1; // screen -> world x
      const err = (at - commitAt) * 1000;
      const out = resolveDribble(side, lean, err, half);
      gradeLabel(c, out.reason);
      s.rings.length = 0;
      if (out.success) {
        const ex = user.x + side * 2.6; const ez = user.z - 6;
        if (def.pose !== 'slide') { s.setPose(def, 'slide', def.x + lean * 1.5); s.moveTo(def, def.x + lean, def.z + 0.5, 6); }
        res = {
          success: true, quality: out.quality, reason: out.reason, slowmoAt: 0.12,
          play: (dt, rt) => {
            s.moveTo(user, rt < 0.35 ? user.x + side * 3 : ex, rt < 0.35 ? user.z - 1 : ez, 7.5);
            ballAtFeet(c, user, -1, dt, 0.8);
            if (rt > 0.3 && def.pose === 'slide' && def.poseT > 0.5) s.setPose(def, 'down');
            if (rt > 0.6 && rt < 0.65) s.crowdRoar();
            return rt > 1.5;
          },
        };
      } else {
        const env = envFor(c.t, spec.context.rain);
        let fr: BallFrame[] | null = null;
        if (out.reason === 'early') { s.moveTo(def, user.x + side * 0.5, user.z - 0.8, 4); }
        s.setPose(def, 'slide', user.x);
        res = {
          success: false, quality: out.quality, reason: out.reason,
          play: (dt, rt) => {
            if (rt < 0.25) { s.moveTo(user, user.x + side * 1.5, user.z - 0.5, 6); ballAtFeet(c, user, -1, dt, 0.7); }
            else {
              if (!fr) { fr = fly({ x: s.ball.x, z: s.ball.z, h: 0.05, vx: lean * 6, vz: 4, vh: 1.5, spin: 0 }, env, (_b, tt) => tt > 1.3, 1.3).frames; sparks(c, s.ball.x, s.ball.z, 0.2, 8); s.shake(4); s.setPose(user, 'down'); }
              placeBall(c, sampleFrames(fr, rt - 0.25), dt);
            }
            return rt > 1.5;
          },
        };
      }
      return res;
    },
    timeout: () => {
      s.rings.length = 0;
      gradeLabel(c, 'late');
      const env = envFor(c.t, spec.context.rain);
      const fr = fly({ x: s.ball.x, z: s.ball.z, h: 0.05, vx: lean * 5, vz: 5, vh: 1, spin: 0 }, env, (_b, tt) => tt > 1.2, 1.2).frames;
      s.setPose(user, 'down');
      return { success: false, quality: 0.08, reason: 'late', play: (dt, rt) => { placeBall(c, sampleFrames(fr, rt), dt); return rt > 1.3; } };
    },
  };
};

// ------------------------------------------------------------------ through ball

export const through_ball: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const ux = range(rng, -5, 5);
  const uz = range(rng, 39, 44);
  s.ball.x = ux; s.ball.z = uz - 0.6;
  const user = s.addActor({ id: 'user', team: 'user', x: ux, z: uz, mark: 'user' });
  const lineZ = range(rng, 24, 27);
  const defs: Actor[] = [];
  const defXs = [-10, -3.5, 3, 9.5].map((x) => x + range(rng, -1.2, 1.2));
  for (const [i, x] of defXs.entries()) defs.push(s.addActor({ id: 'd' + i, team: 'opp', x, z: lineZ + range(rng, -0.6, 0.6) }));
  if (spec.context.rivalInvolved) markRival(c, defs[1]);
  const presser = s.addActor({ id: 'press', team: 'opp', x: ux + sideOf(rng) * 5, z: uz - 5 });
  const gk = s.addActor({ id: 'gk', team: 'opp', gk: true, x: 0, z: 2.5 });
  // two runners attacking the gaps
  const gaps = [(defXs[0] + defXs[1]) / 2, (defXs[1] + defXs[2]) / 2, (defXs[2] + defXs[3]) / 2];
  const g1 = gaps[Math.floor(rng() * 3)];
  let g2 = gaps[Math.floor(rng() * 3)];
  if (g2 === g1) g2 = gaps[(gaps.indexOf(g1) + 1) % 3];
  const mates: { a: Actor; vx: number; vz: number; lane: { x0: number; z0: number; x1: number; z1: number } }[] = [];
  for (const [i, gx] of [g1, g2].entries()) {
    const sx = gx + (i ? 4 : -4);
    const sz = lineZ + 3.5;
    const ex = gx + (i ? -1 : 1); const ez = lineZ - 11;
    const T = 2.4;
    const a = s.addActor({ id: 'run' + i, team: 'mate', x: sx, z: sz, mark: 'target' });
    mates.push({ a, vx: (ex - sx) / T, vz: (ez - sz) / T, lane: { x0: sx, z0: sz, x1: ex, z1: ez } });
    s.lanes.push({ ...mates[i].lane, color: 0x7cf6ff, alpha: 0.75, width: 0.2, dashed: true });
  }
  const cam = attackCam(c, ux * 0.5, uz - 2, 1.0);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  const env = envFor(c.t, spec.context.rain);
  const react = reactionTime(spec.difficulty, c.t);
  let res: Resolution | null = null;
  let runStart = -1;
  return {
    title: 'מסירת עומק',
    sub: 'החלק לכיוון המסלול של החלוץ · קשת = מסירה מסובבת',
    input: 'swipe',
    timeLimit: 2.8 - spec.difficulty * 0.4,
    hint: () => {
      const b = s.p(ux, uz - 0.6, 0); const m = mates[0].lane; const p = s.p(m.x1, m.z1, 0);
      return { kind: 'swipe', x0: b.sx, y0: b.sy, x1: lerp(b.sx, p.sx, 0.55), y1: lerp(b.sy, p.sy, 0.55), bend: 0, alpha: 0.8 };
    },
    tick: (dt, at) => {
      if (runStart < 0) runStart = at;
      for (const m of mates) s.moveTo(m.a, m.lane.x1, m.lane.z1, Math.hypot(m.vx, m.vz));
      for (const d of defs) s.moveTo(d, d.x, d.z + 0.3 * dt, 1);
      s.moveTo(presser, ux + 0.8, uz - 1, 3.2);
      user.lean = Math.sin(at * 3) * 0.15;
      ballAtFeet(c, user, -1, dt, 0.5);
    },
    gesture: (g) => {
      if (!isSwipe(g) || res) return null;
      const dir = swipeWorldDir(c, g);
      const dist = lerp(10, 36, g.power);
      const bow = g.curl ? clamp(g.curve / 0.3, -1, 1) * 0.25 : 0;
      const b0 = rollPass({ x: s.ball.x, z: s.ball.z }, dir.x, dir.z, dist, bow, env);
      if (spec.context.rain) { b0.vx *= 1 + (rng() - 0.5) * 0.1; b0.vz *= 1 + (rng() - 0.5) * 0.1; }
      const frames = fly(b0, env, (b) => Math.hypot(b.vx, b.vz) < 0.8, 3.5).frames;
      const mr: Runner[] = mates.map((m, i) => ({ id: 'run' + i, x: m.a.x, z: m.a.z, vx: m.vx, vz: m.vz, speed: 2.5, reach: 1.0, react: 0.1, maxRun: 2.6, headH: 1.0 }));
      const or: Runner[] = defs.map((d, i) => ({ id: 'd' + i, x: d.x, z: d.z, vx: 0, vz: 0, speed: 5.5, reach: c.t.defenderReach, react, maxRun: 2.2, headH: 1.6 }));
      or.push({ id: 'press', x: presser.x, z: presser.z, vx: 0, vz: 0, speed: 4, reach: 1.0, react, maxRun: 1.2, headH: 1.0 });
      or.push({ id: 'gk', x: gk.x, z: gk.z, vx: 0, vz: 0, speed: 6, reach: 1.4, react, maxRun: 9, headH: 2.5 });
      const del = resolveDelivery(frames, mr, or);
      const success = del.byTeam === 'mate';
      // quality: how far ahead / how clean (distance of nearest defender at reception)
      let q = success ? 0.62 : 0.15;
      if (success && del.at) {
        let nd = 99;
        for (const o of or) nd = Math.min(nd, Math.hypot(o.x - del.at.x, o.z - del.at.z));
        q = clamp01(0.6 + 0.08 * Math.min(4, nd) + (g.curl ? 0.06 : 0));
      }
      const tEnd = del.at ? del.t : frames[frames.length - 1].t;
      const fr = frames.filter((f) => f.t <= tEnd);
      s.setPose(user, 'kick');
      grassKick(c, s.ball.x, s.ball.z, 8);
      s.lanes.length = 0;
      const winner = [...mates.map((m) => m.a), ...defs, presser, gk].find((a) => a.id === del.winner) ?? null;
      res = {
        success, quality: q, reason: success ? 'pass' : 'intercepted', slowmoAt: tEnd - 0.15,
        play: (dt, rt) => {
          if (rt < tEnd) placeBall(c, sampleFrames(fr, rt), dt);
          else if (winner) {
            const dirz = winner.team === 'opp' ? 1 : -1;
            if (rt - tEnd < dt * 1.5) { sparks(c, s.ball.x, s.ball.z, 0.2, 8, [0xffffff]); if (success) s.crowdRoar(); }
            s.moveTo(winner, winner.x, winner.z + dirz * 6, 6.5);
            ballAtFeet(c, winner, dirz, dt, 0.6);
          } else placeBall(c, sampleFrames(fr, rt), dt);
          if (winner && rt < tEnd) s.moveTo(winner, s.ball.x, s.ball.z, winner.team === 'opp' ? 5.5 : 7);
          return rt > tEnd + 1.1;
        },
      };
      return res;
    },
    timeout: () => {
      s.setPose(presser, 'slide', user.x);
      s.moveTo(presser, user.x, user.z - 0.4, 6);
      gradeLabel(c, 'late');
      return {
        success: false, quality: 0.08, reason: 'intercepted', sub: 'הלחץ הגיע',
        play: (dt, rt) => { if (rt > 0.2) { placeBall(c, { x: presser.x - 0.4, z: presser.z + 0.5, h: 0 }, dt); s.setPose(user, 'down'); } return rt > 1.3; },
      };
    },
  };
};

// ------------------------------------------------------------------ cross

export const cross: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const side = sideOf(rng);
  const bx = side * range(rng, 7, 9);
  const bz = range(rng, 21, 25);
  s.ball.x = bx; s.ball.z = bz;
  const user = s.addActor({ id: 'user', team: 'user', x: bx + side * 0.4, z: bz + 0.8, mark: 'user' });
  const fb = s.addActor({ id: 'fb', team: 'opp', x: bx - side * 2.5, z: bz - 2 });
  if (spec.context.rivalInvolved) markRival(c, fb);
  const spots = [
    { x: side * range(rng, 2.5, 4.5), z: range(rng, 5.5, 7.5) },
    { x: -side * range(rng, -0.5, 1.5), z: range(rng, 8, 10.5) },
    { x: side * range(rng, 1, 4), z: range(rng, 12.5, 15) },
  ];
  const mates: Actor[] = [];
  const markers: Actor[] = [];
  for (const [i, sp] of spots.entries()) {
    if (i === 2 && rng() < 0.4) continue;
    mates.push(s.addActor({ id: 'm' + i, team: 'mate', x: sp.x, z: sp.z, mark: 'target' }));
    const mx = sp.x + range(rng, -1.2, 1.2) * (i === 0 ? 1 : 0.8);
    markers.push(s.addActor({ id: 'k' + i, team: 'opp', x: mx, z: sp.z - range(rng, 0.6, 1.4) }));
  }
  const gk = s.addActor({ id: 'gk', team: 'opp', gk: true, x: side * 1.4, z: 0.9 });
  const cam = attackCam(c, bx * 1.1, bz, 1.0);
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  const env = envFor(c.t, spec.context.rain);
  const react = reactionTime(spec.difficulty, c.t);
  let res: Resolution | null = null;
  return {
    title: 'הגבהה!',
    sub: 'החלק לכיוון הראש של חבר לקבוצה',
    input: 'swipe',
    timeLimit: 3.0 - spec.difficulty * 0.5,
    hint: () => { const b = s.p(bx, bz, 0); const m = s.p(mates[0].x, mates[0].z, 0); return { kind: 'swipe', x0: b.sx, y0: b.sy, x1: lerp(b.sx, m.sx, 0.6), y1: lerp(b.sy, m.sy, 0.6), bend: -side * 25, alpha: 0.8 }; },
    tick: (dt, at) => {
      s.moveTo(fb, bx - side * 0.9, bz - 0.6, 3.2);
      for (const [i, m] of mates.entries()) s.moveTo(m, spots[i].x + Math.sin(at * 2 + i) * 0.6, spots[i].z + Math.cos(at * 1.5 + i) * 0.4, 2.5);
      for (const [i, k] of markers.entries()) s.moveTo(k, mates[i].x + 0.5 * Math.sign(-mates[i].x || 1), mates[i].z - 0.8, 2.4);
      user.lean = Math.sin(at * 3) * 0.2;
      placeBall(c, { x: bx, z: bz, h: 0 }, dt);
    },
    gesture: (g) => {
      if (!isSwipe(g) || res) return null;
      const dir = swipeWorldDir(c, g);
      // aim assist: snap the length to the teammate closest to the swipe ray, power decides float vs driven
      const along = (a: Actor) => (a.x - bx) * dir.x + (a.z - bz) * dir.z;
      const off = (a: Actor) => Math.abs((a.x - bx) * -dir.z + (a.z - bz) * dir.x);
      let best: Actor | null = null;
      for (const m of mates) if (along(m) > 3 && off(m) < 4 && (!best || off(m) < off(best))) best = m;
      const dist = best ? along(best) * lerp(0.85, 1.15, g.power) : lerp(12, 34, g.power);
      const tgt = { x: bx + dir.x * dist, z: bz + dir.z * dist, h: lerp(2.4, 1.3, g.power) };
      const curl = g.curl ? clamp(-g.curve / 0.3, -1, 1) * 4 : 0;
      const speed = lerp(14, 24, g.power);
      const b0 = launchToward({ x: bx, z: bz, h: 0.1 }, tgt, speed, curl, env);
      if (spec.context.rain) { b0.vx += (rng() - 0.5) * 1.2; }
      const frames = fly(b0, env, (b) => b.h <= 0.02 && b.vh <= 0 && b.z < bz, 3).frames;
      const mr: Runner[] = mates.map((m) => ({ id: m.id, x: m.x, z: m.z, vx: 0, vz: 0, speed: 3, reach: 0.95, react: 0.12, maxRun: 1.8, headH: 2.75 }));
      const or: Runner[] = markers.map((k) => ({ id: k.id, x: k.x, z: k.z, vx: 0, vz: 0, speed: 3, reach: 0.85, react, maxRun: 1.3, headH: 2.6 }));
      or.unshift({ id: 'fb', x: fb.x, z: fb.z, vx: 0, vz: 0, speed: 4, reach: 0.9, react: 0.05, maxRun: 0.5, headH: 2.3 });
      or.push({ id: 'gk', x: gk.x, z: gk.z, vx: 0, vz: 0, speed: 4.5, reach: 1.1, react, maxRun: 3.5, headH: 3.0 });
      const del = resolveDelivery(frames, mr, or);
      const success = del.byTeam === 'mate';
      const winner = [...mates, ...markers, fb, gk].find((a) => a.id === del.winner) ?? null;
      const tEnd = del.at ? del.t : frames[frames.length - 1].t;
      const fr = frames.filter((f) => f.t <= tEnd);
      let q = success ? 0.6 : 0.15;
      if (success && del.at) {
        let nd = 9;
        for (const k of markers) nd = Math.min(nd, Math.hypot(k.x - del.at.x, k.z - del.at.z));
        q = clamp01(0.58 + 0.12 * Math.min(2.5, nd) + (del.at.h > 1.4 ? 0.08 : 0));
      }
      s.setPose(user, 'kick');
      grassKick(c, bx, bz, 8);
      let after: BallFrame[] | null = null;
      res = {
        success, quality: q, reason: success ? 'cross' : 'cleared', slowmoAt: tEnd - 0.1,
        play: (dt, rt) => {
          if (winner && rt < tEnd) {
            s.moveTo(winner, del.at!.x, del.at!.z, 3.5);
            if (rt > tEnd - 0.4 && winner.pose !== 'header') s.setPose(winner, 'header');
            if (winner.pose === 'header') winner.h = Math.sin(clamp01((rt - (tEnd - 0.4)) / 0.7) * Math.PI) * 0.5;
          }
          if (rt < tEnd) { placeBall(c, sampleFrames(fr, rt), dt); return false; }
          if (!after) {
            const p = sampleFrames(fr, tEnd);
            sparks(c, p.x, p.z, p.h, 8, [0xffffff]);
            if (success && winner) {
              const tx = -Math.sign(winner.x || 1) * range(rng, 1.5, 3);
              after = fly(launchToward(p, { x: tx, z: -0.6, h: 0.6 }, 15, 0, env), env, (b) => b.z < -1.2, 1.5).frames;
              s.crowdRoar();
            } else {
              after = fly({ ...p, vx: side * 5, vz: 14, vh: 5, spin: 0 }, env, (_b, tt) => tt > 1.3, 1.3).frames;
            }
          }
          if (winner && winner.pose === 'header') winner.h = Math.max(0, Math.sin(clamp01((rt - (tEnd - 0.4)) / 0.7) * Math.PI) * 0.5);
          placeBall(c, sampleFrames(after, rt - tEnd), dt);
          return rt > tEnd + 1.2;
        },
      };
      return res;
    },
    timeout: () => {
      s.setPose(fb, 'slide', bx);
      s.moveTo(fb, bx, bz, 5);
      const fr = fly({ x: bx, z: bz, h: 0.05, vx: -side * 3, vz: 5, vh: 3, spin: 0 }, env, (_b, tt) => tt > 1.2, 1.2).frames;
      return { success: false, quality: 0.08, reason: 'cleared', sub: 'המגן חסם את ההגבהה', play: (dt, rt) => { if (rt > 0.2) placeBall(c, sampleFrames(fr, rt - 0.2), dt); return rt > 1.4; } };
    },
  };
};

// ------------------------------------------------------------------ interception

export const interception: ScriptFactory = (c) => {
  const { s, rng, spec } = c;
  const side = sideOf(rng);
  const px = side * range(rng, 3, 6); const pz = range(rng, 45, 48);
  const rx = -side * range(rng, 2, 5); const rz = range(rng, 30, 33);
  const passer = s.addActor({ id: 'passer', team: 'opp', x: px, z: pz });
  const receiver = s.addActor({ id: 'recv', team: 'opp', x: rx, z: rz });
  markRival(c, receiver);
  const mx = lerp(px, rx, 0.55); const mz = lerp(pz, rz, 0.55);
  // user sits 2.4m off the lane, on the goal side
  const nx = -(rz - pz); const nz = rx - px; const nl = Math.hypot(nx, nz);
  const sgn = nz / nl < 0 ? 1 : -1;
  const ux = mx + (nx / nl) * 2.4 * -sgn; const uz = mz + (nz / nl) * 2.4 * -sgn;
  const user = s.addActor({ id: 'user', team: 'user', x: ux, z: uz, mark: 'user' });
  s.addActor({ id: 'o2', team: 'opp', x: px - side * 12, z: pz - 6 });
  s.addActor({ id: 'm2', team: 'mate', x: rx - side * 5, z: rz + 3 });
  s.addActor({ id: 'm3', team: 'mate', x: px - side * 7, z: pz - 2 });
  s.addActor({ id: 'o3', team: 'opp', x: px + side * 6, z: pz - 9 });
  s.ball.x = px; s.ball.z = pz - 0.6;
  const lightAt = range(rng, 0.9, 1.7);
  const passAt = lightAt + 0.14;
  const ideal = lightAt + 0.2;
  const half = windowHalfMs(spec, c.t, 200);
  const env = envFor(c.t, spec.context.rain);
  const passSpeed = lerp(15, 21, spec.difficulty);
  const passFr = fly(launchToward({ x: px, z: pz - 0.6, h: 0 }, { x: rx, z: rz + 0.6, h: 0 }, passSpeed, 0, env), env, (b) => Math.hypot(b.x - rx, b.z - rz) < 0.7 || b.z < rz, 2).frames;
  passFr.forEach((f) => { f.h = Math.min(f.h, 0.25 * Math.sin(Math.PI * clamp01(f.t / passFr[passFr.length - 1].t))); });
  const lane = { x0: px, z0: pz - 0.6, x1: rx, z1: rz + 0.6, color: 0xdfe6f2, alpha: 0.55, width: 0.25, dashed: true };
  s.lanes.push(lane);
  const cam = defendCam(c, { far: pz + 2, near: rz - 3, x: (px + rx) / 2, yFar: 0.26, yNear: 0.82, back: 13, camH: 14 });
  s.setCamera(introCam(cam), 0);
  s.setCamera(cam, c.t.introSeconds);
  let res: Resolution | null = null;
  const lunge = (to: { x: number; z: number }) => { s.setPose(user, 'slide', to.x); s.moveTo(user, to.x, to.z, 8); };
  return {
    title: 'הקש כשקו המסירה נדלק',
    sub: 'מוקדם מדי והוא יראה אותך',
    input: 'tap',
    timeLimit: passAt + passFr[passFr.length - 1].t,
    hint: () => { const p = s.p(mx, mz, 0); return { kind: 'tap', x0: p.sx, y0: p.sy, x1: 0, y1: 0, bend: 0, alpha: 0.75 }; },
    tick: (dt, at) => {
      if (at < passAt) {
        s.moveTo(passer, px + Math.sin(at * 2) * 0.4, pz - at * 0.6, 2);
        ballAtFeet(c, passer, -1, dt, 0.6);
        s.moveTo(user, ux + Math.sin(at * 2.5) * 0.4, uz, 2);
      } else {
        if (passer.pose !== 'kick') { s.setPose(passer, 'kick'); grassKick(c, px, pz, 6); }
        placeBall(c, sampleFrames(passFr, at - passAt), dt);
      }
      if (at >= lightAt) { lane.color = 0xffe14d; lane.alpha = 0.9 + 0.1 * Math.sin(at * 20); lane.dashed = false; lane.width = 0.3; }
      s.moveTo(receiver, rx + Math.sin(at * 1.7) * 0.6, rz, 2);
    },
    gesture: (g, at) => {
      if (g.type !== 'tap' || res) return null;
      const err = (at - ideal) * 1000;
      const out = resolveTiming(err, half);
      gradeLabel(c, out.reason);
      if (out.success) {
        const catchT = Math.max(0.1, (ideal - passAt) + 0.25);
        const pt = sampleFrames(passFr, catchT);
        lunge(pt);
        let got = false;
        res = {
          success: true, quality: out.quality, reason: out.reason, slowmoAt: Math.max(0, catchT - (at - passAt)) - 0.05,
          play: (dt, rt) => {
            const ft = at - passAt + rt;
            if (!got && ft < catchT) placeBall(c, sampleFrames(passFr, Math.max(0, ft)), dt);
            else {
              if (!got) { got = true; sparks(c, pt.x, pt.z, 0.2, 12); s.shake(4); s.crowdRoar(); }
              if (rt > catchT + 0.35) { s.setPose(user, 'run'); s.moveTo(user, user.x, user.z + 6, 6.5); }
              ballAtFeet(c, user, 1, dt, 0.6);
            }
            return rt > 1.6;
          },
        };
        return res;
      }
      if (out.reason === 'early') {
        // passer sees the move and chips it over / to another man
        const alt = { x: rx + side * 3, z: rz - 1 };
        const fr = fly(launchToward({ x: s.ball.x, z: s.ball.z, h: 0 }, { ...alt, h: 0.2 }, 15, 0, env), env, (b) => b.z < alt.z + 0.3, 2).frames;
        lunge({ x: mx, z: mz });
        res = {
          success: false, quality: out.quality, reason: 'early',
          play: (dt, rt) => {
            if (rt > 0.15) { if (passer.pose !== 'kick') s.setPose(passer, 'kick'); placeBall(c, sampleFrames(fr, rt - 0.15), dt); s.moveTo(receiver, alt.x, alt.z, 6); }
            else ballAtFeet(c, passer, -1, dt, 0.6);
            return rt > 1.5;
          },
        };
        return res;
      }
      lunge({ x: mx, z: mz });
      res = {
        success: false, quality: out.quality, reason: 'late',
        play: (dt, rt) => { const ft = at - passAt + rt; placeBall(c, sampleFrames(passFr, ft), dt); if (ft > passFr[passFr.length - 1].t) ballAtFeet(c, receiver, -1, dt, 0.5); return rt > 1.3; },
      };
      return res;
    },
    timeout: () => ({
      success: false, quality: 0.06, reason: 'late',
      play: (dt, rt) => { ballAtFeet(c, receiver, -1, dt, 0.5); s.moveTo(receiver, receiver.x, receiver.z - 4, 5); return rt > 1.0; },
    }),
  };
};

export { timingQuality, gradeTiming };
