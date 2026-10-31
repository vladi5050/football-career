// Pixi renderer for key moments: broadcast pitch, goal + net, player tokens, ball, FX.
// Immediate-mode: a handful of Graphics layers are cleared and redrawn each frame from plain state.
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { project, unproject, lerpCam, zoomCam, type Cam, type Screen, type Proj } from './camera';
import { BAR, GOAL_HALF, NET_DEPTH, BALL_R, clamp, clamp01, lerp, makeRng, type Rng } from './sim';

export type Team = 'user' | 'mate' | 'opp';
export type Pose = 'stand' | 'run' | 'kick' | 'dive' | 'slide' | 'jump' | 'celebrate' | 'down' | 'header';

export interface Actor {
  id: string;
  team: Team;
  gk: boolean;
  x: number; z: number; h: number;
  tx: number; tz: number; speed: number; // move target
  pose: Pose;
  poseT: number; // seconds in pose
  diveX: number; // dive / slide world target x (for direction)
  phase: number; // run cycle
  moving: number; // 0..1 smoothed
  lean: number; // -1..1 screen lean
  /** apex height (m) for automatic dive / jump arcs */
  lift: number;
  mark: 'none' | 'user' | 'rival' | 'target';
  kit: [number, number];
  skin: number;
  hair: number;
  visible: boolean;
}

export interface BallVis { x: number; z: number; h: number; rot: number; visible: boolean; glow: number }

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number; g: number; kind: 'dot' | 'rect' | 'streak' }
interface NetHit { x: number; h: number; t: number; amp: number }
export interface Ring { x: number; z: number; r0: number; r1: number; t0: number; dur: number; color: number; hot: boolean; screen?: boolean; kind: 'shrink' | 'pulse' }
export interface Lane { x0: number; z0: number; x1: number; z1: number; color: number; alpha: number; width: number; dashed: boolean }
export interface Hint { kind: 'swipe' | 'tap'; x0: number; y0: number; x1: number; y1: number; bend: number; alpha: number }

export interface SceneOpts {
  colors: { user: [string, string]; opp: [string, string] };
  rain: boolean;
  hostile: boolean;
  lateClose: boolean;
  reducedMotion: boolean;
  seed: number;
}

export function hex(c: string | number): number {
  if (typeof c === 'number') return c;
  const s = c.replace('#', '');
  const full = s.length === 3 ? s.split('').map((ch) => ch + ch).join('') : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}
