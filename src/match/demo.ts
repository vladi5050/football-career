// Standalone dev page for the key-moment player: /src/match/demo.html
// URL params (for automation): ?mode=decision&vision=80&pos=CB&timer=0&kind=shot&rain=1&lateClose=1&hostileCrowd=1&rivalInvolved=1&derby=1&asKeeper=1&difficulty=0.5&skill=70&auto=1&bare=1&seed=3
import type { MomentKind, MomentResult, MomentSpec } from '../core/types';
import { playMoment, MOMENT_FACTORIES } from './index';
import { playDecisionMoment } from './decision';

const KIND_LABEL: Record<MomentKind, string> = {
  shot: 'בעיטה', one_on_one: 'אחד על אחד', header: 'נגיחה', dribble: 'דריבל', through_ball: 'מסירת עומק', long_shot: 'בעיטה מרחוק',
  interception: 'חטיפה', tackle: 'תיקול', block: 'חסימה', clearance: 'הרחקה', save: 'הצלה', rush_out: 'יציאה מהשער',
  penalty: 'פנדל', free_kick: 'בעיטה חופשית', cross: 'הגבהה',
  hold_up: 'משחק גב', press: 'לחץ גבוה', counter: 'מתפרצת', cutback: 'החזרה לאחור', overlap: 'עקיפה באגף', between_lines: 'בין הקווים',
  switch_play: 'החלפת אגף', second_ball: 'כדור שני', build_up: 'יציאה מהלחץ', recovery: 'חזרה להגנה', last_man: 'אחרון בהגנה',
  aerial_duel: 'מאבק אווירי', set_piece_defend: 'הגנה על מצב נייח', distribution: 'הוצאת כדור', claim_cross: 'יציאה להגבהה',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const host = $('host');
const sel = $<HTMLSelectElement>('kind');
// decision mode offers every kind; the arcade player only has scenes for the original 15
for (const k of (params.get('mode') === 'decision' ? Object.keys(KIND_LABEL) : Object.keys(MOMENT_FACTORIES)) as MomentKind[]) {
  const o = document.createElement('option');
  o.value = k; o.textContent = `${KIND_LABEL[k]} (${k})`;
  sel.appendChild(o);
}
const flags = ['lateClose', 'hostileCrowd', 'rivalInvolved', 'rain', 'derby', 'asKeeper', 'reducedMotion'] as const;
if (params.get('kind')) sel.value = params.get('kind')!;
for (const f of flags) if (params.get(f) === '1') $<HTMLInputElement>(f).checked = true;
if (params.get('difficulty')) $<HTMLInputElement>('difficulty').value = params.get('difficulty')!;
if (params.get('skill')) $<HTMLInputElement>('skill').value = params.get('skill')!;
if (params.get('bare') === '1') document.body.classList.add('bare');

let seq = Number(params.get('seed') ?? Math.floor(Math.random() * 1000));
let busy = false;
const log = (s: string) => { $('log').textContent = s + '\n' + $('log').textContent; };

function makeSpec(kind: MomentKind): MomentSpec {
  const chk = (id: string) => $<HTMLInputElement>(id).checked;
  const late = chk('lateClose');
  return {
    id: ++seq,
    kind,
    minute: late ? 88 : 20 + (seq * 7) % 60,
    difficulty: Number($<HTMLInputElement>('difficulty').value),
    attackerSkill: Number($<HTMLInputElement>('skill').value),
    opponentId: 42,
    opponentName: 'אבי לוי',
    context: { lateClose: late, hostileCrowd: chk('hostileCrowd'), rivalInvolved: chk('rivalInvolved'), rain: chk('rain'), derby: chk('derby') },
    scoreBefore: params.get('lead') === '1' ? [1, 0] : late ? [1, 1] : [0, 0],
    stakes: late ? 'דקה 88, 1-1. הכל על הכף' : 'הזדמנות לפתוח את המשחק',
  };
}

async function run(kind: MomentKind): Promise<MomentResult> {
  $('idle')?.remove();
  const spec = makeSpec(kind);
  if (params.get('mode') === 'decision') {
    const sk = Number($<HTMLInputElement>('skill').value);
    const keeper = $<HTMLInputElement>('asKeeper').checked;
    const vis = Number(params.get('vision') ?? sk);
    const res = await playDecisionMoment(host, spec, {
      attr: { finishing: sk, passing: sk, dribbling: sk, pace: sk, stamina: sk, defending: sk, heading: sk, vision: vis, gk: keeper ? sk : 20 },
      pos: keeper ? 'GK' : (params.get('pos') as never) ?? 'ST',
      colors: { user: ['#0B7A3B', '#FFFFFF'], opp: ['#C8102E', '#FFFFFF'] },
      userName: 'דני כהן', shirt: 9,
      reducedMotion: $<HTMLInputElement>('reducedMotion').checked,
      timer: params.get('timer') !== null ? Number(params.get('timer')) : undefined,
    });
    (window as unknown as { __results: MomentResult[] }).__results.push(res);
    log(`${kind}: ${res.skipped ? 'skipped' : res.success ? 'SUCCESS' : 'fail'} q=${res.quality}`);
    return res;
  }
  const res = await playMoment(host, spec, {
    reducedMotion: $<HTMLInputElement>('reducedMotion').checked,
    asKeeper: $<HTMLInputElement>('asKeeper').checked,
    colors: { user: ['#0B7A3B', '#FFFFFF'], opp: ['#C8102E', '#FFFFFF'] },
  });
  (window as unknown as { __results: MomentResult[] }).__results.push(res);
  log(`${kind}: ${res.skipped ? 'skipped' : res.success ? 'SUCCESS' : 'fail'} q=${res.quality}`);
  return res;
}
(window as unknown as { __results: MomentResult[] }).__results = [];

$('play').onclick = async () => { if (busy) return; busy = true; try { await run(sel.value as MomentKind); } finally { busy = false; } };
$('skip').onclick = () => host.dispatchEvent(new CustomEvent('moment-skip'));
$('all').onclick = async () => {
  if (busy) return; busy = true;
  try { for (let i = 0; i < 5; i++) await run(sel.value as MomentKind); } finally { busy = false; }
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  log(`canvases in DOM: ${document.querySelectorAll('canvas').length}${mem ? ` heap=${(mem.usedJSHeapSize / 1e6).toFixed(1)}MB` : ''}`);
};
(window as unknown as { __play: (k: string) => Promise<MomentResult> }).__play = (k: string) => run(k as MomentKind);
if (params.get('auto') === '1') void run(sel.value as MomentKind);
