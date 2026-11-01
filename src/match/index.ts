// Key-moment player: playMoment() mounts a PixiJS 8 mini-scene into `host`, lets the user act with a
// gesture, resolves with a MomentResult and tears everything down (safe to call many times per match).
import { Application } from 'pixi.js';
import type { MomentKind, MomentResult, MomentSpec } from '../core/types';
import { Hud } from './hud';
import { Scene } from './scene';
import { GestureTracker, type Gesture } from './swipe';
import { clamp01, makeRng, noInputResult, resultText } from './sim';
import { mergeTuning, type Tuning } from './tuning';
import { buildCtx, type MomentScript, type Resolution, type ScriptFactory } from './moments/common';
import { free_kick, header, long_shot, one_on_one, penalty, shot } from './moments/attack';
import { cross, dribble, interception, through_ball } from './moments/play';
import { block, clearance, rush_out, save, tackle } from './moments/defend';

export type { Tuning } from './tuning';
export { DEFAULT_TUNING } from './tuning';

export interface PlayMomentOptions {
  reducedMotion?: boolean;
  tuning?: Partial<Tuning>;
  /** team colours [primary, secondary] as CSS hex */
  colors?: { user: [string, string]; opp: [string, string] };
  /** penalty only: the user is the goalkeeper (MomentSpec has no position field) */
  asKeeper?: boolean;
}

export const MOMENT_FACTORIES: Record<MomentKind, ScriptFactory> = {
  shot, long_shot, free_kick, penalty, one_on_one, header,
  dribble, through_ball, cross, interception,
  tackle, block, clearance, save, rush_out,
};

const DEFAULT_COLORS: { user: [string, string]; opp: [string, string] } = { user: ['#1E5BD8', '#FFFFFF'], opp: ['#D62E2E', '#FFFFFF'] };

type Phase = 'intro' | 'action' | 'resolve' | 'result' | 'done';

