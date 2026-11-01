import { describe, expect, it } from 'vitest';
import type { ContextMods, MomentKind } from '../../src/core/types';
import {
  BAR, GOAL_HALF, angleDiff, contextWindowFactor, crossingAt, envFor, fly, frameOnTarget, gradeTiming, keeperReach, launchToward,
  makeRng, noInputResult, reactionTime, resolveBlock, resolveChip, resolveClearance, resolveDelivery, resolveDive, resolveDribble,
  resolveShot, resolveTackle, resultText, rollPass, stepBall, windowHalfMs, type Ball,
} from '../../src/match/sim';
import { DEFAULT_TUNING, mergeTuning } from '../../src/match/tuning';

const T = DEFAULT_TUNING;
const CTX0: ContextMods = { lateClose: false, hostileCrowd: false, rivalInvolved: false, rain: false, derby: false };
const noNoise = mergeTuning({ aimNoiseLow: 0, aimNoiseHigh: 0 });

describe('ball physics', () => {
  it('gravity pulls a lofted ball down and it bounces / settles', () => {
    const env = envFor(T, false);
    let b: Ball = { x: 0, z: 20, h: 0, vx: 0, vz: -10, vh: 6, spin: 0 };
    let maxH = 0;
    for (let i = 0; i < 600; i++) { b = stepBall(b, 1 / 120, env); maxH = Math.max(maxH, b.h); }
    expect(maxH).toBeGreaterThan(1.5);
    expect(maxH).toBeLessThan(2.1); // v^2/2g = 1.83
    expect(b.h).toBeLessThan(0.05);
  });

  it('friction slows a rolling ball; rain is slicker', () => {
    const roll = (rain: boolean) => {
      const env = envFor(T, rain);
      let b: Ball = { x: 0, z: 0, h: 0, vx: 0, vz: 10, vh: 0, spin: 0 };
      for (let i = 0; i < 240; i++) b = stepBall(b, 1 / 120, env);
      return b;
    };
    const dry = roll(false); const wet = roll(true);
    expect(dry.vz).toBeLessThan(10);
    expect(wet.z).toBeGreaterThan(dry.z);
  });

  it('spin bends the ball sideways', () => {
    const env = envFor(T, false);
    const fr = (spin: number) => fly({ x: 0, z: 20, h: 0.1, vx: 0, vz: -20, vh: 4, spin }, env, (b) => b.z < 0, 3).end;
    expect(fr(6).x).toBeGreaterThan(0.5); // +spin = right of travel = +x when moving toward the goal
    expect(fr(-6).x).toBeLessThan(-0.5);
    expect(Math.abs(fr(0).x)).toBeLessThan(1e-9);
  });

  it('launchToward hits the requested target (also with curl compensation)', () => {
    const env = envFor(T, false);
    for (const curl of [0, 5, -5]) {
      const b = launchToward({ x: 3, z: 18, h: 0.1 }, { x: -2, z: 0, h: 1.2 }, 24, curl, env);
      const c = crossingAt(fly(b, env, (bb) => bb.z < -0.5, 3).frames, 0)!;
      expect(c).not.toBeNull();
      expect(Math.abs(c.x - -2)).toBeLessThan(0.45);
      expect(Math.abs(c.h - 1.2)).toBeLessThan(0.45);
    }
  });

  it('rollPass rolls roughly the asked distance and bows', () => {
    const env = envFor(T, false);
    const end = fly(rollPass({ x: 0, z: 40 }, 0, -1, 20, 0, env), env, (b) => Math.hypot(b.vx, b.vz) < 0.3, 6).end;
    expect(40 - end.z).toBeGreaterThan(14);
    expect(40 - end.z).toBeLessThan(30);
  });
});

describe('difficulty & context', () => {
  it('reaction time goes 0.35 -> 0.15 with difficulty', () => {
    expect(reactionTime(0, T)).toBeCloseTo(0.35);
    expect(reactionTime(1, T)).toBeCloseTo(0.15);
    expect(reactionTime(0.5, T)).toBeCloseTo(0.25);
  });

  it('lateClose shrinks the window by 20%, hostile crowd by 10%', () => {
    expect(contextWindowFactor({ ...CTX0, lateClose: true }, T)).toBeCloseTo(0.8);
    expect(contextWindowFactor({ ...CTX0, hostileCrowd: true }, T)).toBeCloseTo(0.9);
    expect(contextWindowFactor({ ...CTX0, lateClose: true, hostileCrowd: true }, T)).toBeCloseTo(0.72);
    const base = windowHalfMs({ difficulty: 0.5, attackerSkill: 50, context: CTX0 }, T);
    const late = windowHalfMs({ difficulty: 0.5, attackerSkill: 50, context: { ...CTX0, lateClose: true } }, T);
    expect(late / base).toBeCloseTo(0.8);
  });

  it('harder = narrower window, more skill = wider', () => {
    const w = (d: number, s: number) => windowHalfMs({ difficulty: d, attackerSkill: s, context: CTX0 }, T);
    expect(w(1, 50)).toBeLessThan(w(0, 50));
    expect(w(0.5, 99)).toBeGreaterThan(w(0.5, 1));
  });
});

