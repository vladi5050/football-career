import { describe, expect, it } from 'vitest';
import { classifyGesture, thresholdsFor, type TrackPoint } from '../../src/match/swipe';
import { DEFAULT_TUNING, mergeTuning } from '../../src/match/tuning';

const T = DEFAULT_TUNING;

/** straight or bowed track from (x0,y0) to (x1,y1) over ms, n samples. bend = px offset at the middle (right-hand normal). */
function track(x0: number, y0: number, x1: number, y1: number, ms: number, bend = 0, n = 12): TrackPoint[] {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len; const ny = (x1 - x0) / len;
  const pts: TrackPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n; const b = Math.sin(u * Math.PI) * bend;
    pts.push({ x: x0 + (x1 - x0) * u + nx * b, y: y0 + (y1 - y0) * u + ny * b, t: 1000 + ms * u });
  }
  return pts;
}

describe('classifyGesture', () => {
  it('detects a tap (<200ms, <20px)', () => {
    const g = classifyGesture(track(100, 100, 105, 104, 120), 'touch', T);
    expect(g.type).toBe('tap');
  });

  it('a slow press is not a tap', () => {
    const g = classifyGesture(track(100, 100, 102, 100, 450), 'touch', T);
    expect(g.type).toBe('none');
  });

  it('detects a straight swipe with direction and power', () => {
    const g = classifyGesture(track(200, 600, 200, 300, 150), 'touch', T);
    expect(g.type).toBe('swipe');
    if (g.type !== 'swipe') return;
    expect(g.dirX).toBeCloseTo(0, 5);
    expect(g.dirY).toBeCloseTo(-1, 5);
    expect(g.length).toBeCloseTo(300, 3);
    expect(g.power).toBeGreaterThan(0.7);
    expect(g.curl).toBe(false);
  });

  it('too short is neither tap nor swipe', () => {
    const g = classifyGesture(track(100, 100, 130, 100, 100), 'touch', T);
    expect(g.type).toBe('none');
    if (g.type === 'none') expect(g.reason).toBe('short');
  });

  it('too slow (>=600ms) is rejected', () => {
    const g = classifyGesture(track(100, 600, 100, 300, 700), 'touch', T);
    expect(g.type).toBe('none');
    if (g.type === 'none') expect(g.reason).toBe('slow');
  });

  it('power scales with speed', () => {
    const fast = classifyGesture(track(0, 400, 0, 100, 120), 'touch', T);
    const slow = classifyGesture(track(0, 400, 0, 100, 500), 'touch', T);
    expect(fast.type).toBe('swipe'); expect(slow.type).toBe('swipe');
    if (fast.type === 'swipe' && slow.type === 'swipe') {
      expect(fast.power).toBeGreaterThan(slow.power);
      expect(slow.power).toBeGreaterThanOrEqual(0);
      expect(fast.power).toBeLessThanOrEqual(1);
    }
  });

  it('curl: midpoint deviation > 12% of length, signed by side', () => {
    const right = classifyGesture(track(200, 600, 200, 300, 200, 60), 'touch', T); // 20% bow
    const left = classifyGesture(track(200, 600, 200, 300, 200, -60), 'touch', T);
    const tiny = classifyGesture(track(200, 600, 200, 300, 200, 20), 'touch', T); // ~6.7%
    expect(right.type === 'swipe' && right.curl).toBe(true);
    expect(left.type === 'swipe' && left.curl).toBe(true);
    expect(tiny.type === 'swipe' && tiny.curl).toBe(false);
    if (right.type === 'swipe' && left.type === 'swipe') {
      expect(Math.sign(right.curve)).toBe(-Math.sign(left.curve));
      expect(Math.abs(right.curve)).toBeCloseTo(0.2, 1);
    }
  });

  it('mouse uses desktop thresholds ×1.5', () => {
    const th = thresholdsFor('mouse', T);
    expect(th.swipeMinPx).toBe(60);
    expect(th.tapMaxPx).toBe(30);
    // 50px swipe: swipe on touch, too short on mouse
    expect(classifyGesture(track(0, 100, 0, 50, 100), 'touch', T).type).toBe('swipe');
    expect(classifyGesture(track(0, 100, 0, 50, 100), 'mouse', T).type).toBe('none');
    // 25px wobble: tap for mouse, not for touch
    expect(classifyGesture(track(0, 0, 25, 0, 100), 'mouse', T).type).toBe('tap');
    expect(classifyGesture(track(0, 0, 25, 0, 100), 'touch', T).type).toBe('none');
  });

  it('accepts tuning overrides', () => {
    const t = mergeTuning({ swipeMinPx: 100 });
    expect(classifyGesture(track(0, 200, 0, 120, 100), 'touch', t).type).toBe('none');
    expect(classifyGesture(track(0, 200, 0, 120, 100), 'touch', T).type).toBe('swipe');
  });

  it('empty track', () => {
    expect(classifyGesture([], 'touch', T).type).toBe('none');
  });
});
