// "רגע החלטה" (decision moment): the default key-moment style. A tactical read on the locker-room
// whiteboard: situation note + board with magnets and runs, 3-4 option cards, a pressure timer, then the
// play animates on the board and a stamp + commentator line close it. No Pixi, no gestures.
import type { Attributes, MomentResult, MomentSpec, Position } from '../../core/types';
import { isolateNumbers } from '../hud';
import { Board, type BoardColors } from './board';
import { ICONS } from './icons';
import { ATTR_HE, RISK_HE, buildOptions, hintOption, kindDef, lessonLine, pickVariant, resolveDecision } from './resolve';
import type { DecisionOption, Resolved, Variant } from './types';

export type { DecisionOption, Resolved } from './types';
export { LIBRARY } from './scenarios';
export * from './resolve';

export interface DecisionMomentOptions {
  attr: Attributes;
  pos: Position;
  colors?: BoardColors;
  userName?: string;
  /** shirt number shown on the user's magnet */
  shirt?: number;
  reducedMotion?: boolean;
  /** override the pressure timer (seconds, 0 = none). Default: 11 when lateClose, else 15 */
  timer?: number;
  /** dev/test hook: fixed random numbers [outcome, hint] */
  rnd?: () => number;
}

const AUTO_CLOSE_MS = 5200;

