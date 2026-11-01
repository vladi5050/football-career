// Tactical whiteboard (SVG, no Pixi): pitch markings in marker, glossy team magnets, a ball, dashed
// run / pressure arrows, and a tiny timeline animator for the choreography steps of a decision.
import type { Arrow, MagnetDef, Pt, Step, Target, Variant } from './types';

const NS = 'http://www.w3.org/2000/svg';
const GOAL_L = 44, GOAL_R = 56, GOAL_Y = 3.6;

export interface BoardColors { user: [string, string]; opp: [string, string] }
export const DEFAULT_BOARD_COLORS: BoardColors = { user: ['#1E4FD8', '#FFFFFF'], opp: ['#D7263D', '#FFFFFF'] };

// ------------------------------------------------------------------ colour helpers

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = (hex: string) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const shade = (hex: string, k: number) => {
  const [r, g, b] = rgb(hex);
  const f = (c: number) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

/** Pick magnet fills for both teams (and both keepers) that read apart on the board (and are not board-white). */
export function teamFills(c: BoardColors): { u: string; o: string; gkU: string; gkO: string } {
  const pick = (p: [string, string]) => (lum(p[0]) > 0.86 && lum(p[1]) < 0.86 ? p[1] : p[0]);
  const u = pick(c.user);
  let o = pick(c.opp);
  if (dist(u, o) < 110) o = dist(u, c.opp[1]) >= 110 && lum(c.opp[1]) <= 0.86 ? c.opp[1] : dist(u, '#D7263D') > 140 ? '#D7263D' : '#1E4FD8';
  const KEEPERS = ['#F2C230', '#2F9E57', '#F28C28', '#7B3FB8', '#14B8C4', '#E04FA0'];
  const far = (avoid: string[]) => KEEPERS.reduce((best, k) => {
    const sc = Math.min(...avoid.map((a) => dist(k, a)));
    return sc > best.sc ? { k, sc } : best;
  }, { k: KEEPERS[0], sc: -1 }).k;
  const gkO = far([u, o]);
  const gkU = far([u, o, gkO]);
  return { u, o, gkU, gkO };
}

// ------------------------------------------------------------------ geometry

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

interface Obj {
  id: string;
  el: SVGGElement;
  body?: SVGGElement;
  shadow?: SVGEllipseElement;
  p: Pt;
  p0: Pt;
  r: number;
  /** current pose state */
  pose?: Step['pose'];
  poseK: number;
  ang: number;
  lift: number;
}

export interface BoardOptions {
  colors?: BoardColors;
  /** label on the user's magnet (shirt number) */
  userLabel?: string;
  reducedMotion?: boolean;
}

export class Board {
  readonly svg: SVGSVGElement;
  private objs = new Map<string, Obj>();
  private ball!: Obj;
  private planLayer: SVGGElement;
  private arrowLayer: SVGGElement;
  private net: SVGGElement;
  private v: Variant;
  private side: 1 | -1;
  private raf = 0;
  private killed = false;
  crop: { x: number; y: number; w: number; h: number };

  constructor(v: Variant, private opts: BoardOptions = {}) {
    this.v = v;
    // ball side: >50 = right channel (near post is the right one)
    this.side = v.ball[0] > 50 ? 1 : -1;
    const fills = teamFills(opts.colors ?? DEFAULT_BOARD_COLORS);
    this.crop = cropFor(v);
    const { x: cx, y: cy, w: cw, h: ch } = this.crop;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `${cx.toFixed(2)} ${cy} ${cw.toFixed(2)} ${ch.toFixed(2)}`);
    svg.setAttribute('class', 'dm-svg');
    svg.setAttribute('preserveAspectRatio', 'xMidYMin meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'לוח טקטי');
    svg.innerHTML = `
<defs>
  <pattern id="dmGrid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0H0V5" fill="none" stroke="rgba(30,79,216,.10)" stroke-width=".25"/></pattern>
  <radialGradient id="dmGloss" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient>
  <radialGradient id="dmBall" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#e9ecef"/><stop offset="1" stop-color="#9aa3ad"/></radialGradient>
  <filter id="dmGlow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="1.1"/></filter>
  <filter id="dmSoft" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation=".45"/></filter>
  ${['run', 'press', 'pass', 'plan'].map((k) => `<marker id="dmHead-${k}" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="${k === 'plan' ? 3.4 : 3.6}" markerHeight="${k === 'plan' ? 3.4 : 3.6}" orient="auto-start-reverse"><path d="M1 1 L8 5 L1 9" fill="none" stroke="${ARROW_COL[k]}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></marker>`).join('')}
</defs>
<rect x="-80" y="-80" width="260" height="300" fill="#ECEFEA"/>
<rect x="-80" y="-80" width="260" height="300" fill="url(#dmGrid)"/>
<g class="dm-lines" fill="none" stroke="rgba(27,42,74,.42)" stroke-width=".42" stroke-linecap="round">
  <path d="M-5.5 ${GOAL_Y} H105.5"/>
  <rect x="17" y="${GOAL_Y}" width="66" height="27"/>
  <rect x="35" y="${GOAL_Y}" width="30" height="9"/>
  <circle cx="50" cy="21.6" r=".55" fill="rgba(27,42,74,.5)" stroke="none"/>
  <path d="M38.3 30.6 A15 15 0 0 0 61.7 30.6"/>
  <path d="M-5.5 89.6 H105.5"/><circle cx="50" cy="89.6" r="15"/><circle cx="50" cy="89.6" r=".6" fill="rgba(27,42,74,.5)" stroke="none"/><path d="M-5.5 ${GOAL_Y} V180 M105.5 ${GOAL_Y} V180"/>
  <path d="M-5.5 ${GOAL_Y + 1.6} a1.6 1.6 0 0 0 1.6 -1.6 M105.5 ${GOAL_Y + 1.6} a1.6 1.6 0 0 1 -1.6 -1.6" />
</g>
<g class="dm-net">
  <rect x="${GOAL_L}" y="-0.6" width="${GOAL_R - GOAL_L}" height="${GOAL_Y + 0.6}" fill="rgba(27,42,74,.06)"/>
  <path d="${netPath()}" stroke="rgba(27,42,74,.28)" stroke-width=".18" fill="none"/>
  <path d="M${GOAL_L} ${GOAL_Y} V-0.6 H${GOAL_R} V${GOAL_Y}" fill="none" stroke="#1b2a4a" stroke-width=".7" stroke-linejoin="round"/>
</g>
<g class="dm-arrows"></g>
<g class="dm-plan"></g>
<g class="dm-mags"></g>
<g class="dm-ballL"></g>`;
    this.svg = svg;
    this.arrowLayer = svg.querySelector('.dm-arrows') as SVGGElement;
    this.planLayer = svg.querySelector('.dm-plan') as SVGGElement;
    this.net = svg.querySelector('.dm-net') as SVGGElement;
    const mags = svg.querySelector('.dm-mags') as SVGGElement;

    // magnets: opponents first, then ours, the user's last (on top)
    const order = [...v.magnets].sort((a, b) => rank(a) - rank(b));
    for (const m of order) mags.appendChild(this.makeMagnet(m, fills));

    // ball
    const bl = svg.querySelector('.dm-ballL') as SVGGElement;
    const bg = document.createElementNS(NS, 'g');
    bg.setAttribute('class', 'dm-ball');
    bg.innerHTML = `<ellipse class="sh" cx=".35" cy=".55" rx="1.35" ry=".95" fill="rgba(15,25,45,.35)" filter="url(#dmSoft)"/>
<g class="bd"><circle r="1.35" fill="url(#dmBall)" stroke="#1b2a4a" stroke-width=".22"/>
<path d="M0 -.55 L.52 -.17 L.32 .45 L-.32 .45 L-.52 -.17Z" fill="#1b2a4a"/>
<path d="M0 -.55 V-1.3 M.52 -.17 L1.25 -.4 M.32 .45 L.78 1.06 M-.32 .45 L-.78 1.06 M-.52 -.17 L-1.25 -.4" stroke="#1b2a4a" stroke-width=".16"/></g>`;
    bl.appendChild(bg);
    const bp = this.ballSpot(v);
    this.ball = { id: 'ball', el: bg, body: bg.querySelector('.bd') as SVGGElement, shadow: bg.querySelector('.sh') as SVGEllipseElement, p: [...bp] as Pt, p0: [...bp] as Pt, r: 1.35, poseK: 0, ang: 0, lift: 0 };
    this.objs.set('ball', this.ball);

    for (const a of v.arrows) this.arrowLayer.appendChild(this.makeArrow(a));
    this.renderAll();
  }

  private makeMagnet(m: MagnetDef, fills: ReturnType<typeof teamFills>): SVGGElement {
    const me = m.id === 'me';
    const wall = m.id.startsWith('w');
    const r = me ? 3.5 : wall ? 2.05 : 2.9;
    let fill = m.team === 'u' ? fills.u : fills.o;
    if (m.gk && !me) fill = m.team === 'u' ? fills.gkU : fills.gkO;
    const ink = lum(fill) > 0.62 ? '#1b2a4a' : '#ffffff';
    const label = me ? (this.opts.userLabel ?? '★') : m.n !== undefined ? String(m.n) : m.gk ? '1' : '';
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', `dm-mag${me ? ' me' : ''}${m.team === 'u' ? ' u' : ' o'}`);
    g.dataset.id = m.id;
    g.innerHTML = `${me ? `<circle class="halo" r="${r + 2.6}" fill="#F2C230" opacity=".55" filter="url(#dmGlow)"/>` : ''}
<ellipse class="sh" cx=".5" cy=".9" rx="${r}" ry="${r * 0.82}" fill="rgba(15,25,45,.38)" filter="url(#dmSoft)"/>
<g class="bd">
  <circle r="${r}" fill="${shade(fill, -0.38)}"/>
  <circle r="${r * 0.9}" cy="-.18" fill="${fill}"/>
  <circle r="${r * 0.9}" cy="-.18" fill="url(#dmGloss)"/>
  <ellipse cx="${-r * 0.32}" cy="${-r * 0.48}" rx="${r * 0.38}" ry="${r * 0.2}" fill="#fff" opacity=".55" transform="rotate(-28 ${-r * 0.32} ${-r * 0.48})"/>
  ${me ? `<circle r="${r + 0.55}" fill="none" stroke="#F2C230" stroke-width=".7"/>` : ''}
</g>
${label ? `<text y="${r * 0.36 - 0.1}" text-anchor="middle" font-size="${me ? 3.1 : wall ? 0 : 2.5}" font-weight="800" fill="${ink}" font-family="Assistant, system-ui, sans-serif" letter-spacing="-.1">${label}</text>` : ''}`;
    const o: Obj = { id: m.id, el: g, body: g.querySelector('.bd') as SVGGElement, shadow: g.querySelector('.sh') as SVGEllipseElement, p: [m.x, m.y], p0: [m.x, m.y], r, poseK: 0, ang: 0, lift: 0 };
    this.objs.set(m.id, o);
    return g;
  }

  /** Keep the ball at the feet of the nearest magnet, not under its label. */
  private ballSpot(v: Variant): Pt {
    let best: Obj | undefined, bd = 1e9;
    for (const o of this.objs.values()) {
      const d = Math.hypot(o.p0[0] - v.ball[0], o.p0[1] - v.ball[1]);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best || bd >= best.r + 1.4) return [...v.ball] as Pt;
    const dx = v.ball[0] - best.p0[0], dy = v.ball[1] - best.p0[1];
    const L = Math.hypot(dx, dy) || 1;
    const k = best.r + 1.5;
    return [best.p0[0] + (dx / L) * k, best.p0[1] + (dy / L) * k];
  }

  private makeArrow(a: Arrow): SVGPathElement {
    const from = this.resolve(a.from, true);
    const to = this.resolve(a.to, true);
    const fr = typeof a.from === 'string' && this.objs.has(a.from) ? this.objs.get(a.from)!.r + 0.9 : 0.5;
    const tr = typeof a.to === 'string' && this.objs.has(a.to) ? this.objs.get(a.to)!.r + 1.6 : 1.2;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', curve(from, to, a.bend ?? 0, fr, tr));
    path.setAttribute('class', `dm-arrow ${a.kind}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', ARROW_COL[a.kind]);
    path.setAttribute('stroke-width', a.kind === 'pass' ? '.55' : '.85');
    path.setAttribute('stroke-dasharray', a.kind === 'run' ? '2.4 1.6' : a.kind === 'press' ? '1.3 1.1' : '.7 1.1');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('marker-end', `url(#dmHead-${a.kind})`);
    return path;
  }

  /** Re-frame the camera for the board's on-screen aspect (height / width). */
  fit(aspect: number): void {
    if (!(aspect > 0)) return;
    this.crop = cropFor(this.v, aspect);
    const c = this.crop;
    this.svg.setAttribute('viewBox', `${c.x.toFixed(2)} ${c.y} ${c.w.toFixed(2)} ${c.h.toFixed(2)}`);
  }

  /** Board position of a target. `initial` = use the magnets' starting spots. */
  resolve(t: Target, initial = false, who?: Obj): Pt {
    const posOf = (id: string): Pt => {
      const o = this.objs.get(id);
      if (!o) return [50, 50];
      return initial ? o.p0 : o.p;
    };
    if (Array.isArray(t)) return [t[0], t[1]];
    if (typeof t === 'string') return this.objs.has(t) ? [...posOf(t)] as Pt : this.named(t, who);
    if ('id' in t) { const p = posOf(t.id); return [p[0] + (t.dx ?? 0), p[1] + (t.dy ?? 0)]; }
    const p = this.named(t.p, who);
    return [p[0] + (t.dx ?? 0), p[1] + (t.dy ?? 0)];
  }

  private named(name: string, who?: Obj): Pt {
    const s = this.side;
    const near = 50 + s * 5.2, far = 50 - s * 5.2;
    const cur = who?.p ?? this.ball.p;
    switch (name) {
      case 'far': return [far, 1.6];
      case 'farLow': return [far + s * 0.4, 2.2];
      case 'near': return [near, 1.8];
      case 'nearTop': return [near - s * 0.2, 1.2];
      case 'farShort': return [far + s * 2.6, 4.4];
      case 'nearShort': return [near - s * 2.4, 4.4];
      case 'nearWide': return [near + s * 3.6, -2.5];
      case 'farWide': return [far - s * 3.8, -2.5];
      case 'over': return [50 - s * 2, -6.2];
      case 'GC': return [50, 4.4];
      case 'GL': return [GOAL_L + 0.8, 4.2];
      case 'GR': return [GOAL_R - 0.8, 4.2];
      case 'up': return [this.crop.x + this.crop.w / 2, this.crop.y + this.crop.h - 4];
      case 'upL': return [this.crop.x + this.crop.w * 0.22, this.crop.y + this.crop.h - 5];
      case 'upR': return [this.crop.x + this.crop.w * 0.78, this.crop.y + this.crop.h - 5];
      case 'outL': return [this.crop.x - 3, cur[1]];
      case 'outR': return [this.crop.x + this.crop.w + 3, cur[1]];
      case 'ballPt': return [...(this.ball?.p0 ?? this.v.ball)] as Pt;
      case 'lane': {
        const a = this.objs.get('s1')?.p0 ?? this.v.ball;
        const b = this.objs.get('s2')?.p0 ?? [50, 30];
        return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      }
      default: return [50, 50];
    }
  }

  /** Draw the intended play (the success choreography) as a marker arrow. Resolves when drawn. */
  drawPlan(steps: Step[], ms: number): Promise<void> {
    this.planLayer.innerHTML = '';
    this.svg.classList.add('picked');
    const ballPts: Pt[] = [[...this.ball.p0] as Pt];
    const mePts: Pt[] = [];
    const meObj = this.objs.get('me');
    for (const s of [...steps].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))) {
      if (s.w === 'ball') {
        const p = this.resolve(s.to, true);
        const last = ballPts[ballPts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 2.5) ballPts.push(p);
      } else if (s.w === 'me' && meObj) {
        mePts.push(this.resolve(s.to, true));
      }
    }
    const paths: SVGPathElement[] = [];
    if (meObj && mePts.length) {
      const pts = [meObj.p0, ...mePts];
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(' ');
      paths.push(this.planPath(d, 'run', '.75'));
    }
    if (ballPts.length > 1) {
      let d = `M${ballPts[0][0].toFixed(2)} ${ballPts[0][1].toFixed(2)}`;
      for (let i = 1; i < ballPts.length; i++) {
        const a = ballPts[i - 1], b = ballPts[i];
        const bend = Math.min(5, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12) * (i % 2 ? 1 : -1);
        d += ' ' + curve(a, b, bend, i === 1 ? 1.6 : 0, i === ballPts.length - 1 ? 1.2 : 0).replace(/^M[^Q]+/, '');
      }
      paths.push(this.planPath(d, 'plan', '1.05'));
    }
    if (this.opts.reducedMotion || ms <= 0) return Promise.resolve();
    for (const p of paths) {
      const len = p.getTotalLength?.() ?? 60;
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
      p.getBoundingClientRect();
      p.style.transition = `stroke-dashoffset ${ms}ms cubic-bezier(.45,.05,.3,1)`;
      p.style.strokeDashoffset = '0';
    }
    return new Promise((res) => setTimeout(res, ms));
  }

  private planPath(d: string, kind: 'run' | 'plan', w: string): SVGPathElement {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', `dm-plan-path ${kind}`);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', ARROW_COL[kind]);
    p.setAttribute('stroke-width', w);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('marker-end', `url(#dmHead-${kind})`);
    this.planLayer.appendChild(p);
    return p;
  }

  /** Fade the plan/arrows back while the action runs. */
  dimGuides(): void { this.svg.classList.add('acting'); }

  /** Run a choreography; `speed` > 1 is faster. Resolves at the end (instantly in reduced motion). */
  play(steps: Step[], speed = 1): Promise<{ inNet: boolean }> {
    const runs = steps
      .map((s, i) => ({ s, i, at: s.at ?? 0, d: Math.max(0.05, s.d ?? 0.5), o: s.w === 'ball' ? this.ball : this.objs.get(s.w), from: [0, 0] as Pt, to: [0, 0] as Pt, started: false, done: false }))
      .filter((r) => r.o)
      .sort((a, b) => a.at - b.at || a.i - b.i);
    const end = runs.reduce((m, r) => Math.max(m, r.at + r.d), 0);

    const start = (r: (typeof runs)[number]) => {
      const o = r.o!;
      r.from = [...o.p] as Pt;
      r.to = this.resolve(r.s.to, true, o);
      // a goal-mouth target resolved for a magnet moves the body, not the ball
      r.started = true;
      if (r.s.pose && r.s.pose !== 'jump') { o.pose = undefined; o.poseK = 0; }
      const dx = r.to[0] - r.from[0], dy = r.to[1] - r.from[1];
      if (Math.hypot(dx, dy) > 0.3) o.ang = Math.atan2(dy, dx) * 180 / Math.PI;
    };
    const apply = (r: (typeof runs)[number], u: number) => {
      const o = r.o!;
      const e = o === this.ball ? easeOut(u) : easeInOut(u);
      o.p = [lerp(r.from[0], r.to[0], e), lerp(r.from[1], r.to[1], e)];
      if (o === this.ball) o.lift = (r.s.arc ?? 0) * Math.sin(Math.PI * u);
      if (r.s.pose === 'jump') { o.pose = 'jump'; o.poseK = Math.sin(Math.PI * u); }
      else if (r.s.pose) { o.pose = r.s.pose; o.poseK = clamp01((u - 0.35) / 0.65); }
    };
    const finish = () => {
      for (const r of runs) { if (!r.started) start(r); apply(r, 1); r.done = true; }
      this.ball.lift = 0;
      this.renderAll();
    };

    const inNet = () => { const [x, y] = this.ball.p; return y < GOAL_Y - 0.3 && y > -1.5 && x > GOAL_L && x < GOAL_R; };

    if (this.opts.reducedMotion) {
      finish();
      const n = inNet();
      if (n) this.net.classList.add('hit');
      return Promise.resolve({ inNet: n });
    }
    return new Promise((res) => {
      const t0 = performance.now();
      let netHit = false;
      const tick = (now: number) => {
        if (this.killed) { res({ inNet: false }); return; }
        const t = ((now - t0) / 1000) * speed;
        for (const r of runs) {
          if (r.done || t < r.at) continue;
          if (!r.started) start(r);
          const u = clamp01((t - r.at) / r.d);
          apply(r, u);
          if (u >= 1) r.done = true;
        }
        this.renderAll();
        if (!netHit && inNet()) { netHit = true; this.net.classList.add('hit'); this.svg.classList.add('shake'); }
        if (t >= end) { finish(); res({ inNet: netHit || inNet() }); return; }
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  private renderAll(): void {
    for (const o of this.objs.values()) this.renderObj(o);
  }

  private renderObj(o: Obj): void {
    o.el.setAttribute('transform', `translate(${o.p[0].toFixed(2)} ${(o.p[1] - (o === this.ball ? o.lift * 0.5 : 0)).toFixed(2)})`);
    if (o === this.ball) {
      const s = 1 + o.lift * 0.05;
      o.body?.setAttribute('transform', `scale(${s.toFixed(3)}) rotate(${((o.p[0] + o.p[1]) * 40).toFixed(1)})`);
      o.shadow?.setAttribute('transform', `translate(${(o.lift * 0.25).toFixed(2)} ${(o.lift * 0.5).toFixed(2)}) scale(${(1 - Math.min(0.5, o.lift * 0.04)).toFixed(3)})`);
      o.shadow?.setAttribute('opacity', (1 - Math.min(0.6, o.lift * 0.05)).toFixed(2));
      return;
    }
    if (!o.body) return;
    const k = o.poseK;
    let tf = '';
    if (o.pose === 'dive') tf = `rotate(${o.ang.toFixed(1)}) scale(${(1 + 0.55 * k).toFixed(3)} ${(1 - 0.28 * k).toFixed(3)})`;
    else if (o.pose === 'slide') tf = `rotate(${o.ang.toFixed(1)}) scale(${(1 + 0.4 * k).toFixed(3)} ${(1 - 0.2 * k).toFixed(3)})`;
    else if (o.pose === 'down') tf = `rotate(${o.ang.toFixed(1)}) scale(${(1 + 0.3 * k).toFixed(3)} ${(1 - 0.3 * k).toFixed(3)})`;
    else if (o.pose === 'jump') tf = `scale(${(1 + 0.28 * k).toFixed(3)})`;
    o.body.setAttribute('transform', tf);
    o.shadow?.setAttribute('transform', o.pose === 'jump' ? `translate(${(k * 1.2).toFixed(2)} ${(k * 1.8).toFixed(2)})` : '');
    o.el.style.opacity = o.pose === 'down' ? String(1 - 0.25 * k) : '';
  }

  destroy(): void {
    this.killed = true;
    cancelAnimationFrame(this.raf);
    this.svg.remove();
  }
}

const ARROW_COL: Record<string, string> = { run: '#1E4FD8', press: '#D7263D', pass: 'rgba(27,42,74,.6)', plan: '#D7263D' };

/** Camera crop: everything that matters plus the goal, padded, with a phone-friendly aspect. */
export function cropFor(v: Variant, aspect = 0.9): { x: number; y: number; w: number; h: number } {
  const field = v.magnets.filter((m) => !m.gk || m.id === 'me');
  const top = Math.min(v.ball[1], ...field.map((m) => m.y));
  // near the box: keep the goal (and keeper) in shot; in midfield: frame the action
  const withGoal = top < 44;
  const pts: Pt[] = [v.ball, ...(withGoal ? v.magnets : field).map((m) => [m.x, m.y] as Pt)];
  for (const a of v.arrows) if (Array.isArray(a.to)) pts.push(a.to as Pt);
  let x0 = Math.min(withGoal ? 41 : 100, ...pts.map((p) => p[0])) - 8;
  let x1 = Math.max(withGoal ? 59 : 0, ...pts.map((p) => p[0])) + 8;
  let y0 = withGoal ? -7 : top - 10;
  let y1 = Math.max(...pts.map((p) => p[1])) + 9;
  let w = x1 - x0, h = y1 - y0;
  const MINW = 50;
  if (w < MINW) { const c = (x0 + x1) / 2; x0 = c - MINW / 2; x1 = c + MINW / 2; w = MINW; }
  const A = Math.max(0.6, Math.min(1.6, aspect));
  if (h / w < A) {
    const nh = w * A;
    if (withGoal) y1 = y0 + nh;
    else { const c = (y0 + y1) / 2; y0 = Math.max(-7, c - nh / 2); y1 = y0 + nh; }
    h = nh;
  } else if (h / w > A) {
    const nw = Math.min(112, h / A);
    const c = (x0 + x1) / 2;
    x0 = c - nw / 2; x1 = c + nw / 2; w = nw;
  }
  const L = -7, R = 107;
  if (x0 < L) { x1 = Math.min(R, x1 + L - x0); x0 = L; }
  if (x1 > R) { x0 = Math.max(L, x0 - (x1 - R)); x1 = R; }
  w = x1 - x0;
  return { x: x0, y: y0, w, h: Math.max(h, w * A) };
}

function rank(m: MagnetDef): number {
  if (m.id === 'me') return 3;
  return m.team === 'o' ? 0 : 1;
}

/** Quadratic marker curve from a to b, trimmed at both ends, bent sideways by `bend`. */
function curve(a: Pt, b: Pt, bend: number, trimA: number, trimB: number): string {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const ta = Math.min(trimA, L * 0.3), tb = Math.min(trimB, L * 0.3);
  const s: Pt = [a[0] + ux * ta, a[1] + uy * ta];
  const e: Pt = [b[0] - ux * tb, b[1] - uy * tb];
  const c: Pt = [(s[0] + e[0]) / 2 - uy * bend, (s[1] + e[1]) / 2 + ux * bend];
  return `M${s[0].toFixed(2)} ${s[1].toFixed(2)} Q${c[0].toFixed(2)} ${c[1].toFixed(2)} ${e[0].toFixed(2)} ${e[1].toFixed(2)}`;
}

function netPath(): string {
  let d = '';
  for (let x = GOAL_L + 1.5; x < GOAL_R; x += 1.5) d += `M${x} -0.6 V${GOAL_Y} `;
  for (let y = 0.6; y < GOAL_Y; y += 1.2) d += `M${GOAL_L} ${y} H${GOAL_R} `;
  return d;
}
