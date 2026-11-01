// DOM overlay above the canvas: Hebrew text renders crisply and RTL-correct in HTML.
// pointer-events: none everywhere so gestures reach the canvas.
import type { MomentSpec } from '../core/types';

const CSS = `
.mm-hud{position:absolute;inset:0;pointer-events:none;font-family:Heebo,'Secular One',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;direction:rtl;color:#fff;overflow:hidden;user-select:none;-webkit-user-select:none}
.mm-top{position:absolute;top:calc(env(safe-area-inset-top,0px) + 10px);inset-inline:10px;display:flex;align-items:center;gap:8px;justify-content:space-between}
.mm-min{background:rgba(10,16,30,.82);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:4px 10px;font-weight:800;font-size:15px;letter-spacing:.5px;box-shadow:0 4px 14px rgba(0,0,0,.35)}
.mm-min b{color:#ffe14d}
.mm-stakes{flex:1;text-align:center;font-weight:700;font-size:14px;text-shadow:0 2px 6px rgba(0,0,0,.8);opacity:.95;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mm-score{background:rgba(10,16,30,.82);border:1px solid rgba(255,255,255,.15);border-radius:10px;padding:4px 10px;font-weight:900;font-size:15px;direction:ltr;unicode-bidi:isolate}
.mm-tags{position:absolute;top:calc(env(safe-area-inset-top,0px) + 50px);inset-inline:0;display:flex;justify-content:center;gap:6px;flex-wrap:wrap}
.mm-tag{font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.2)}
.mm-tag.hot{background:rgba(214,46,46,.75)}
.mm-ins{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%) scale(1);background:rgba(8,14,28,.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:14px 22px;text-align:center;min-width:220px;max-width:86%;box-shadow:0 10px 30px rgba(0,0,0,.45);transition:top .45s cubic-bezier(.2,.8,.2,1),transform .45s cubic-bezier(.2,.8,.2,1),padding .45s,opacity .3s}
.mm-ins .t{font-family:'Secular One',Heebo,system-ui,sans-serif;font-size:24px;font-weight:900;line-height:1.15}
.mm-ins .s{font-size:13px;opacity:.8;margin-top:4px}
.mm-ins.small{top:calc(100% - 92px - env(safe-area-inset-bottom,0px));transform:translate(-50%,-50%) scale(.72);padding:8px 16px}
.mm-ins.small.top{top:calc(env(safe-area-inset-top,0px) + 96px)}
.mm-ins.gone{opacity:0}
.mm-timer{position:absolute;bottom:calc(env(safe-area-inset-bottom,0px) + 34px);left:12%;right:12%;height:6px;border-radius:6px;background:rgba(0,0,0,.4);overflow:hidden;opacity:0;transition:opacity .3s}
.mm-timer.on{opacity:1}
.mm-timer i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#ff4d4d,#ffd84a 40%,#4dff88);transform-origin:left;}
.mm-res{position:absolute;left:0;right:0;top:34%;padding:10px 0 12px;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(6,10,20,.55) 18%,rgba(6,10,20,.55) 82%,rgba(0,0,0,0));text-align:center;font-family:'Secular One',Heebo,system-ui,sans-serif;font-weight:900;font-size:72px;line-height:1.05;letter-spacing:1px;opacity:0;transform:scale(.4);-webkit-text-stroke:2px rgba(0,0,0,.35);text-shadow:0 6px 0 rgba(0,0,0,.35),0 0 30px rgba(0,0,0,.4)}
.mm-res.long{font-size:54px}
.mm-res.show{animation:mm-pop .55s cubic-bezier(.2,1.6,.4,1) forwards}
.mm-res.good{color:#ffe14d}
.mm-res.bad{color:#ffffff}
.mm-res.neutral{color:#ffffff}
.mm-res .sub{display:block;font-family:Heebo,system-ui,sans-serif;font-size:16px;font-weight:700;-webkit-text-stroke:0;margin-top:2px;text-shadow:0 2px 8px rgba(0,0,0,.8);opacity:.95}
.mm-grade{position:absolute;left:50%;top:58%;transform:translate(-50%,-50%);font-weight:900;font-size:22px;padding:4px 14px;border-radius:12px;background:rgba(0,0,0,.55);opacity:0}
.mm-grade.show{animation:mm-grade .9s ease-out forwards}
.mm-tagname{position:absolute;left:0;top:0;transform:translate(-50%,-100%);background:#d62e2e;color:#fff;font-weight:800;font-size:12px;padding:2px 8px;border-radius:8px;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.4);display:none}
.mm-tagname:after{content:'';position:absolute;left:50%;bottom:-5px;margin-left:-5px;border:5px solid transparent;border-bottom:0;border-top-color:#d62e2e}
.mm-tagname small{opacity:.8;font-weight:600;margin-inline-end:4px}
.mm-shade{position:absolute;inset:0;background:radial-gradient(ellipse 120% 90% at 50% 55%,rgba(0,0,0,0) 55%,rgba(0,0,0,.38) 100%),linear-gradient(180deg,rgba(0,0,0,.35) 0,rgba(0,0,0,0) 12%)}
.mm-vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 48%,rgba(90,0,0,.55) 100%);opacity:0}
.mm-vig.on{opacity:1;animation:mm-beat 0.92s ease-in-out infinite}
.mm-letter{position:absolute;inset-inline:0;height:0;background:#000;transition:height .5s}
.mm-letter.top{top:0}.mm-letter.bot{bottom:0}
.mm-hud.cine .mm-letter{height:5%}
.mm-hud.rm *{animation-duration:0s!important;transition:none!important}
.mm-hud.rm .mm-res.long{font-size:54px}
.mm-res.show{opacity:1;transform:none}
.mm-hud.rm .mm-grade.show{opacity:1}
@keyframes mm-pop{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:scale(1)}}
@keyframes mm-grade{0%{opacity:0;transform:translate(-50%,-30%)}20%{opacity:1;transform:translate(-50%,-50%)}75%{opacity:1}100%{opacity:0;transform:translate(-50%,-80%)}}
@keyframes mm-beat{0%,100%{opacity:.55}12%{opacity:1}24%{opacity:.6}36%{opacity:.95}}
`;