export async function playMoment(host: HTMLElement, spec: MomentSpec, opts: PlayMomentOptions = {}): Promise<MomentResult> {
  const tuning = mergeTuning(opts.tuning);
  const reducedMotion = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const skipped: MomentResult = { momentId: spec.id, success: false, quality: 0, skipped: true };

  // ---- host + wrapper
  const prevPos = host.style.position;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#0c1220;touch-action:none;-webkit-tap-highlight-color:transparent;';
  host.appendChild(wrap);
  const width = Math.max(240, host.clientWidth || 390);
  const height = Math.max(320, host.clientHeight || 844);

  let skipRequested = false;
  const onEarlySkip = () => { skipRequested = true; };
  host.addEventListener('moment-skip', onEarlySkip);

  const app = new Application();
  try {
    await app.init({
      width, height,
      resolution: Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, tuning.maxDpr),
      autoDensity: true, antialias: true, background: 0x0c1220,
      preference: 'webgl',
    });
  } catch {
    host.removeEventListener('moment-skip', onEarlySkip);
    wrap.remove();
    host.style.position = prevPos;
    try { app.destroy(); } catch { /* ignore */ }
    return skipped;
  }
  host.removeEventListener('moment-skip', onEarlySkip);
  const canvas = app.canvas as HTMLCanvasElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;user-select:none;-webkit-user-select:none;';
  wrap.appendChild(canvas);
  app.ticker.stop();

  const rng = makeRng(spec.id * 9973 + spec.minute * 31 + 7);
  const scene = new Scene(app, {
    colors: opts.colors ?? DEFAULT_COLORS,
    rain: spec.context.rain,
    hostile: spec.context.hostileCrowd,
    lateClose: spec.context.lateClose,
    reducedMotion,
    seed: spec.id,
  }, { x: 0, z: 40, h: 30, f: 600, hy: -200, dir: -1 });
  const hud = new Hud(wrap, spec, reducedMotion);
  const ctx = buildCtx({ s: scene, spec, t: tuning, rng, hud, asKeeper: !!opts.asKeeper, reducedMotion });
  const factory = MOMENT_FACTORIES[spec.kind] ?? shot;
  const script: MomentScript = factory(ctx);
  hud.instruction(script.title, script.sub ?? '');
  const tracker = new GestureTracker(canvas, tuning);
  if (import.meta.env?.DEV) (globalThis as unknown as { __mm?: unknown }).__mm = { scene, ctx, script };

  return new Promise<MomentResult>((resolve) => {
    let phase: Phase = 'intro';
    let introT = 0;
    let at = 0; // action clock (sim seconds)
    let rt = 0; // resolution clock
    let resultT = 0;
    let res: Resolution | null = null;
    let locked = false;
    let touched = false;
    let slowLeft = 0;
    let slowDone = false;
    let timeScale = 1;
    let lastFrameNow = performance.now();
    let finished = false;

    const finish = (r: MomentResult) => {
      if (finished) return;
      finished = true;
      phase = 'done';
      app.ticker.remove(loop);
      app.ticker.stop();
      host.removeEventListener('moment-skip', onSkip);
      tracker.destroy();
      try { scene.destroy(); } catch { /* ignore */ }
      try { app.destroy({ removeView: true }, { children: true }); } catch { /* ignore */ }
      hud.destroy();
      wrap.remove();
      host.style.position = prevPos;
      resolve(r);
    };
    const onSkip = () => finish(skipped);
    host.addEventListener('moment-skip', onSkip);
    if (skipRequested) { finish(skipped); return; }

    const startResolution = (r: Resolution) => {
      res = r;
      phase = 'resolve';
      rt = 0;
      hud.timerOn(false);
      hud.hideInstruction();
      scene.hint = null;
    };

    const startAction = () => {
      phase = 'action';
      hud.shrinkInstruction(scene.cam.dir === 1);
      hud.timerOn(true);
      scene.zoomTarget = baseZoom();
    };

    const atOf = (ts: number) => at + Math.max(-0.1, Math.min(0.1, (ts - lastFrameNow) / 1000));

    tracker.onDown = (p) => {
      touched = true;
      scene.trail = [{ x: p.x, y: p.y }];
      scene.trailFade = 0;
    };
    tracker.onMove = (p) => {
      scene.trail.push({ x: p.x, y: p.y });
      if (scene.trail.length > 40) scene.trail.shift();
    };
    tracker.onGesture = (g: Gesture) => {
      scene.trailFade = 1;
      // an eager swipe during the intro starts the action right away (timing moments still wait)
      if (phase === 'intro' && introT > 0.35 && script.input === 'swipe' && g.type === 'swipe') startAction();
      if (phase !== 'action' || locked || res) return;
      if (g.type === 'none') return;
      if (script.input === 'tap' && g.type !== 'tap') return;
      if (script.input === 'swipe' && g.type !== 'swipe') {
        if (g.type === 'tap') hud.showGrade(swipeNudge(spec.kind), '#ffffff');
        return;
      }
      const when = g.type === 'tap' ? atOf(g.t) : atOf(g.t);
      const r = script.gesture(g, when);
      if (r === 'lock') { locked = true; hud.timerOn(false); scene.hint = null; }
      else if (r) startResolution(r);
    };

    const loop = () => {
      const now = performance.now();
      const dtReal = Math.min(0.05, Math.max(0, app.ticker.deltaMS / 1000));
      lastFrameNow = now;
      if (slowLeft > 0) {
        slowLeft -= dtReal;
        timeScale = slowLeft > 0 ? tuning.slowMoScale : 1;
        if (slowLeft <= 0) scene.zoomTarget = baseZoom();
      }
      const dt = dtReal * timeScale;

      if (phase === 'intro') {
        introT += dtReal;
        script.intro?.(dt);
        scene.hint = script.hint();
        if (introT >= tuning.introSeconds) startAction();
      } else if (phase === 'action') {
        at += dt;
        const h = !touched && !locked ? script.hint() : null;
        scene.hint = h ? { ...h, alpha: h.alpha * clamp01(1 - (at - 1.5) / 0.5) } : null;
        const r = script.tick(dt, at);
        if (r) startResolution(r);
        else if (!locked && at >= script.timeLimit) startResolution(script.timeout(at));
        else if (locked && at >= script.timeLimit + 1.5) startResolution(script.timeout(at));
        if (phase === 'action') hud.setTimer(1 - at / script.timeLimit);
      } else if (phase === 'resolve' && res) {
        rt += dt;
        if (!slowDone && res.slowmoAt !== undefined && rt >= res.slowmoAt - 0.1) {
          slowDone = true;
          if (!reducedMotion) { slowLeft = tuning.slowMoSeconds; timeScale = tuning.slowMoScale; scene.zoomTarget = baseZoom() * 1.1; }
        }
        const done = res.play(dt, rt);
        if (done || rt > 5) {
          phase = 'result';
          resultT = 0;
          slowLeft = 0; timeScale = 1; scene.zoomTarget = baseZoom();
          const txt = res.text ?? resultText(spec.kind, res.success, res.reason);
          const sub = res.sub ?? qualityLine(res);
          hud.showResult(txt, res.success ? 'good' : 'bad', sub);
        }
      } else if (phase === 'result' && res) {
        resultT += dtReal;
        res.play(dt, rt += dt);
        if (resultT >= tuning.resultSeconds) {
          finish({ momentId: spec.id, success: res.success, quality: Math.round(clamp01(res.quality) * 100) / 100, skipped: false });
          return;
        }
      }

      scene.update(dtReal, dt);
      const ra = ctx.rivalActor;
      if (ra && ra.visible && phase !== 'result') {
        const p = scene.p(ra.x, ra.z, ra.h + 2.2);
        hud.nameTag(spec.opponentName || null, p.sx, p.sy);
      } else hud.nameTag(null);
      scene.draw();
    };

    const baseZoom = () => (spec.context.lateClose && !reducedMotion ? 1.07 : 1);

    app.ticker.add(loop);
    app.ticker.start();
  });
}

function swipeNudge(kind: MomentKind): string {
  return kind === 'save' || kind === 'penalty' ? 'החלק כדי לזנק' : 'החלק, אל תקיש';
}

function qualityLine(r: Resolution): string {
  if (!r.success) return r.reason === 'frozen' || r.reason === 'hesitated' ? 'לא הגבת בזמן' : '';
  if (r.quality >= 0.88) return 'ביצוע מושלם';
  if (r.quality >= 0.72) return 'ביצוע מצוין';
  return '';
}

/** Fallback when the player never gets to act (exported for the engine / tests). */
export function frozenResult(spec: MomentSpec): MomentResult {
  const o = noInputResult(spec.kind);
  return { momentId: spec.id, success: o.success, quality: o.quality, skipped: false };
}