describe('timing', () => {
  it('grades early / perfect / good / late', () => {
    expect(gradeTiming(0, 150)).toMatchObject({ hit: true, grade: 'perfect', accuracy: 1 });
    expect(gradeTiming(120, 150)).toMatchObject({ hit: true, grade: 'good' });
    expect(gradeTiming(-200, 150)).toMatchObject({ hit: false, grade: 'early' });
    expect(gradeTiming(200, 150)).toMatchObject({ hit: false, grade: 'late' });
  });

  it('tackle: too early is a foul, too late is beaten', () => {
    expect(resolveTackle(-400, 150).reason).toBe('foul');
    expect(resolveTackle(400, 150).reason).toBe('beaten');
    const ok = resolveTackle(10, 150);
    expect(ok.success).toBe(true);
    expect(ok.quality).toBeGreaterThan(0.85);
  });

  it('dribble must go away from the lean, at the commit', () => {
    expect(resolveDribble(1, -1, 0, 150).success).toBe(true);
    expect(resolveDribble(-1, -1, 0, 150).reason).toBe('wrong_side');
    expect(resolveDribble(1, -1, -500, 150).reason).toBe('early');
    expect(resolveDribble(1, -1, 500, 150).reason).toBe('late');
  });
});

describe('keeper', () => {
  it('reaches shots near him, not the far top corner of a quick shot', () => {
    expect(keeperReach(0, { x: 0.8, h: 1 }, 0.6, 0.25, T).saved).toBe(true);
    expect(keeperReach(0, { x: 3.4, h: 2.3 }, 0.4, 0.3, T).saved).toBe(false);
  });
  it('more time to react = more reach', () => {
    const a = keeperReach(0, { x: 2.6, h: 0.5 }, 0.45, 0.3, T);
    const b = keeperReach(0, { x: 2.6, h: 0.5 }, 0.9, 0.3, T);
    expect(b.reach).toBeGreaterThan(a.reach);
  });
});

describe('resolveShot', () => {
  const setup = { keeperX: 0, react: 0.25, reachMul: 1, rain: false };
  it('a hard shot into the corner beats the keeper', () => {
    const o = resolveShot({ from: { x: 0, z: 16, h: 0.11 }, target: { x: 3.1, h: 0.4 }, power: 0.9, curl: 0, skill: 80 }, setup, noNoise, makeRng(1));
    expect(o.result).toBe('goal');
    expect(o.success).toBe(true);
    expect(o.quality).toBeGreaterThan(0.6);
  });
  it('a soft shot at the keeper is saved', () => {
    const o = resolveShot({ from: { x: 0, z: 16, h: 0.11 }, target: { x: 0.4, h: 1 }, power: 0.2, curl: 0, skill: 80 }, setup, noNoise, makeRng(1));
    expect(o.result).toBe('saved');
    expect(o.success).toBe(false);
  });
  it('wide and over', () => {
    expect(resolveShot({ from: { x: 0, z: 16, h: 0.11 }, target: { x: 6, h: 0.5 }, power: 0.8, curl: 0, skill: 80 }, setup, noNoise, makeRng(1)).result).toBe('wide');
    expect(resolveShot({ from: { x: 0, z: 16, h: 0.11 }, target: { x: 0, h: 4 }, power: 0.8, curl: 0, skill: 80 }, setup, noNoise, makeRng(1)).result).toBe('over');
  });
  it('a wall in the way blocks a low shot', () => {
    const o = resolveShot(
      { from: { x: 0, z: 20, h: 0.11 }, target: { x: 0.5, h: 0.6 }, power: 0.7, curl: 0, skill: 80 },
      { ...setup, walls: [{ x0: -1.5, x1: 1.5, z: 10.85, height: 2.15 }] }, noNoise, makeRng(1),
    );
    expect(o.result).toBe('blocked');
  });
  it('is deterministic for the same seed', () => {
    const run = () => resolveShot({ from: { x: 0, z: 16, h: 0.11 }, target: { x: 2, h: 1 }, power: 0.6, curl: 0.5, skill: 50 }, { ...setup, rain: true }, T, makeRng(42));
    expect(run().crossing).toEqual(run().crossing);
  });
  it('better skill => smaller average aim error', () => {
    const err = (skill: number) => {
      let sum = 0;
      for (let i = 0; i < 60; i++) {
        const o = resolveShot({ from: { x: 0, z: 16, h: 0.11 }, target: { x: 2, h: 1 }, power: 0.7, curl: 0, skill }, { keeperX: 99, react: 1, reachMul: 0, rain: false }, T, makeRng(i + 1));
        sum += Math.abs(o.aimed.x - 2);
      }
      return sum / 60;
    };
    expect(err(95)).toBeLessThan(err(10));
  });
  it('penalty keeper guessing the wrong side cannot save a corner', () => {
    const o = resolveShot({ from: { x: 0, z: 11, h: 0.11 }, target: { x: 2.6, h: 0.5 }, power: 0.6, curl: 0, skill: 80 }, { ...setup, keeperGuess: -1 }, noNoise, makeRng(3));
    expect(o.result).toBe('goal');
  });
  it('frame classification', () => {
    expect(frameOnTarget(0, 1)).toBe('in');
    expect(frameOnTarget(GOAL_HALF + 1, 1)).toBe('wide');
    expect(frameOnTarget(0, BAR + 1)).toBe('over');
    expect(frameOnTarget(GOAL_HALF, 1)).toBe('post');
  });
});