let cssInjected = false;

/** Wrap digit runs like "88, 1-1" in LTR isolates so RTL text does not reorder them. */
export function isolateNumbers(s: string): string {
  return s.replace(/\d+(?:[\s,:\-–]+\d+)*/g, (m) => `\u2066${m}\u2069`);
}

export class Hud {
  readonly root: HTMLDivElement;
  private ins: HTMLDivElement;
  private timer: HTMLDivElement;
  private timerBar: HTMLElement;
  private res: HTMLDivElement;
  private grade: HTMLDivElement;
  private tag: HTMLDivElement;
  private vig: HTMLDivElement;

  constructor(host: HTMLElement, spec: MomentSpec, reducedMotion: boolean) {
    if (!cssInjected || !document.getElementById('mm-hud-css')) {
      const st = document.createElement('style');
      st.id = 'mm-hud-css';
      st.textContent = CSS;
      document.head.appendChild(st);
      cssInjected = true;
    }
    const r = document.createElement('div');
    r.className = 'mm-hud' + (reducedMotion ? ' rm' : '');
    const ctx = spec.context;
    const tags: string[] = [];
    if (ctx.derby) tags.push('<span class="mm-tag hot">דרבי</span>');
    if (ctx.lateClose) tags.push('<span class="mm-tag hot">דקות הכרעה</span>');
    if (ctx.hostileCrowd) tags.push('<span class="mm-tag">קהל עוין</span>');
    if (ctx.rain) tags.push('<span class="mm-tag">גשם</span>');
    if (ctx.rivalInvolved) tags.push('<span class="mm-tag hot">מול היריב</span>');
    r.innerHTML = `
      <div class="mm-shade"></div>
      <div class="mm-vig"></div>
      <div class="mm-letter top"></div><div class="mm-letter bot"></div>
      <div class="mm-top"><div class="mm-min"><b>${Math.round(spec.minute)}'</b></div><div class="mm-stakes"></div><div class="mm-score">${spec.scoreBefore[0]} - ${spec.scoreBefore[1]}</div></div>
      <div class="mm-tags">${tags.join('')}</div>
      <div class="mm-tagname"></div>
      <div class="mm-ins"><div class="t"></div><div class="s"></div></div>
      <div class="mm-timer"><i></i></div>
      <div class="mm-grade"></div>
      <div class="mm-res"></div>`;
    (r.querySelector('.mm-stakes') as HTMLElement).textContent = isolateNumbers(spec.stakes);
    host.appendChild(r);
    this.root = r;
    this.ins = r.querySelector('.mm-ins') as HTMLDivElement;
    this.timer = r.querySelector('.mm-timer') as HTMLDivElement;
    this.timerBar = r.querySelector('.mm-timer i') as HTMLElement;
    this.res = r.querySelector('.mm-res') as HTMLDivElement;
    this.grade = r.querySelector('.mm-grade') as HTMLDivElement;
    this.tag = r.querySelector('.mm-tagname') as HTMLDivElement;
    this.vig = r.querySelector('.mm-vig') as HTMLDivElement;
    if (ctx.lateClose) { this.vig.classList.add('on'); r.classList.add('cine'); }
  }

  instruction(title: string, sub = ''): void {
    (this.ins.querySelector('.t') as HTMLElement).textContent = title;
    (this.ins.querySelector('.s') as HTMLElement).textContent = sub;
    this.ins.classList.remove('small', 'gone');
  }
  shrinkInstruction(top = false): void { this.ins.classList.add('small'); this.ins.classList.toggle('top', top); }
  hideInstruction(): void { this.ins.classList.add('gone'); }

  timerOn(on: boolean): void { this.timer.classList.toggle('on', on); }
  setTimer(frac: number): void { this.timerBar.style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`; }

  showGrade(text: string, color: string): void {
    this.grade.textContent = text;
    this.grade.style.color = color;
    this.grade.classList.remove('show');
    void this.grade.offsetWidth;
    this.grade.classList.add('show');
  }

  showResult(text: string, tone: 'good' | 'bad' | 'neutral', sub = ''): void {
    this.res.className = 'mm-res ' + tone + (text.length > 8 ? ' long' : '');
    this.res.textContent = text;
    if (sub) {
      const s = document.createElement('span');
      s.className = 'sub';
      s.textContent = sub;
      this.res.appendChild(s);
    }
    void this.res.offsetWidth;
    this.res.classList.add('show');
  }

  nameTag(name: string | null, x = 0, y = 0): void {
    if (!name) { this.tag.style.display = 'none'; return; }
    if (this.tag.dataset.n !== name) {
      this.tag.dataset.n = name;
      this.tag.innerHTML = '<small>היריב</small>';
      this.tag.appendChild(document.createTextNode(name));
    }
    this.tag.style.display = 'block';
    this.tag.style.left = `${x}px`;
    this.tag.style.top = `${y}px`;
  }

  destroy(): void { this.root.remove(); }
}
