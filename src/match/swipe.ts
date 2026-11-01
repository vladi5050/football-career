// Gesture recognition for key moments. Pointer Events => finger, pen and mouse share one path.
// classifyGesture() is pure (unit tested); GestureTracker wires it to a DOM element.
import type { Tuning } from './tuning';

export interface TrackPoint { x: number; y: number; t: number }

export interface TapGesture { type: 'tap'; x: number; y: number; t: number; pointer: string }
export interface SwipeGesture {
  type: 'swipe';
  start: TrackPoint;
  end: TrackPoint;
  dx: number; dy: number;
  /** unit direction start -> end */
  dirX: number; dirY: number;
  length: number; // px
  duration: number; // ms
  speed: number; // px/ms
  power: number; // 0..1
  /** signed midpoint deviation / length. >0: path bows to the right of travel direction (screen coords) */
  curve: number;
  curl: boolean;
  t: number; // timestamp of release
  pointer: string;
}
export interface NoGesture { type: 'none'; reason: 'slow' | 'short' | 'empty'; pointer: string }
export type Gesture = TapGesture | SwipeGesture | NoGesture;

export interface Thresholds { tapMaxMs: number; tapMaxPx: number; swipeMinPx: number; swipeMaxMs: number; curlRatio: number; powerMinSpeed: number; powerMaxSpeed: number }

/** Thresholds for a pointer type. Mouse drags are wider, so distances (and speeds) are ×desktopFactor. */
export function thresholdsFor(pointerType: string, t: Tuning): Thresholds {
  const k = pointerType === 'mouse' ? t.desktopFactor : 1;
  return {
    tapMaxMs: t.tapMaxMs,
    tapMaxPx: t.tapMaxPx * k,
    swipeMinPx: t.swipeMinPx * k,
    swipeMaxMs: t.swipeMaxMs,
    curlRatio: t.curlRatio,
    powerMinSpeed: t.powerMinSpeed * k,
    powerMaxSpeed: t.powerMaxSpeed * k,
  };
}

/** Point at half of the path's arc length. */
function arcMidpoint(pts: TrackPoint[]): { x: number; y: number } {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (total === 0) return { x: pts[0].x, y: pts[0].y };
  let acc = 0;
  const half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (acc + seg >= half && seg > 0) {
      const u = (half - acc) / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u };
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}

/**
 * Classify a finished pointer track.
 * Tap: < tapMaxMs and < tapMaxPx. Swipe: >= swipeMinPx and < swipeMaxMs.
 * power = normalized speed; curve = signed midpoint deviation / length; curl when |curve| > curlRatio.
 */
export function classifyGesture(pts: TrackPoint[], pointerType: string, tuning: Tuning): Gesture {
  if (pts.length === 0) return { type: 'none', reason: 'empty', pointer: pointerType };
  const th = thresholdsFor(pointerType, tuning);
  const start = pts[0];
  const end = pts[pts.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  const duration = Math.max(1, end.t - start.t);
  let maxDist = 0;
  for (const p of pts) maxDist = Math.max(maxDist, Math.hypot(p.x - start.x, p.y - start.y));

  if (duration < th.tapMaxMs && maxDist < th.tapMaxPx) {
    return { type: 'tap', x: start.x, y: start.y, t: start.t, pointer: pointerType };
  }
  if (length < th.swipeMinPx) return { type: 'none', reason: 'short', pointer: pointerType };
  if (duration >= th.swipeMaxMs) return { type: 'none', reason: 'slow', pointer: pointerType };

  const dirX = dx / length;
  const dirY = dy / length;
  const mid = arcMidpoint(pts);
  // perpendicular offset of the midpoint from the chord. Right-hand normal of (dirX,dirY) in screen
  // coordinates (y down) is (-dirY, dirX).
  const mx = mid.x - start.x;
  const my = mid.y - start.y;
  const dev = mx * -dirY + my * dirX;
  const curve = dev / length;
  const speed = length / duration;
  const power = Math.min(1, Math.max(0, (speed - th.powerMinSpeed) / (th.powerMaxSpeed - th.powerMinSpeed)));
  return {
    type: 'swipe', start, end, dx, dy, dirX, dirY, length, duration, speed, power,
    curve, curl: Math.abs(curve) > th.curlRatio, t: end.t, pointer: pointerType,
  };
}

/** Attaches pointer listeners to an element and reports classified gestures + live trail points. */
export class GestureTracker {
  private pts: TrackPoint[] = [];
  private pointerId: number | null = null;
  private pointerType = 'touch';
  private readonly el: HTMLElement;
  private readonly tuning: Tuning;
  onGesture: (g: Gesture) => void = () => {};
  onDown: (p: TrackPoint) => void = () => {};
  onMove: (p: TrackPoint) => void = () => {};

  constructor(el: HTMLElement, tuning: Tuning) {
    this.el = el;
    this.tuning = tuning;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.cancel);
    el.addEventListener('contextmenu', this.prevent);
  }

  get active(): boolean { return this.pointerId !== null; }
  get trail(): readonly TrackPoint[] { return this.pts; }

  private local(e: PointerEvent): TrackPoint {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp || performance.now() };
  }

  private prevent = (e: Event) => e.preventDefault();

  private down = (e: PointerEvent) => {
    if (this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.pointerType = e.pointerType || 'touch';
    try { this.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = this.local(e);
    this.pts = [p];
    this.onDown(p);
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    const p = this.local(e);
    this.pts.push(p);
    this.onMove(p);
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pts.push(this.local(e));
    const pts = this.pts;
    this.pointerId = null;
    this.pts = [];
    this.onGesture(classifyGesture(pts, this.pointerType, this.tuning));
  };

  private cancel = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.pts = [];
  };

  destroy(): void {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.cancel);
    this.el.removeEventListener('contextmenu', this.prevent);
    this.onGesture = () => {};
    this.onDown = () => {};
    this.onMove = () => {};
  }
}