describe('other resolvers', () => {
  it('chip works only when the keeper has come out and the weight is right', () => {
    expect(resolveChip(5, 0.5, 0.5).success).toBe(true);
    expect(resolveChip(14, 0.5, 0.5).reason).toBe('keeper_home');
    expect(resolveChip(5, 0.95, 0.5).reason).toBe('over');
    expect(resolveChip(1, 0.5, 0.5).reason).toBe('smothered');
  });
  it('clearance must go away from goal with power', () => {
    expect(resolveClearance(0.5, 0.8, 0.8).success).toBe(true);
    expect(resolveClearance(0, -1, 0.9).reason).toBe('own_goal_danger');
    expect(resolveClearance(0, 1, 0.1).reason).toBe('weak');
    // flank clearance scores higher than straight down the middle
    expect(resolveClearance(0.7, 0.7, 0.8).quality).toBeGreaterThan(resolveClearance(0, 1, 0.8).quality);
  });
  it('block needs the right direction before the ball passes', () => {
    expect(resolveBlock(0, 0.1, 0.3, 0.25).success).toBe(true);
    expect(resolveBlock(Math.PI, 0, 0.3, 0.25).success).toBe(false);
    expect(resolveBlock(0, 0, -0.1, 0.25).reason).toBe('late');
    expect(angleDiff(Math.PI * 1.9, Math.PI * 0.1)).toBeCloseTo(Math.PI * 0.2, 5);
  });
  it('keeper dive: right way in time saves, wrong way / late concedes', () => {
    expect(resolveDive({ x: 2.5, h: 0.6 }, { x: 2.8, h: 0.5 }, 0.3, T).success).toBe(true);
    expect(resolveDive({ x: -2.5, h: 0.6 }, { x: 2.8, h: 0.5 }, 0.3, T).success).toBe(false);
    expect(resolveDive({ x: 2.5, h: 0.6 }, { x: 2.8, h: 0.5 }, 0.0, T).reason).toBe('late');
    expect(resolveDive({ x: 0, h: 1 }, { x: 6, h: 0.5 }, 0.3, T).reason).toBe('off_target');
  });
  it('delivery goes to whoever reaches the ball first', () => {
    const frames = Array.from({ length: 60 }, (_, i) => ({ t: i / 60, x: 0, z: 30 - i * 0.3, h: 0 }));
    const mate = { id: 'm', x: 0.5, z: 15, vx: 0, vz: 0, speed: 3, reach: 1, react: 0.1, maxRun: 2, headH: 1 };
    const opp = { id: 'o', x: 0.5, z: 26, vx: 0, vz: 0, speed: 5, reach: 1, react: 0.2, maxRun: 2, headH: 1.5 };
    expect(resolveDelivery(frames, [mate], [opp]).byTeam).toBe('opp');
    expect(resolveDelivery(frames, [mate], [{ ...opp, x: 8 }]).byTeam).toBe('mate');
  });
  it('no input is a weak failure for every kind; result texts exist', () => {
    const kinds: MomentKind[] = ['shot', 'one_on_one', 'header', 'dribble', 'through_ball', 'long_shot', 'interception', 'tackle', 'block', 'clearance', 'save', 'rush_out', 'penalty', 'free_kick', 'cross'];
    for (const k of kinds) {
      const r = noInputResult(k);
      expect(r.success).toBe(false);
      expect(r.quality).toBeLessThan(0.2);
      expect(resultText(k, true, 'x').length).toBeGreaterThan(0);
      expect(resultText(k, false, 'x').length).toBeGreaterThan(0);
    }
    expect(resultText('shot', true, 'goal')).toBe('גול!');
    expect(resultText('save', true, 'perfect')).toBe('הצלה!');
    expect(resultText('interception', true, 'perfect')).toBe('חטיפה!');
    expect(resultText('shot', false, 'wide')).toBe('החטאה');
  });
});