export function playDecisionMoment(host: HTMLElement, spec: MomentSpec, opts: DecisionMomentOptions): Promise<MomentResult> {
  injectCss();
  const rnd = opts.rnd ?? Math.random;
  const reduced = opts.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const def = kindDef(spec.kind);
  const { variant, fixText } = renumber(pickVariant(def, spec, opts.pos), opts.shirt);
  const options = buildOptions(def, variant, spec, opts.attr);
  const hint = hintOption(options, opts.attr, opts.pos, rnd());
  const timerS = opts.timer ?? (spec.context.lateClose ? 11 : 15);

  // ---------------------------------------------------------------- DOM
  const root = document.createElement('div');
  root.className = `dm-root${reduced ? ' rm' : ''}${def.defending ? ' def' : ''}`;
  root.dir = 'rtl';
  root.dataset.phase = 'choose';
  root.dataset.kind = spec.kind;
  root.dataset.variant = variant.id;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `רגע מפתח: ${def.title}`);

  const [us, them] = spec.scoreBefore;
  const ctxTags: string[] = [];
  if (spec.context.rivalInvolved) ctxTags.push('יריבות');
  if (spec.context.hostileCrowd) ctxTags.push('קהל עוין');
  if (spec.context.rain) ctxTags.push('גשם');
  if (spec.context.derby) ctxTags.push('דרבי');

  root.innerHTML = `
<div class="dm-col">
  <header class="dm-head">
    <div class="dm-min" aria-label="דקה">${spec.minute}'</div>
    <div class="dm-title">${def.title}</div>
    <div class="dm-score" aria-label="תוצאה"><b>${us}</b><i>:</i><b>${them}</b></div>
  </header>
  <div class="dm-stakes">${esc(isolateNumbers(spec.stakes))}${ctxTags.length ? ` <span class="dm-tags">${ctxTags.map((t) => `<em>${t}</em>`).join('')}</span>` : ''}</div>
  <div class="dm-note"><span class="dm-tape"></span><span class="dm-coach">המאמן:</span> ${esc(variant.note)}</div>
  <div class="dm-boardwrap"><div class="dm-frame"></div>
    <div class="dm-stamp" aria-live="assertive"></div>
  </div>
  <div class="dm-timer${timerS ? '' : ' off'}"><span class="dm-timer-fill"></span><span class="dm-timer-n"></span></div>
  <div class="dm-opts${options.length % 2 ? ' odd' : ''}" role="group" aria-label="מה אתה עושה?"></div>
  <div class="dm-result" hidden>
    <div class="dm-say"><span class="dm-mic">${ICONS.mic}</span><p></p></div>
    <div class="dm-lesson" hidden><span class="dm-lesson-ic">${ICONS.eye}</span><p></p></div>
    <button class="dm-go" type="button">המשך <span class="dm-go-ring"></span></button>
  </div>
</div>`;

  const q = <T extends Element>(s: string) => root.querySelector(s) as T;
  const frame = q<HTMLDivElement>('.dm-frame');
  const board = new Board(variant, { colors: opts.colors, userLabel: opts.shirt !== undefined ? String(opts.shirt) : undefined, reducedMotion: reduced });
  frame.appendChild(board.svg);
  const wrap = q<HTMLDivElement>('.dm-boardwrap');

  let onPick: (o: DecisionOption | null) => void = () => {};
  const optsEl = q<HTMLDivElement>('.dm-opts');
  const cards = new Map<string, HTMLButtonElement>();
  options.forEach((o, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `dm-card${o.id === hint ? ' hint' : ''}`;
    b.dataset.opt = o.id;
    b.style.setProperty('--i', String(i));
    b.setAttribute('aria-label', `${o.label}. ${ATTR_HE[o.attr]} ${o.attrValue}. סיכון ${RISK_HE[o.risk]}${o.id === hint ? '. נראה לך פתוח' : ''}`);
    b.innerHTML = `
${o.id === hint ? `<span class="dm-hint">${ICONS.eye}נראה לך פתוח</span>` : ''}
<span class="dm-card-top"><span class="dm-ic">${ICONS[o.icon]}</span><span class="dm-lbl">${esc(o.label)}</span></span>
<span class="dm-card-bot"><span class="dm-chip">${ATTR_HE[o.attr]} <b>${o.attrValue}</b></span>
<span class="dm-risk r${o.risk}" title="סיכון">${[1, 2, 3].map((k) => `<i class="${k <= o.risk ? 'on' : ''}"></i>`).join('')}<small>${RISK_HE[o.risk]}</small></span></span>`;
    b.addEventListener('click', () => onPick(o));
    optsEl.appendChild(b);
    cards.set(o.id, b);
  });

  document.body.appendChild(root);
  const refit = () => {
    const r = board.svg.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) board.fit(r.height / r.width);
  };
  refit();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (root.dataset.phase === 'choose') refit(); }) : null;
  ro?.observe(frame);
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  // focus first card for keyboard users without scrolling
  requestAnimationFrame(() => { if (!reduced) root.classList.add('in'); });

  return new Promise<MomentResult>((resolve) => {
    let settled = false;
    let picked = false;
    let timerRaf = 0;
    let autoT = 0;
    let startT = 0;

    const cleanup = () => {
      cancelAnimationFrame(timerRaf);
      clearTimeout(autoT);
      ro?.disconnect();
      host.removeEventListener('moment-skip', onSkip);
      window.removeEventListener('keydown', onKey);
      board.destroy();
      root.remove();
      document.body.style.overflow = prevOverflow;
    };
    const finish = (r: MomentResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(r);
    };
    const onSkip = () => finish({ momentId: spec.id, success: false, quality: 0, skipped: true });
    host.addEventListener('moment-skip', onSkip);

    const onKey = (e: KeyboardEvent) => {
      if (root.dataset.phase === 'choose') {
        const n = Number(e.key);
        if (n >= 1 && n <= options.length) { e.preventDefault(); pick(options[n - 1]); }
      } else if (root.dataset.phase === 'result' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        q<HTMLButtonElement>('.dm-go').click();
      }
    };
    window.addEventListener('keydown', onKey);

    onPick = (o) => { void pick(o); };

    // ---------------------------------------------------------------- pressure timer
    const fill = q<HTMLSpanElement>('.dm-timer-fill');
    const num = q<HTMLSpanElement>('.dm-timer-n');
    const tick = (now: number) => {
      if (picked || settled) return;
      if (!startT) startT = now;
      const left = Math.max(0, timerS - (now - startT) / 1000);
      fill.style.transform = `scaleX(${(left / timerS).toFixed(4)})`;
      num.textContent = String(Math.ceil(left));
      root.classList.toggle('hurry', left <= 3);
      if (left <= 0) { pick(null); return; }
      timerRaf = requestAnimationFrame(tick);
    };
    if (timerS > 0) {
      num.textContent = String(timerS);
      // the clock starts once the board has settled in
      setTimeout(() => { if (!settled && !picked) timerRaf = requestAnimationFrame(tick); }, reduced ? 0 : 650);
    }

    // ---------------------------------------------------------------- pick → animate → stamp
    async function pick(o: DecisionOption | null) {
      if (picked || settled) return;
      picked = true;
      cancelAnimationFrame(timerRaf);
      // freeze the board size so the result panel swap does not rescale it
      wrap.style.flex = `0 0 ${wrap.getBoundingClientRect().height}px`;
      root.dataset.phase = 'act';
      root.classList.remove('hurry');
      if (o) cards.get(o.id)?.classList.add('chosen');
      else root.classList.add('timeout');
      for (const b of cards.values()) b.disabled = true;

      const res: Resolved = resolveDecision(def, o, rnd(), opts.userName);
      res.line = fixText(res.line);
      root.dataset.success = String(res.success);
      // timeout: play the weakest read's failure
      const weakest = options.reduce((a, b) => (b.fit < a.fit ? b : a), options[0]);
      const steps = o ? (res.success ? o.tpl.ok : o.tpl.fail) : weakest?.tpl.fail ?? [];

      if (o) await board.drawPlan(o.tpl.ok, reduced ? 0 : 620);
      if (settled) return;
      board.dimGuides();
      const { inNet } = await board.play(steps, 1);
      if (settled) return;
      if (inNet) wrap.classList.add('net');

      // stamp
      const stamp = q<HTMLDivElement>('.dm-stamp');
      const goalish = res.success && (o?.tpl.goal ?? false);
      stamp.textContent = res.stamp;
      stamp.className = `dm-stamp show ${o ? (res.success ? 'ok' : 'bad') : 'idle'}${goalish ? ' goal' : ''}`;
      root.dataset.phase = 'result';
      root.dataset.stamp = res.stamp;

      const result = q<HTMLDivElement>('.dm-result');
      (result.querySelector('.dm-say p') as HTMLParagraphElement).textContent = res.line;
      const lesson = lessonLine(spec.kind, variant, options, o, res.success);
      if (lesson) {
        const el = q<HTMLDivElement>('.dm-lesson');
        el.hidden = false;
        el.classList.add(lesson.kind);
        (el.querySelector('p') as HTMLParagraphElement).textContent = fixText(lesson.text);
        root.dataset.lesson = lesson.kind;
      }
      result.hidden = false;
      // let the board give room to the commentary / lesson on short screens (the SVG scales, it does not re-crop)
      wrap.style.flex = '';
      wrap.style.minHeight = '200px';
      optsEl.classList.add('gone');
      const go = q<HTMLButtonElement>('.dm-go');
      const done = () => finish({ momentId: spec.id, success: res.success, quality: res.quality, skipped: false });
      go.addEventListener('click', done);
      try { go.focus({ preventScroll: true }); } catch { /* old browsers */ }
      const closeMs = AUTO_CLOSE_MS + (reduced ? 1500 : 0) + (root.dataset.lesson ? 2800 : 0);
      (go.querySelector('.dm-go-ring') as HTMLSpanElement).style.animationDuration = `${closeMs}ms`;
      autoT = window.setTimeout(done, closeMs);
    }
  });
}