function rgb(n: number): [number, number, number] { return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(a: number, b: number, u: number): number {
  const [ar, ag, ab] = rgb(a); const [br, bg, bb] = rgb(b);
  return (Math.round(lerp(ar, br, u)) << 16) | (Math.round(lerp(ag, bg, u)) << 8) | Math.round(lerp(ab, bb, u));
}
function colorDist(a: number, b: number): number { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }

const SKINS = [0xf1c8a5, 0xe0ac85, 0xc68c64, 0x9a6440, 0x6e4528, 0xf6d6bd];
const HAIRS = [0x1d140e, 0x3b2716, 0x6b4a2b, 0x0d0d0d, 0xb08a4a];
const GK_USER = 0xf5c518;
const GK_OPP = 0x23c26b;
const GRASS_A = 0x2f8f3a;
const GRASS_B = 0x2a8034;

export class Scene {
  readonly app: Application;
  readonly opts: SceneOpts;
  readonly screen: Screen;
  readonly root = new Container();
  private bg = new Graphics();
  private stands: Sprite;
  private standsTex: Texture;
  private ground = new Graphics();
  private shadows = new Graphics();
  private bodies = new Graphics();
  private fx = new Graphics();
  private ui = new Graphics();
  private rng: Rng;

  cam: Cam;
  private camFrom: Cam;
  private camTo: Cam;
  private camT = 1;
  private camDur = 1;
  zoom = 1;
  zoomTarget = 1;
  /** when set (and no scripted ease is running) the camera glides toward this framing */
  followCam: Cam | null = null;

  actors: Actor[] = [];
  ball: BallVis = { x: 0, z: 10, h: 0, rot: 0, visible: true, glow: 0 };
  private ballHist: { x: number; z: number; h: number }[] = [];
  rings: Ring[] = [];
  lanes: Lane[] = [];
  hint: Hint | null = null;
  trail: { x: number; y: number }[] = [];
  trailFade = 0;
  wall: { x0: number; x1: number; z: number } | null = null;
  private particles: Particle[] = [];
  private netHits: NetHit[] = [];
  private rainDrops: { x: number; y: number; s: number }[] = [];
  private shakeAmp = 0;
  private crowdPulse = 0;
  time = 0;
  flashA = 0;
  private kits: { user: [number, number]; opp: [number, number] };

  constructor(app: Application, opts: SceneOpts, cam: Cam) {
    this.app = app;
    this.opts = opts;
    this.screen = { w: app.screen.width, h: app.screen.height };
    this.rng = makeRng(opts.seed * 7 + 3);
    this.cam = cam; this.camFrom = cam; this.camTo = cam;
    let user: [number, number] = [hex(opts.colors.user[0]), hex(opts.colors.user[1])];
    let opp: [number, number] = [hex(opts.colors.opp[0]), hex(opts.colors.opp[1])];
    // keep the two teams readable: if primaries clash, the opponent wears its second colour
    if (colorDist(user[0], opp[0]) < 90) opp = [opp[1], opp[0]];
    if (colorDist(user[0], opp[0]) < 90) opp = [0xf2f2f2, 0x222222];
    if (colorDist(user[0], GRASS_A) < 70) user = [user[1], user[0]];
    this.kits = { user, opp };
    this.standsTex = this.buildStandsTexture();
    this.stands = new Sprite(this.standsTex);
    this.stands.anchor.set(0.5, 1);
    this.root.addChild(this.bg, this.stands, this.ground, this.shadows, this.bodies, this.fx, this.ui);
    app.stage.addChild(this.root);
    if (opts.rain) {
      for (let i = 0; i < 110; i++) this.rainDrops.push({ x: this.rng() * this.screen.w, y: this.rng() * this.screen.h, s: 0.6 + this.rng() * 0.8 });
    }
  }

  // ------------------------------------------------------------------ setup helpers

  addActor(a: Partial<Actor> & { id: string; team: Team; x: number; z: number }): Actor {
    const kit: [number, number] = a.gk ? [a.team === 'opp' ? GK_OPP : GK_USER, 0x1a1a1a] : a.team === 'opp' ? this.kits.opp : this.kits.user;
    const act: Actor = {
      gk: false, h: 0, tx: a.x, tz: a.z, speed: 0, pose: 'stand', poseT: 0, diveX: a.x, phase: this.rng() * 6, moving: 0, lean: 0, lift: 0,
      mark: 'none', kit, skin: SKINS[Math.floor(this.rng() * SKINS.length)], hair: HAIRS[Math.floor(this.rng() * HAIRS.length)], visible: true,
      ...a,
    } as Actor;
    this.actors.push(act);
    return act;
  }

  moveTo(a: Actor, x: number, z: number, speed: number): void { a.tx = x; a.tz = z; a.speed = speed; }
  setPose(a: Actor, p: Pose, diveX?: number): void {
    if (a.pose !== p) {
      a.pose = p; a.poseT = 0;
      a.lift = p === 'dive' ? (a.gk ? 0.75 : 0.3) : p === 'jump' ? 0.45 : p === 'header' ? 0.6 : 0;
    }
    if (diveX !== undefined) a.diveX = diveX;
  }

  setCamera(target: Cam, dur: number): void {
    if (dur <= 0 || this.opts.reducedMotion) { this.cam = target; this.camFrom = target; this.camTo = target; this.camT = 1; return; }
    this.camFrom = this.cam; this.camTo = target; this.camT = 0; this.camDur = dur;
  }

  p(x: number, z: number, h = 0): Proj { return project(this.view, this.screen, x, z, h); }
  ground2world(sx: number, sy: number): { x: number; z: number } | null { return unproject(this.view, this.screen, sx, sy); }

  /** effective camera incl. zoom */
  get view(): Cam { return this.zoom === 1 ? this.cam : zoomCam(this.cam, this.screen, this.zoom, 0.55); }

  shake(amp: number): void { if (!this.opts.reducedMotion) this.shakeAmp = Math.max(this.shakeAmp, amp); }
  flash(a = 0.6): void { this.flashA = this.opts.reducedMotion ? Math.min(a, 0.25) : a; }

  burst(x: number, y: number, n: number, colors: number[], speed: number, opts: Partial<Pick<Particle, 'g' | 'size' | 'kind'>> & { life?: number; up?: number } = {}): void {
    if (this.opts.reducedMotion) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const v = speed * (0.35 + this.rng() * 0.65);
      const life = (opts.life ?? 0.8) * (0.6 + this.rng() * 0.6);
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (opts.up ?? 0), life, max: life,
        color: colors[i % colors.length], size: (opts.size ?? 3) * (0.6 + this.rng() * 0.8), g: opts.g ?? 400, kind: opts.kind ?? 'dot',
      });
    }
  }

  confetti(): void {
    if (this.opts.reducedMotion) return;
    const cols = [this.kits.user[0], this.kits.user[1], 0xffd84a, 0xffffff];
    for (let i = 0; i < 90; i++) {
      const life = 1.6 + this.rng() * 1.2;
      this.particles.push({ x: this.rng() * this.screen.w, y: -10 - this.rng() * 120, vx: (this.rng() - 0.5) * 60, vy: 80 + this.rng() * 120, life, max: life, color: cols[i % cols.length], size: 4 + this.rng() * 4, g: 40, kind: 'rect' });
    }
  }

  netHit(x: number, h: number, amp = 1): void { this.netHits.push({ x, h, t: 0, amp }); }

  crowdRoar(): void { this.crowdPulse = 1; }

  // ------------------------------------------------------------------ update

  update(dtReal: number, dt: number): void {
    this.time += dt;
    if (this.camT < 1) {
      this.camT = Math.min(1, this.camT + dtReal / this.camDur);
      const u = this.camT;
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.cam = lerpCam(this.camFrom, this.camTo, e);
    } else if (this.followCam) {
      const k = this.opts.reducedMotion ? 1 : 1 - Math.exp(-dtReal * 3.5);
      this.cam = lerpCam(this.cam, this.followCam, k);
    }
    this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dtReal * 3);
    for (const a of this.actors) {
      a.poseT += dt;
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      const d = Math.hypot(dx, dz);
      let mv = 0;
      if (d > 0.02 && a.speed > 0) {
        const step = Math.min(d, a.speed * dt);
        a.x += (dx / d) * step;
        a.z += (dz / d) * step;
        mv = clamp01(a.speed / 4);
      }
      a.moving += (mv - a.moving) * Math.min(1, dt * 8);
      if (a.lift > 0) {
        const dur = a.pose === 'dive' ? 0.75 : 0.6;
        const u = Math.min(1, a.poseT / dur);
        a.h = a.lift * Math.sin(u * Math.PI);
        if (a.pose === 'dive' && u >= 1) a.h = 0;
      } else if (a.pose !== 'jump' && a.pose !== 'header') a.h = Math.max(0, a.h - dt * 4);
      a.phase += dt * (6 + a.speed * 1.6) * (a.moving > 0.1 ? 1 : 0);
    }
    this.ballHist.push({ x: this.ball.x, z: this.ball.z, h: this.ball.h });
    if (this.ballHist.length > 7) this.ballHist.shift();
    for (const p of this.particles) {
      p.life -= dtReal;
      p.vy += p.g * dtReal;
      p.x += p.vx * dtReal;
      p.y += p.vy * dtReal;
      if (p.kind === 'rect') p.vx += Math.sin(this.time * 6 + p.y * 0.05) * 30 * dtReal;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const n of this.netHits) n.t += dt;
    this.netHits = this.netHits.filter((n) => n.t < 1.6);
    this.shakeAmp *= Math.pow(0.02, dtReal);
    if (this.shakeAmp < 0.2) this.shakeAmp = 0;
    this.crowdPulse *= Math.pow(0.15, dtReal);
    this.flashA *= Math.pow(0.03, dtReal);
    this.trailFade = Math.max(0, this.trailFade - dtReal * 2.5);
    if (this.opts.rain) {
      const { w, h } = this.screen;
      const fall = this.opts.reducedMotion ? 0 : 900;
      for (const r of this.rainDrops) {
        r.y += fall * r.s * dtReal;
        r.x -= fall * 0.18 * r.s * dtReal;
        if (r.y > h) { r.y = -20; r.x = this.rng() * (w + 80); }
        if (r.x < -20) r.x += w + 40;
      }
    }
    // hostile crowd: small rhythmic jolts
    if (this.opts.hostile && !this.opts.reducedMotion) {
      const beat = (this.time * 1.9) % 1;
      if (beat < 0.05) this.shakeAmp = Math.max(this.shakeAmp, 2.2);
    }
    const sx = this.shakeAmp ? (this.rng() - 0.5) * this.shakeAmp * 2 : 0;
    const sy = this.shakeAmp ? (this.rng() - 0.5) * this.shakeAmp * 2 : 0;
    this.root.position.set(sx, sy);
  }

  // ------------------------------------------------------------------ draw

  draw(): void {
    const c = this.view;
    const { w, h } = this.screen;
    this.drawBackground(c);
    this.drawGround(c);
    this.drawShadows();
    this.drawBodies(c);
    this.drawFx();
    this.drawUi();
    void w; void h;
  }

  private buildStandsTexture(): Texture {
    const g = new Graphics();
    const W = 1400; const H = 220;
    const r = makeRng(this.opts.seed + 99);
    g.rect(0, 0, W, H).fill({ color: 0x141b2b });
    // tiers
    for (let row = 0; row < 17; row++) {
      const y = H - row * 12.5;
      g.rect(0, y - 11, W, 11).fill({ color: row % 2 ? 0x1c2538 : 0x182033 });
      for (let x = 2; x < W; x += 6 + r() * 3) {
        if (r() < 0.12) continue;
        const tone = r();
        const col = tone < 0.35 ? this.kits.opp[0] : tone < 0.5 ? this.kits.opp[1] : tone < 0.62 ? this.kits.user[0] : SKINS[Math.floor(r() * SKINS.length)];
        g.rect(x, y - 9 - r() * 2, 4, 6).fill({ color: mix(col, 0x0e1424, 0.35) });
        g.circle(x + 2, y - 11 - r() * 2, 1.8).fill({ color: mix(SKINS[Math.floor(r() * SKINS.length)], 0x0e1424, 0.3) });
      }
    }
    // roof edge + lights
    g.rect(0, 0, W, 18).fill({ color: 0x0b0f19 });
    for (let x = 30; x < W; x += 110) g.rect(x, 6, 40, 5).fill({ color: 0xfdf6d8, alpha: 0.9 });
    // banners
    for (let i = 0; i < 7; i++) {
      const bx = 60 + i * 190 + r() * 40;
      const col = i % 2 ? this.kits.opp[0] : this.kits.opp[1];
      g.rect(bx, H - 70 - r() * 60, 70 + r() * 40, 14).fill({ color: col, alpha: 0.85 });
    }
    const tex = this.app.renderer.generateTexture({ target: g, resolution: 1 });
    g.destroy();
    return tex;
  }

  private drawBackground(c: Cam): void {
    const g = this.bg;
    const { w, h } = this.screen;
    g.clear();
    g.rect(0, 0, w, h).fill({ color: 0x0c1220 });
    // stands behind the end the camera looks at
    const zEnd = c.dir === -1 ? -9 : 116;
    const ref = this.p(0, zEnd, 0);
    const pxPerM = ref.k;
    const scale = pxPerM / 14; // texture authored at 14 px/m (100m wide)
    this.stands.scale.set(scale);
    const pulse = this.crowdPulse * 4 + (this.opts.hostile ? Math.abs(Math.sin(this.time * 6)) * 1.5 : 0);
    this.stands.position.set(ref.sx, ref.sy - 1.0 * pxPerM - (this.opts.reducedMotion ? 0 : pulse));
    // floodlight haze
    g.rect(0, 0, w, Math.max(0, ref.sy - 15 * pxPerM)).fill({ color: 0x0a0f1a });
  }

  private quad(g: Graphics, c: Cam, x0: number, z0: number, x1: number, z1: number, color: number, alpha = 1): void {
    // clip to near plane
    const nearZ = c.z + c.dir * 1.2;
    const clipZ = (z: number) => (c.dir === -1 ? Math.min(z, nearZ) : Math.max(z, nearZ));
    const za = clipZ(z0); const zb = clipZ(z1);
    if (za === zb) return;
    const a = this.p(x0, za); const b = this.p(x1, za); const cc = this.p(x1, zb); const d = this.p(x0, zb);
    g.poly([a.sx, a.sy, b.sx, b.sy, cc.sx, cc.sy, d.sx, d.sy]).fill({ color, alpha });
  }

  private line(g: Graphics, pts: [number, number][], width: number, color = 0xffffff, alpha = 0.9): void {
    const c = this.view;
    const nearZ = c.z + c.dir * 1.2;
    let started = false;
    let kSum = 0; let n = 0;
    for (const [x, z] of pts) {
      if ((z - nearZ) * c.dir < 0) { started = false; continue; }
      const q = this.p(x, z);
      kSum += q.k; n++;
      if (!started) { g.moveTo(q.sx, q.sy); started = true; } else g.lineTo(q.sx, q.sy);
    }
    if (n) g.stroke({ width: Math.max(1, (kSum / n) * width), color, alpha, cap: 'round', join: 'round' });
  }

  private drawGround(c: Cam): void {
    const g = this.ground;
    g.clear();
    const near = c.z + c.dir * 1.2;
    // surround (outside the touchlines / behind the goal up to the hoardings)
    this.quad(g, c, -60, -4.5, 60, 110, 0x24702d);
    // stripes
    const zMin = Math.max(-4.5, Math.min(near, c.z + c.dir * 200));
    void zMin;
    for (let i = -1; i < 20; i++) {
      const z0 = i * 5.5; const z1 = z0 + 5.5;
      this.quad(g, c, -34, Math.max(z0, -0), 34, z1, i % 2 === 0 ? GRASS_A : GRASS_B);
    }
    // behind the goal line grass (a touch darker)
    this.quad(g, c, -40, -4.5, 40, 0, 0x2a7a33);
    // ad boards behind goal (dir -1 view)
    if (c.dir === -1) {
      const cols = [this.kits.opp[0], 0xf2f2f2, 0x1b2a4a, this.kits.user[0], 0xe8b923, 0xf2f2f2];
      for (let i = 0; i < 14; i++) {
        const x0 = -42 + i * 6; const x1 = x0 + 5.8;
        const a = this.p(x0, -4.5, 0); const b = this.p(x1, -4.5, 0.9);
        g.rect(a.sx, b.sy, b.sx - a.sx, a.sy - b.sy).fill({ color: cols[i % cols.length] });
        g.rect(a.sx + (b.sx - a.sx) * 0.2, b.sy + (a.sy - b.sy) * 0.35, (b.sx - a.sx) * 0.6, (a.sy - b.sy) * 0.3).fill({ color: 0xffffff, alpha: 0.35 });
      }
    }
    // lighting falloff (far = darker)
    for (let i = 0; i < 6; i++) {
      const z0 = c.dir === -1 ? -4.5 + i * 6 : 70 - i * 10;
      const z1 = z0 + (c.dir === -1 ? 6 : 10);
      this.quad(g, c, -60, Math.min(z0, z1), 60, Math.max(z0, z1), 0x000000, 0.05 * (6 - i) / 6);
    }
    // lines
    const L = 0.12;
    const arc = (cx: number, cz: number, r: number, a0: number, a1: number, filter?: (x: number, z: number) => boolean): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 0; i <= 40; i++) {
        const a = lerp(a0, a1, i / 40);
        const x = cx + Math.cos(a) * r; const z = cz + Math.sin(a) * r;
        if (!filter || filter(x, z)) out.push([x, z]);
      }
      return out;
    };
    this.line(g, [[-34, 0], [34, 0]], L);
    this.line(g, [[-20.16, 0], [-20.16, 16.5], [20.16, 16.5], [20.16, 0]], L);
    this.line(g, [[-9.16, 0], [-9.16, 5.5], [9.16, 5.5], [9.16, 0]], L);
    this.line(g, arc(0, 11, 9.15, 0, Math.PI, (_x, z) => z >= 16.5), L);
    this.line(g, [[-34, 0], [-34, 105]], L);
    this.line(g, [[34, 0], [34, 105]], L);
    this.line(g, [[-34, 52.5], [34, 52.5]], L);
    this.line(g, arc(0, 52.5, 9.15, 0, Math.PI * 2), L);
    const spot = this.p(0, 11);
    if ((11 - near) * c.dir >= 0) g.ellipse(spot.sx, spot.sy, 0.2 * spot.k, 0.2 * spot.k * 0.55).fill({ color: 0xffffff, alpha: 0.9 });
    // wet sheen in rain
    if (this.opts.rain) this.quad(g, c, -40, -4.5, 40, 60, 0x9fc4ff, 0.06);
  }

  private drawShadows(): void {
    const g = this.shadows;
    g.clear();
    for (const a of this.actors) {
      if (!a.visible) continue;
      const q = this.p(a.x, a.z);
      if (q.d < 1) continue;
      const lying = a.pose === 'dive' || a.pose === 'slide' || a.pose === 'down';
      g.ellipse(q.sx, q.sy, (lying ? 0.9 : 0.42) * q.k, 0.16 * q.k).fill({ color: 0x000000, alpha: 0.28 });
      if (a.mark === 'user' || a.mark === 'rival' || a.mark === 'target') {
        const col = a.mark === 'user' ? 0xffe14d : a.mark === 'rival' ? 0xff3b3b : 0x7cf6ff;
        const pul = 1 + Math.sin(this.time * 6) * 0.06;
        g.ellipse(q.sx, q.sy, 0.75 * q.k * pul, 0.27 * q.k * pul).stroke({ width: Math.max(2, 0.09 * q.k), color: col, alpha: 0.95 });
        g.ellipse(q.sx, q.sy, 0.75 * q.k * pul, 0.27 * q.k * pul).fill({ color: col, alpha: 0.16 });
      }
    }
    if (this.ball.visible) {
      const q = this.p(this.ball.x, this.ball.z);
      if (q.d > 1) {
        const s = 1 / (1 + this.ball.h * 0.35);
        g.ellipse(q.sx + this.ball.h * q.k * 0.12, q.sy, 0.2 * q.k * s, 0.08 * q.k * s).fill({ color: 0x000000, alpha: 0.35 * s });
      }
    }
    // rings / lanes on the ground
    for (const l of this.lanes) {
      const pts: [number, number][] = [[l.x0, l.z0], [l.x1, l.z1]];
      if (l.dashed) {
        const n = 9;
        for (let i = 0; i < n; i += 1) {
          if (i % 2) continue;
          const u0 = i / n; const u1 = (i + 1) / n;
          this.line(g, [[lerp(l.x0, l.x1, u0), lerp(l.z0, l.z1, u0)], [lerp(l.x0, l.x1, u1), lerp(l.z0, l.z1, u1)]], l.width, l.color, l.alpha);
        }
        // arrow head
        const ang = Math.atan2(l.z1 - l.z0, l.x1 - l.x0);
        const ah = 1.3;
        this.line(g, [[l.x1 - Math.cos(ang - 0.5) * ah, l.z1 - Math.sin(ang - 0.5) * ah], [l.x1, l.z1], [l.x1 - Math.cos(ang + 0.5) * ah, l.z1 - Math.sin(ang + 0.5) * ah]], l.width, l.color, l.alpha);
      } else {
        this.line(g, pts, l.width * 2.6, l.color, l.alpha * 0.35);
        this.line(g, pts, l.width, l.color, l.alpha);
      }
    }
    for (const r of this.rings) {
      const u = clamp01((this.time - r.t0) / r.dur);
      const rad = r.kind === 'shrink' ? lerp(r.r0, r.r1, u) : r.r1 * (1 + 0.12 * Math.sin(this.time * 10));
      const q = this.p(r.x, r.z);
      const col = r.hot ? 0x4dff88 : r.color;
      g.ellipse(q.sx, q.sy, r.r1 * q.k, r.r1 * q.k * 0.36).stroke({ width: Math.max(2, 0.08 * q.k), color: 0xffffff, alpha: 0.85 });
      if (r.kind === 'shrink' && u < 1) g.ellipse(q.sx, q.sy, rad * q.k, rad * q.k * 0.36).stroke({ width: Math.max(3, 0.14 * q.k), color: col, alpha: 0.95 });
      if (r.hot) g.ellipse(q.sx, q.sy, r.r1 * q.k, r.r1 * q.k * 0.36).fill({ color: 0x4dff88, alpha: 0.25 });
    }
  }

  private drawBodies(c: Cam): void {
    const g = this.bodies;
    g.clear();
    type Item = { d: number; draw: () => void };
    const items: Item[] = [];
    for (const a of this.actors) {
      if (!a.visible) continue;
      const q = this.p(a.x, a.z, a.h);
      if (q.d < 1.2) continue;
      items.push({ d: q.d, draw: () => this.drawActor(g, a, q, c) });
    }
    if (this.ball.visible) {
      const q = this.p(this.ball.x, this.ball.z, this.ball.h + BALL_R);
      if (q.d > 1) items.push({ d: q.d - 0.05, draw: () => this.drawBall(g, q) });
    }
    // goal: net (behind posts from attacking view) + frame
    const net = this.p(0, -0.9);
    items.push({ d: net.d, draw: () => this.drawNet(g) });
    const posts = this.p(0, 0);
    items.push({ d: posts.d - (c.dir === -1 ? 0.01 : -0.01), draw: () => this.drawGoalFrame(g) });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.draw();
  }

  private netPoint(x: number, z: number, h: number): Proj {
    // ripple: push net points away from the pitch around recent impacts
    let off = 0;
    for (const n of this.netHits) {
      const dist = Math.hypot(x - n.x, h - n.h);
      const env = Math.exp(-dist * dist / 1.3) * Math.exp(-n.t * 2.6);
      off += Math.sin(n.t * 18) * 0.55 * env * n.amp + (n.t < 0.25 ? 0.6 * env * n.amp * (n.t / 0.25) : 0.6 * env * n.amp);
    }
    return this.p(x, z - off, h);
  }

  private drawNet(g: Graphics): void {
    const back = -NET_DEPTH;
    const topBackH = BAR - 0.5;
    const alpha = 0.5;
    const col = 0xffffff;
    const w = Math.max(0.6, this.p(0, -0.9).k * 0.02);
    // back panel verticals and horizontals
    for (let x = -GOAL_HALF; x <= GOAL_HALF + 0.01; x += 0.45) {
      const a = this.netPoint(x, back, 0); const b = this.netPoint(x, back, topBackH * 0.5); const cc = this.netPoint(x, back, topBackH);
      const t0 = this.netPoint(x, -0.9, (topBackH + BAR) / 2); const t1 = this.p(x, 0, BAR);
      g.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).lineTo(cc.sx, cc.sy).lineTo(t0.sx, t0.sy).lineTo(t1.sx, t1.sy).stroke({ width: w, color: col, alpha });
    }
    for (let hh = 0; hh <= topBackH + 0.01; hh += 0.4) {
      g.moveTo(this.netPoint(-GOAL_HALF, back, hh).sx, this.netPoint(-GOAL_HALF, back, hh).sy);
      for (let x = -GOAL_HALF + 0.6; x <= GOAL_HALF + 0.01; x += 0.6) { const q = this.netPoint(x, back, hh); g.lineTo(q.sx, q.sy); }
      g.stroke({ width: w, color: col, alpha });
    }
    // roof cross lines
    for (const zz of [-0.45, -0.9, -1.35]) {
      const hh = lerp(BAR, topBackH, -zz / NET_DEPTH);
      g.moveTo(this.netPoint(-GOAL_HALF, zz, hh).sx, this.netPoint(-GOAL_HALF, zz, hh).sy);
      for (let x = -GOAL_HALF + 0.6; x <= GOAL_HALF + 0.01; x += 0.6) { const q = this.netPoint(x, zz, hh); g.lineTo(q.sx, q.sy); }
      g.stroke({ width: w, color: col, alpha: alpha * 0.8 });
    }
    // side panels
    for (const sx of [-GOAL_HALF, GOAL_HALF]) {
      for (let zz = 0; zz >= back; zz -= 0.45) {
        const hh = lerp(BAR, topBackH, -zz / NET_DEPTH);
        const a = this.p(sx, zz, 0); const b = this.p(sx, zz, hh);
        g.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({ width: w, color: col, alpha: alpha * 0.8 });
      }
      for (let hh = 0; hh <= BAR; hh += 0.4) {
        const a = this.p(sx, 0, hh); const b = this.p(sx, back, Math.min(hh, topBackH));
        g.moveTo(a.sx, a.sy).lineTo(b.sx, b.sy).stroke({ width: w, color: col, alpha: alpha * 0.7 });
      }
    }
    // back frame
    const bl = this.p(-GOAL_HALF, back, 0); const br = this.p(GOAL_HALF, back, 0);
    const tl = this.p(-GOAL_HALF, back, topBackH); const tr = this.p(GOAL_HALF, back, topBackH);
    g.moveTo(bl.sx, bl.sy).lineTo(tl.sx, tl.sy).lineTo(tr.sx, tr.sy).lineTo(br.sx, br.sy).stroke({ width: w * 2, color: 0xdddddd, alpha: 0.7 });
  }

  private drawGoalFrame(g: Graphics): void {
    const k = this.p(0, 0).k;
    const pw = Math.max(2, 0.12 * k);
    const lp = this.p(-GOAL_HALF, 0, 0); const lt = this.p(-GOAL_HALF, 0, BAR);
    const rp = this.p(GOAL_HALF, 0, 0); const rt = this.p(GOAL_HALF, 0, BAR);
    // shadow of the frame on the grass
    g.poly([lp.sx, lp.sy, rp.sx, rp.sy, rp.sx + pw * 2, rp.sy + pw * 0.6, lp.sx + pw * 2, lp.sy + pw * 0.6]).fill({ color: 0x000000, alpha: 0.15 });
    g.rect(lt.sx - pw / 2, lt.sy - pw / 2, pw, lp.sy - lt.sy + pw / 2).fill({ color: 0xffffff });
    g.rect(rt.sx - pw / 2, rt.sy - pw / 2, pw, rp.sy - rt.sy + pw / 2).fill({ color: 0xffffff });
    g.rect(lt.sx - pw / 2, lt.sy - pw / 2, rt.sx - lt.sx + pw, pw).fill({ color: 0xffffff });
    g.rect(lt.sx - pw / 2, lt.sy - pw / 2, pw * 0.35, lp.sy - lt.sy).fill({ color: 0xc9d3dd });
    g.rect(rt.sx + pw / 2 - pw * 0.35, rt.sy - pw / 2, pw * 0.35, rp.sy - rt.sy).fill({ color: 0xc9d3dd });
  }

  private drawActor(g: Graphics, a: Actor, q: Proj, c: Cam): void {
    const k = q.k * 1.08; // slightly heroic scale
    const [c1, c2] = a.kit;
    const rot = this.poseRotation(a, c);
    const cs = Math.cos(rot); const sn = Math.sin(rot);
    g.setTransform(cs, sn, -sn, cs, q.sx, q.sy);
    const swing = a.moving > 0.1 ? Math.sin(a.phase) * 0.16 * a.moving : 0;
    const kick = a.pose === 'kick' ? clamp01(a.poseT / 0.12) * (1 - clamp01((a.poseT - 0.35) / 0.3)) : 0;
    const arms = a.pose === 'celebrate' || a.pose === 'jump' || a.pose === 'header' ? 1 : a.pose === 'dive' ? 0.9 : 0;
    const lean = a.lean * 0.12;
    const L = (m: number) => m * k;
    const sock = a.gk ? 0x1a1a1a : c1;
    const shorts = a.gk ? 0x1a1a1a : c2;
    // legs
    const legW = L(0.13);
    const lx1 = L(-0.11 + swing); const lx2 = L(0.11 - swing + kick * 0.28);
    const legTop = L(-0.82);
    g.rect(lx1 - legW / 2, legTop, legW, L(0.82) - L(kick * 0)).fill({ color: sock });
    if (kick) {
      g.poly([lx2 - legW / 2, legTop, lx2 + legW / 2, legTop, lx2 + L(0.2) + legW / 2, L(-0.3), lx2 + L(0.2) - legW / 2, L(-0.3)]).fill({ color: sock });
    } else g.rect(lx2 - legW / 2, legTop, legW, L(0.82)).fill({ color: sock });
    g.rect(lx1 - legW / 2, L(-0.5), legW, L(0.09)).fill({ color: 0xf4f4f4, alpha: 0.9 });
    if (!kick) g.rect(lx2 - legW / 2, L(-0.5), legW, L(0.09)).fill({ color: 0xf4f4f4, alpha: 0.9 });
    // boots
    g.ellipse(lx1, -L(0.03), L(0.1), L(0.05)).fill({ color: 0x111111 });
    if (!kick) g.ellipse(lx2, -L(0.03), L(0.1), L(0.05)).fill({ color: 0x111111 });
    // shorts
    g.roundRect(L(-0.25) + L(lean), L(-1.02), L(0.5), L(0.27), L(0.05)).fill({ color: shorts });
    // arms
    const armCol = a.gk ? c1 : c1;
    const ay = L(-1.45);
    const armLen = L(0.5);
    for (const side of [-1, 1]) {
      const ax = side * L(0.3) + L(lean * 1.5);
      const up = arms ? -1 : 1;
      const sw = arms ? 0 : -side * swing * 0.8;
      const ex = ax + side * L(arms ? 0.22 : 0.06) + L(sw);
      const ey = ay + up * armLen;
      g.moveTo(ax, ay).lineTo(ex, ey).stroke({ width: L(0.12), color: armCol, cap: 'round' });
      g.circle(ex, ey, L(0.065)).fill({ color: a.gk ? 0xffffff : a.skin });
    }
    // torso
    const tx = L(lean * 2);
    g.roundRect(L(-0.29) + tx, L(-1.58), L(0.58), L(0.6), L(0.12)).fill({ color: c1 });
    if (!a.gk) {
      g.rect(L(-0.05) + tx, L(-1.58), L(0.1), L(0.6)).fill({ color: c2, alpha: 0.9 });
      g.rect(L(-0.29) + tx, L(-1.56), L(0.58), L(0.07)).fill({ color: c2, alpha: 0.85 });
    } else {
      g.rect(L(-0.29) + tx, L(-1.3), L(0.58), L(0.08)).fill({ color: 0x000000, alpha: 0.25 });
    }
    // torso shading
    g.roundRect(L(0.12) + tx, L(-1.56), L(0.16), L(0.56), L(0.08)).fill({ color: 0x000000, alpha: 0.13 });
    // head
    const hx = L(lean * 2.4);
    g.rect(hx - L(0.05), L(-1.66), L(0.1), L(0.1)).fill({ color: a.skin });
    g.circle(hx, L(-1.76), L(0.13)).fill({ color: a.skin });
    g.ellipse(hx, L(-1.82), L(0.135), L(0.085)).fill({ color: a.hair });
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private poseRotation(a: Actor, c: Cam): number {
    const scr = Math.sign((a.diveX - a.x) * -c.dir) || 1;
    if (a.pose === 'dive') return scr * lerp(0, 1.35, clamp01(a.poseT / 0.28));
    if (a.pose === 'slide') return scr * lerp(0, 1.25, clamp01(a.poseT / 0.18));
    if (a.pose === 'down') return lerp(0, 1.45, clamp01(a.poseT / 0.4));
    return 0;
  }

  private drawBall(g: Graphics, q: Proj): void {
    const r = Math.max(3.5, BALL_R * q.k * 1.45);
    // motion trail
    const hist = this.ballHist;
    for (let i = 0; i < hist.length - 1; i++) {
      const b = hist[i];
      const p = this.p(b.x, b.z, b.h + BALL_R);
      const u = (i + 1) / hist.length;
      const dist = Math.hypot(p.sx - q.sx, p.sy - q.sy);
      if (dist > r * 1.2) g.circle(p.sx, p.sy, r * (0.4 + 0.5 * u)).fill({ color: 0xffffff, alpha: 0.12 * u });
    }
    if (this.ball.glow > 0) g.circle(q.sx, q.sy, r * (2.2 + Math.sin(this.time * 12) * 0.3)).fill({ color: 0xfff2a0, alpha: 0.3 * this.ball.glow });
    g.circle(q.sx, q.sy, r).fill({ color: 0xffffff });
    const rot = this.ball.rot;
    for (let i = 0; i < 3; i++) {
      const a = rot + i * 2.1;
      const px = q.sx + Math.cos(a) * r * 0.5; const py = q.sy + Math.sin(a) * r * 0.45;
      g.circle(px, py, r * 0.27).fill({ color: 0x222222 });
    }
    g.circle(q.sx + r * 0.25, q.sy + r * 0.25, r * 0.85).stroke({ width: Math.max(1, r * 0.25), color: 0x000000, alpha: 0.12 });
    g.circle(q.sx - r * 0.3, q.sy - r * 0.3, r * 0.3).fill({ color: 0xffffff, alpha: 0.8 });
  }

  private drawFx(): void {
    const g = this.fx;
    const { w, h } = this.screen;
    g.clear();
    for (const p of this.particles) {
      const a = clamp01(p.life / p.max);
      if (p.kind === 'rect') g.rect(p.x, p.y, p.size, p.size * 0.6).fill({ color: p.color, alpha: a });
      else if (p.kind === 'streak') g.moveTo(p.x, p.y).lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04).stroke({ width: p.size, color: p.color, alpha: a });
      else g.circle(p.x, p.y, p.size * (0.5 + 0.5 * a)).fill({ color: p.color, alpha: a });
    }
    if (this.opts.rain) {
      g.rect(0, 0, w, h).fill({ color: 0x24324a, alpha: 0.18 });
      for (const r of this.rainDrops) {
        g.moveTo(r.x, r.y).lineTo(r.x + 4 * r.s, r.y - 22 * r.s).stroke({ width: 1.2, color: 0xcfe0ff, alpha: 0.38 });
      }
    }
    if (this.flashA > 0.01) g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: this.flashA });
  }

  private drawUi(): void {
    const g = this.ui;
    g.clear();
    // swipe trail
    if (this.trail.length > 1) {
      const fade = this.trailFade > 0 ? this.trailFade : 1;
      const n = this.trail.length;
      for (let i = 1; i < n; i++) {
        const a = this.trail[i - 1]; const b = this.trail[i];
        const u = i / n;
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 4 + 10 * u, color: 0xffffff, alpha: 0.12 * fade * u, cap: 'round' });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2 + 4 * u, color: 0xfff6b0, alpha: 0.85 * fade * u, cap: 'round' });
      }
    }
    // gesture hint
    const hnt = this.hint;
    if (hnt && hnt.alpha > 0.01) {
      if (hnt.kind === 'swipe') {
        const cyc = (this.time % 1.3) / 1.0;
        const u = clamp01(cyc);
        const pts: [number, number][] = [];
        for (let i = 0; i <= 20; i++) {
          const s = (i / 20) * u;
          const mx = (hnt.x0 + hnt.x1) / 2; const my = (hnt.y0 + hnt.y1) / 2;
          const nx = -(hnt.y1 - hnt.y0); const ny = hnt.x1 - hnt.x0;
          const nl = Math.hypot(nx, ny) || 1;
          const cx = mx + (nx / nl) * hnt.bend; const cy = my + (ny / nl) * hnt.bend;
          const x = (1 - s) * (1 - s) * hnt.x0 + 2 * (1 - s) * s * cx + s * s * hnt.x1;
          const y = (1 - s) * (1 - s) * hnt.y0 + 2 * (1 - s) * s * cy + s * s * hnt.y1;
          pts.push([x, y]);
        }
        for (let i = 1; i < pts.length; i++) {
          g.moveTo(pts[i - 1][0], pts[i - 1][1]).lineTo(pts[i][0], pts[i][1]).stroke({ width: 6, color: 0xffffff, alpha: hnt.alpha * 0.55 * (i / pts.length), cap: 'round' });
        }
        const [ex, ey] = pts[pts.length - 1];
        g.circle(ex, ey, 13).fill({ color: 0xffffff, alpha: hnt.alpha * 0.5 * (1 - clamp01((cyc - 1) / 0.3)) });
        g.circle(ex, ey, 13).stroke({ width: 2, color: 0xffffff, alpha: hnt.alpha * 0.9 });
      } else {
        const cyc = (this.time % 1.0);
        g.circle(hnt.x0, hnt.y0, 12 + cyc * 26).stroke({ width: 3, color: 0xffffff, alpha: hnt.alpha * (1 - cyc) });
        g.circle(hnt.x0, hnt.y0, 11).fill({ color: 0xffffff, alpha: hnt.alpha * 0.55 });
      }
    }
  }

  /** remove everything from the stage. Texture of the stands is destroyed too. */
  destroy(): void {
    this.root.destroy({ children: true });
    this.standsTex.destroy(true);
    this.particles = [];
    this.actors = [];
  }
}

export { clamp };