/**
 * The user's magnet wears his shirt number. If a teammate on the board has the same number, give the teammate
 * a free one and patch the coach note / commentary ("ה-9", "ל-9", "#9") so the text keeps pointing at him.
 */
export function renumber(v: Variant, shirt?: number): { variant: Variant; fixText: (s: string) => string } {
  const clash = shirt !== undefined ? v.magnets.find((m) => m.team === 'u' && m.id !== 'me' && m.n === shirt) : undefined;
  if (!clash || shirt === undefined) return { variant: v, fixText: (s) => s };
  const used = new Set(v.magnets.filter((m) => m.team === 'u').map((m) => Number(m.n)));
  used.add(shirt);
  const free = [9, 11, 7, 10, 8, 17, 19, 14, 20, 23].find((n) => !used.has(n)) ?? 99;
  const re = new RegExp(`(ה-|ל-|#)${shirt}(?!\\d)`, 'g');
  const fixText = (s: string) => s.replace(re, `$1${free}`);
  return {
    variant: { ...v, note: fixText(v.note), magnets: v.magnets.map((m) => (m === clash ? { ...m, n: free } : m)) },
    fixText,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

// ------------------------------------------------------------------ styles (self-contained)

let cssDone = false;
function injectCss(): void {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const st = document.createElement('style');
  st.id = 'dm-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const CSS = `
.dm-root{position:fixed;inset:0;z-index:90;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;
  background:radial-gradient(120% 70% at 50% 0%,#2f4870 0%,#22344f 45%,#16233a 100%);
  color:#f7f7f2;font-family:var(--f-body,'Assistant',system-ui,sans-serif);-webkit-tap-highlight-color:transparent;
  padding:max(10px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));box-sizing:border-box}
.dm-root *{box-sizing:border-box}
.dm-col{max-width:540px;min-height:100%;margin:0 auto;display:flex;flex-direction:column;gap:9px}
.dm-head{display:flex;align-items:center;gap:10px}
.dm-min{background:#d7263d;color:#fff;font:700 15px/1 var(--f-body,'Assistant');padding:6px 9px 5px;border-radius:8px;
  box-shadow:0 2px 0 #8c1323;direction:ltr;letter-spacing:.5px;min-width:44px;text-align:center}
.dm-title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:400 32px/1 var(--f-display,'Karantina','Assistant');letter-spacing:.5px;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.25)}
.dm-score{display:flex;align-items:center;gap:4px;direction:ltr;background:#0f1a2c;border:1px solid rgba(255,255,255,.12);
  border-radius:9px;padding:4px 10px;font:700 20px/1 var(--f-body,'Assistant')}
.dm-score i{opacity:.5;font-style:normal}
.dm-stakes{font-size:13.5px;line-height:1.3;color:#f2c230;font-weight:700;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dm-tags{display:inline-flex;gap:4px}
.dm-tags em{font-style:normal;font-size:11.5px;color:#fff;background:rgba(215,38,61,.85);border-radius:999px;padding:1px 8px}
.dm-note{position:relative;background:#fffdf4;color:#1b2a4a;border-radius:3px;padding:12px 14px 10px;font-size:15.5px;line-height:1.38;font-weight:600;
  box-shadow:0 6px 14px rgba(0,0,0,.28),0 1px 0 rgba(0,0,0,.08);transform:rotate(-.6deg);
  background-image:repeating-linear-gradient(#fffdf4 0 21px,rgba(30,79,216,.10) 21px 22px)}
.dm-tape{position:absolute;top:-9px;left:50%;width:74px;height:18px;margin-left:-37px;background:rgba(236,222,176,.86);transform:rotate(2deg);
  box-shadow:0 1px 2px rgba(0,0,0,.15)}
.dm-coach{font:400 24px/.8 var(--f-display,'Karantina','Assistant');color:#d7263d;margin-left:5px;letter-spacing:.3px}
.dm-boardwrap{position:relative;flex:1 1 auto;display:flex;min-height:min(300px,40dvh);max-height:64dvh}
.dm-frame{position:relative;flex:1;padding:7px;border-radius:12px;
  background:linear-gradient(145deg,#eef0f2 0%,#b8bdc2 30%,#dde1e4 52%,#8e959c 100%);
  box-shadow:0 14px 28px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.8),inset 0 -1px 0 rgba(0,0,0,.25)}
.dm-frame::after{content:'';position:absolute;inset:7px;border-radius:5px;pointer-events:none;
  background:linear-gradient(115deg,rgba(255,255,255,.28) 0%,rgba(255,255,255,0) 32%,rgba(255,255,255,0) 70%,rgba(255,255,255,.10) 100%);
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.18),inset 0 2px 6px rgba(0,0,0,.18)}
.dm-svg{position:absolute;inset:7px;width:calc(100% - 14px);height:calc(100% - 14px);display:block;border-radius:5px;overflow:hidden}
.dm-arrow{opacity:.95;transition:opacity .4s}
.dm-svg.acting .dm-arrow{opacity:.18}
.dm-svg.acting .dm-plan-path{opacity:.45;transition:opacity .5s}
.dm-mag.me .halo{animation:dmPulse 1.6s ease-in-out infinite}
@keyframes dmPulse{0%,100%{opacity:.35}50%{opacity:.8}}
.dm-net.hit{animation:dmNet .6s ease-out}
@keyframes dmNet{0%{transform:translateY(0)}30%{transform:translateY(-1.3px) scaleX(1.03)}100%{transform:translateY(0)}}
.dm-net{transform-box:fill-box;transform-origin:50% 100%}
.dm-svg.shake{animation:dmShake .35s ease-out}
@keyframes dmShake{0%,100%{transform:none}25%{transform:translate(1.5px,-1px)}50%{transform:translate(-1.5px,1px)}75%{transform:translate(1px,0)}}
.dm-stamp{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%) rotate(-9deg) scale(.6);opacity:0;pointer-events:none;
  font:400 64px/1 var(--f-display,'Karantina','Assistant');padding:6px 22px 2px;border:5px solid currentColor;border-radius:12px;white-space:nowrap;
  background:rgba(236,239,234,.82);letter-spacing:1px;mix-blend-mode:normal}
.dm-stamp.show{animation:dmStamp .42s cubic-bezier(.2,1.6,.4,1) forwards}
.dm-stamp.ok{color:#2f9e57}.dm-stamp.bad{color:#d7263d}.dm-stamp.idle{color:#44506a}
.dm-stamp.goal{color:#d7263d;font-size:84px;background:rgba(242,194,48,.92);border-color:#1b2a4a;color:#1b2a4a}
@keyframes dmStamp{0%{opacity:0;transform:translate(-50%,-50%) rotate(-16deg) scale(2.1)}70%{opacity:1;transform:translate(-50%,-50%) rotate(-8deg) scale(.94)}100%{opacity:1;transform:translate(-50%,-50%) rotate(-9deg) scale(1)}}
.dm-timer{position:relative;height:16px;border-radius:999px;background:rgba(0,0,0,.35);overflow:hidden;box-shadow:inset 0 1px 2px rgba(0,0,0,.4)}
.dm-timer.off{display:none}
.dm-timer-fill{position:absolute;inset:0;background:linear-gradient(90deg,#f2c230,#f28c28);transform-origin:right center;border-radius:999px}
.dm-root.hurry .dm-timer-fill{background:linear-gradient(90deg,#ff4d5e,#d7263d);animation:dmBlink .5s steps(2) infinite}
@keyframes dmBlink{50%{opacity:.6}}
.dm-timer-n{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:800 12px/1 var(--f-body,'Assistant');color:#1b2a4a;text-shadow:0 0 3px rgba(255,255,255,.7)}
.dm-root[data-phase=act] .dm-timer,.dm-root[data-phase=result] .dm-timer{opacity:0;transition:opacity .3s}
.dm-opts{display:grid;grid-template-columns:1fr 1fr;gap:9px;padding-top:4px}
.dm-opts.odd .dm-card:last-child{grid-column:1 / -1}
.dm-opts.gone{display:none}
.dm-card{position:relative;min-height:84px;padding:10px 11px 9px;border-radius:14px;border:0;text-align:right;cursor:pointer;
  background:linear-gradient(180deg,#ffffff 0%,#f1f2ee 100%);color:#1b2a4a;font-family:inherit;
  box-shadow:0 4px 0 #9aa1a8,0 8px 16px rgba(0,0,0,.28);display:flex;flex-direction:column;justify-content:space-between;gap:8px;
  transition:transform .12s ease,box-shadow .12s ease,opacity .25s ease;touch-action:manipulation}
.dm-card:active{transform:translateY(3px);box-shadow:0 1px 0 #9aa1a8,0 3px 8px rgba(0,0,0,.25)}
.dm-card:focus-visible{outline:3px solid #f2c230;outline-offset:2px}
.dm-card.hint{box-shadow:0 4px 0 #b98a09,0 0 0 3px #f2c230,0 8px 18px rgba(242,194,48,.35)}
.dm-hint{position:absolute;top:-10px;left:10px;display:inline-flex;align-items:center;gap:4px;background:#f2c230;color:#1b2a4a;
  font:800 11.5px/1 var(--f-body,'Assistant');padding:4px 8px 4px 9px;border-radius:999px;box-shadow:0 2px 4px rgba(0,0,0,.25);transform:rotate(-2deg)}
.dm-hint svg{width:14px;height:14px}
.dm-card-top{display:flex;align-items:flex-start;gap:9px}
.dm-ic{flex:none;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;color:#fff;
  background:radial-gradient(circle at 35% 30%,#4d7cf0,#1e4fd8 60%,#143a9e);box-shadow:inset 0 -2px 3px rgba(0,0,0,.25),0 2px 3px rgba(0,0,0,.2)}
.dm-root.def .dm-ic{background:radial-gradient(circle at 35% 30%,#ff6b7c,#d7263d 60%,#8c1323)}
.dm-ic svg{width:20px;height:20px}
.dm-lbl{font:800 16px/1.2 var(--f-body,'Assistant');padding-top:2px}
.dm-card-bot{display:flex;align-items:center;justify-content:space-between;gap:6px}
.dm-chip{font:700 12.5px/1 var(--f-body,'Assistant');background:#e3e8f5;color:#1e4fd8;border-radius:999px;padding:4px 9px;white-space:nowrap}
.dm-chip b{font-weight:800;color:#1b2a4a}
.dm-risk{display:inline-flex;align-items:center;gap:3px}
.dm-risk i{width:8px;height:8px;border-radius:50%;background:#d6d9de;display:block}
.dm-risk.r1 i.on{background:#2f9e57}.dm-risk.r2 i.on{background:#f28c28}.dm-risk.r3 i.on{background:#d7263d}
.dm-risk small{font:700 11.5px/1 var(--f-body,'Assistant');color:#6f7a8f;margin-right:3px}
.dm-card:disabled{cursor:default}
.dm-root[data-phase=act] .dm-card:not(.chosen){opacity:.28;transform:scale(.97)}
.dm-card.chosen{box-shadow:0 0 0 3px #d7263d,0 8px 16px rgba(0,0,0,.3);transform:translateY(-2px)}
.dm-result{display:flex;flex-direction:column;gap:10px;padding-top:4px}
.dm-result[hidden]{display:none}
.dm-say{display:flex;gap:10px;align-items:flex-start;background:#0f1a2c;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px 13px;
  animation:dmRise .35s ease-out both}
.dm-say p{margin:0;font:700 17px/1.4 var(--f-body,'Assistant');color:#fff}
.dm-lesson{display:flex;gap:9px;align-items:flex-start;background:#fffdf4;color:#1b2a4a;border-radius:4px;padding:9px 12px;transform:rotate(-.5deg);
  box-shadow:0 4px 10px rgba(0,0,0,.25);border-right:5px solid #f2c230;animation:dmRise .35s .25s ease-out both}
.dm-lesson[hidden]{display:none}
.dm-lesson.good{border-right-color:#2f9e57}
.dm-lesson p{margin:0;font:700 15px/1.35 var(--f-body,'Assistant')}
.dm-lesson-ic{flex:none;width:26px;height:26px;border-radius:50%;background:#f2c230;color:#1b2a4a;display:grid;place-items:center;margin-top:1px}
.dm-lesson.good .dm-lesson-ic{background:#2f9e57;color:#fff}
.dm-lesson-ic svg{width:15px;height:15px}
.dm-mic{flex:none;width:32px;height:32px;border-radius:50%;background:#f2c230;color:#1b2a4a;display:grid;place-items:center}
.dm-mic svg{width:18px;height:18px}
.dm-go{position:relative;overflow:hidden;min-height:54px;border:0;border-radius:14px;background:#f28c28;color:#1b2a4a;cursor:pointer;
  font:800 19px/1 var(--f-body,'Assistant');box-shadow:0 4px 0 #a85a10,0 8px 16px rgba(0,0,0,.3);animation:dmRise .35s .12s ease-out both}
.dm-go:active{transform:translateY(3px);box-shadow:0 1px 0 #a85a10}
.dm-go-ring{position:absolute;right:0;bottom:0;height:4px;width:100%;background:rgba(27,42,74,.35);transform-origin:right;animation:dmDrain ${AUTO_CLOSE_MS}ms linear forwards}
@keyframes dmDrain{to{transform:scaleX(0)}}
@keyframes dmRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.dm-root.in .dm-note{animation:dmNote .45s ease-out both}
.dm-root.in .dm-boardwrap{animation:dmRise .4s .08s ease-out both}
.dm-root.in .dm-mag{animation:dmPop .38s cubic-bezier(.3,1.6,.5,1) both}
.dm-root.in .dm-mag.u{animation-delay:.22s}.dm-root.in .dm-mag.o{animation-delay:.3s}.dm-root.in .dm-mag.me{animation-delay:.4s}
.dm-root.in .dm-arrow{animation:dmFade .5s .55s ease-out both}
.dm-root.in .dm-card{animation:dmRise .35s calc(.35s + var(--i) * .06s) ease-out both}
@keyframes dmNote{from{opacity:0;transform:translateY(-8px) rotate(-2deg)}to{opacity:1;transform:rotate(-.6deg)}}
@keyframes dmPop{from{opacity:0}to{opacity:1}}
@keyframes dmFade{from{opacity:0}to{opacity:.95}}
.dm-root.rm *,.dm-root.rm *::before,.dm-root.rm *::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}
@media (max-height:700px){.dm-note{font-size:14px;padding:9px 12px 8px}.dm-title{font-size:26px}.dm-card{min-height:72px}}
`;
