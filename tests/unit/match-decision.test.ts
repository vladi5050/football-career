import { describe, expect, it } from 'vitest';
import type { Attributes, ContextMods, MomentKind, MomentSpec } from '../../src/core/types';
import { LIBRARY } from '../../src/match/decision/scenarios';
import {
  attrEdge, attrNorm, buildOptions, contextFit, gameState, hintOption, hintProbability, kindDef, lessonLine, pickVariant, resolveDecision, successChance,
} from '../../src/match/decision/resolve';
import { LESSONS } from '../../src/match/decision/lessons';
import type { Step, Target, Variant } from '../../src/match/decision/types';
import { KINDS_BY_POS } from '../../src/core/matchSim';
import type { Position } from '../../src/core/types';

const CTX0: ContextMods = { lateClose: false, hostileCrowd: false, rivalInvolved: false, rain: false, derby: false };
const KINDS = Object.keys(LIBRARY) as MomentKind[];
const NAMED = new Set(['far', 'farLow', 'near', 'nearTop', 'farShort', 'nearShort', 'nearWide', 'farWide', 'over', 'GC', 'GL', 'GR', 'up', 'upL', 'upR', 'outL', 'outR', 'ballPt', 'lane']);

const attrs = (v: number, over: Partial<Attributes> = {}): Attributes => ({
  finishing: v, passing: v, dribbling: v, pace: v, stamina: v, defending: v, heading: v, vision: v, gk: v, ...over,
});
const spec = (over: Partial<MomentSpec> = {}): MomentSpec => ({
  id: 7, kind: 'shot', minute: 30, difficulty: 0.5, attackerSkill: 60, opponentId: 1, opponentName: 'x',
  context: { ...CTX0 }, scoreBefore: [0, 0], stakes: 'דקה 30, 0-0', ...over,
});

function targetIds(t: Target): string[] {
  if (Array.isArray(t)) return [];
  if (typeof t === 'string') return NAMED.has(t) ? [] : [t];
  if ('id' in t) return [t.id];
  return NAMED.has(t.p) ? [] : [`?${t.p}`];
}

describe('scenario library', () => {
  it('covers all 30 moment kinds with 3+ variants and 3-4 options each', () => {
    expect(KINDS.length).toBe(30);
    for (const k of Object.values(KINDS_BY_POS).flat().map(([kk]) => kk)) expect(LIBRARY[k], k).toBeDefined();
    for (const k of KINDS) {
      const def = LIBRARY[k];
      expect(def.kind).toBe(k);
      expect(def.variants.length, k).toBeGreaterThanOrEqual(3);
      const ids = new Set<string>();
      for (const v of def.variants) {
        expect(ids.has(v.id), `${k}/${v.id} unique`).toBe(false);
        ids.add(v.id);
        const offered = def.options.filter((o) => v.fit[o.id] !== undefined);
        expect(offered.length, `${k}/${v.id}`).toBeGreaterThanOrEqual(3);
        expect(offered.length, `${k}/${v.id}`).toBeLessThanOrEqual(4);
        for (const id of Object.keys(v.fit)) expect(def.options.some((o) => o.id === id), `${k}/${v.id} fit key ${id}`).toBe(true);
        for (const f of Object.values(v.fit)) { expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThanOrEqual(1); }
        // there is a real "right read": one option clearly ahead (new situations sit at 0.75-0.85)
        const fits = Object.values(v.fit).sort((a, b) => b - a);
        expect(fits[0] - fits[1], `${k}/${v.id} best read margin`).toBeGreaterThanOrEqual(0.049);
        expect(fits[0], `${k}/${v.id} best fit`).toBeGreaterThanOrEqual(0.6);
        expect(fits[0], `${k}/${v.id} best fit`).toBeLessThanOrEqual(0.9);
        expect(v.note.length).toBeGreaterThan(15);
        expect(v.note, `${k}/${v.id} note`).not.toMatch(/\u2014/);
      }
      for (const o of def.options) {
        expect(o.ok.length, `${k}/${o.id} ok`).toBeGreaterThan(0);
        expect(o.fail.length, `${k}/${o.id} fail`).toBeGreaterThan(0);
        expect(o.say.join(' '), `${k}/${o.id} say`).not.toMatch(/\u2014/);
        expect(o.say[0], `${k}/${o.id} say`).toContain('{name}');
      }
    }
  });

  const POSITIONS: Position[] = ['ST', 'W', 'AM', 'CM', 'DM', 'CB', 'FB', 'GK'];
  /** Variants a position can be shown: its KINDS_BY_POS kinds, through the role and pos filters of pickVariant. */
  const reachable = (pos: Position): Set<string> => {
    const out = new Set<string>();
    for (const [k] of KINDS_BY_POS[pos]) {
      const def = LIBRARY[k];
      for (let id = 0; id < 400; id++) out.add(`${k}/${pickVariant(def, { id, minute: 1 + (id % 90) }, pos).id}`);
    }
    return out;
  };

  it('at least 150 situations, and every position reaches at least 25 of its own', () => {
    const total = KINDS.reduce((a, k) => a + LIBRARY[k].variants.length, 0);
    expect(total).toBeGreaterThanOrEqual(150);
    for (const pos of POSITIONS) {
      const r = reachable(pos);
      expect(r.size, pos).toBeGreaterThanOrEqual(25);
      // the situations shown are role-true: a variant with a pos list only reaches those positions
      for (const key of r) {
        const [k, id] = key.split('/') as [MomentKind, string];
        const v = LIBRARY[k].variants.find((x) => x.id === id)!;
        if (v.pos && LIBRARY[k].variants.some((x) => (!x.role || x.role === (pos === 'GK' ? 'keeper' : 'taker')) && (!x.pos || x.pos.includes(pos)))) {
          expect(v.pos, `${pos} ${key}`).toContain(pos);
        }
      }
    }
    // keeper-only kinds never reach an outfield player as a keeper situation, and vice versa
    for (const pos of POSITIONS.filter((p) => p !== 'GK')) for (const k of ['distribution', 'claim_cross'] as MomentKind[]) {
      expect(KINDS_BY_POS[pos].some(([kk]) => kk === k), `${pos} ${k}`).toBe(false);
    }
  });

  it('pickVariant avoids recently shown situations and stays deterministic', () => {
    const def = LIBRARY.hold_up;
    const first = pickVariant(def, { id: 3, minute: 20 }, 'ST');
    expect(pickVariant(def, { id: 3, minute: 20 }, 'ST').id).toBe(first.id);
    const recent: string[] = [];
    const seen = new Set<string>();
    const pool = def.variants.filter((v) => !v.pos || v.pos.includes('ST'));
    for (let i = 0; i < pool.length; i++) {
      const v = pickVariant(def, { id: 3, minute: 20 }, 'ST', recent);
      expect(seen.has(v.id), `repeat ${v.id} after ${[...seen]}`).toBe(false);
      seen.add(v.id); recent.push(`hold_up/${v.id}`);
    }
    // all seen: the one shown longest ago comes back
    expect(pickVariant(def, { id: 3, minute: 20 }, 'ST', recent).id).toBe(recent[0].split('/')[1]);
  });

  it('every board is valid: inside the 100x112 pitch, labels name magnets that exist', () => {
    const inside = (x: number, y: number, where: string) => {
      expect(x, `${where} x`).toBeGreaterThanOrEqual(0); expect(x, `${where} x`).toBeLessThanOrEqual(100);
      expect(y, `${where} y`).toBeGreaterThanOrEqual(0); expect(y, `${where} y`).toBeLessThanOrEqual(112);
    };
    for (const k of KINDS) {
      const def = LIBRARY[k];
      for (const v of def.variants) {
        const ids = new Set(v.magnets.map((m) => m.id));
        expect(ids.size, `${k}/${v.id} unique magnets`).toBe(v.magnets.length);
        for (const m of v.magnets) inside(m.x, m.y, `${k}/${v.id} ${m.id}`);
        inside(v.ball[0], v.ball[1], `${k}/${v.id} ball`);
        for (const a of v.arrows) for (const t of [a.from, a.to]) if (Array.isArray(t)) inside(t[0], t[1], `${k}/${v.id} arrow`);
        for (const o of def.options) {
          if (v.fit[o.id] === undefined) continue;
          const label = v.labels?.[o.id] ?? o.label;
          for (const [, id] of label.matchAll(/\{(m\d|d\d|s\d)\}/g)) expect(ids.has(id), `${k}/${v.id} label ${o.id}: ${id}`).toBe(true);
          // a ball tipped over the bar may leave the board by a few units
          for (const s of [...o.ok, ...o.fail]) if (Array.isArray(s.to)) inside(s.to[0], s.w === 'ball' ? Math.max(0, s.to[1] + 6) : s.to[1], `${k}/${v.id} ${o.id} step`);
        }
      }
    }
  });

  it('penalty has taker and keeper situations; pickVariant respects the role', () => {
    const def = LIBRARY.penalty;
    expect(def.variants.some((v) => v.role === 'keeper')).toBe(true);
    expect(def.variants.some((v) => v.role === 'taker')).toBe(true);
    for (let id = 0; id < 30; id++) {
      expect(pickVariant(def, { id, minute: 50 }, 'GK').role).toBe('keeper');
      expect(pickVariant(def, { id, minute: 50 }, 'ST').role).toBe('taker');
    }
  });

  it('every choreography step and arrow references magnets that exist in the variant', () => {
    for (const k of KINDS) {
      const def = LIBRARY[k];
      for (const v of def.variants) {
        const ids = new Set(v.magnets.map((m) => m.id));
        const check = (where: string, id: string) => expect(ids.has(id), `${k}/${v.id} ${where}: ${id}`).toBe(true);
        expect(ids.has('me'), `${k}/${v.id} has the user`).toBe(true);
        for (const a of v.arrows) for (const id of [...targetIds(a.from), ...targetIds(a.to)]) check('arrow', id);
        for (const o of def.options) {
          if (v.fit[o.id] === undefined) continue;
          const steps: Step[] = [...o.ok, ...o.fail];
          for (const s of steps) {
            if (s.w !== 'ball') check(`${o.id}.w`, s.w);
            for (const id of targetIds(s.to)) check(`${o.id}.to`, id);
          }
        }
      }
    }
  });

  it('labels and commentator lines are filled (no template left)', () => {
    for (const k of KINDS) {
      const def = LIBRARY[k];
      for (const v of def.variants) {
        for (const o of buildOptions(def, v, spec({ kind: k }), attrs(60))) expect(o.label, `${k}/${v.id}/${o.id}`).not.toMatch(/[{}]/);
      }
      for (const o of def.options) {
        const r = resolveDecision(def, { id: o.id, label: o.label, icon: o.icon, attr: o.attr, attrValue: 60, risk: o.risk, fit: 0.5, chance: 0.5, tpl: o }, 0.1, 'דני כהן');
        expect(r.line).toContain('כהן');
        expect(r.line).not.toMatch(/\{name\}/);
      }
    }
  });
});

describe('resolver: fits, attributes, context', () => {
  const v: Variant = LIBRARY.shot.variants[0];

  it('the right read has a clearly better chance than the wrong one (same attributes)', () => {
    const opts = buildOptions(LIBRARY.shot, v, spec(), attrs(65));
    const best = opts.reduce((a, b) => (b.fit > a.fit ? b : a));
    const worst = opts.reduce((a, b) => (b.fit < a.fit ? b : a));
    expect(best.chance - worst.chance).toBeGreaterThan(0.15);
  });

  it('attributes count relative to the player\'s own level; difficulty carries the absolute gap', () => {
    const s = spec({ attackerSkill: 40 });
    // an option on the player's strength beats one on his weakness
    expect(successChance(0.6, 60, 2, s)).toBeGreaterThan(successChance(0.6, 25, 2, s) + 0.15);
    expect(attrEdge(40, 40)).toBe(0);
    expect(attrEdge(90, 40)).toBe(1);
    // a youngster (40 at 40) and a star (85 at 85) face the same odds at the same difficulty
    expect(successChance(0.8, 40, 2, spec({ attackerSkill: 40 }))).toBeCloseTo(successChance(0.8, 85, 2, spec({ attackerSkill: 85 })), 6);
    expect(successChance(0.6, 70, 2, { ...s, difficulty: 0.9 })).toBeLessThan(successChance(0.6, 70, 2, { ...s, difficulty: 0.1 }));
    expect(attrNorm(30)).toBe(0);
    expect(attrNorm(90)).toBe(1);
    // safe options are easier to execute than bold ones
    expect(successChance(0.5, 60, 1, s)).toBeGreaterThan(successChance(0.5, 60, 3, s));
    // always some hope, never a sure thing
    expect(successChance(0, 1, 3, { ...s, difficulty: 1 })).toBeGreaterThanOrEqual(0.05);
    expect(successChance(1, 99, 1, { ...s, difficulty: 0 })).toBeLessThanOrEqual(0.9);
  });

  it('calibration for a youngster (attributes ≈ his level, difficulty 0.5)', () => {
    const young = attrs(40);
    const best: number[] = [], worst: number[] = [], all: number[] = [], saves: number[] = [];
    for (const k of KINDS) {
      if (k === 'penalty') continue;
      for (const vv of LIBRARY[k].variants) {
        const opts = buildOptions(LIBRARY[k], vv, spec({ kind: k, attackerSkill: 40 }), young);
        const sorted = [...opts].sort((x, y) => y.fit - x.fit);
        best.push(sorted[0].chance);
        worst.push(sorted[sorted.length - 1].chance);
        all.push(...opts.map((o) => o.chance));
        if (k === 'save' || k === 'rush_out') saves.push(sorted[0].chance);
      }
    }
    const avg = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
    // QA round 4: the right read succeeds ≈ 55-65%, random picks ≈ 35-40% (keepers included in these averages)
    expect(avg(best)).toBeGreaterThanOrEqual(0.55);
    expect(avg(best)).toBeLessThanOrEqual(0.65);
    expect(avg(worst)).toBeGreaterThanOrEqual(0.15);
    expect(avg(worst)).toBeLessThanOrEqual(0.28);
    expect(avg(all)).toBeGreaterThan(0.35); // rotating / random picks
    expect(avg(all)).toBeLessThan(0.45);
    expect(avg(saves)).toBeGreaterThanOrEqual(0.5);
    expect(avg(saves)).toBeLessThanOrEqual(0.6);
    // penalties: takers convert most good reads; a keeper reading the taker saves about half
    const taker = LIBRARY.penalty.variants.filter((x) => x.role === 'taker').map((x) => Math.max(...buildOptions(LIBRARY.penalty, x, spec({ kind: 'penalty', attackerSkill: 40 }), young).map((o) => o.chance)));
    const keeper = LIBRARY.penalty.variants.filter((x) => x.role === 'keeper').map((x) => Math.max(...buildOptions(LIBRARY.penalty, x, spec({ kind: 'penalty', attackerSkill: 40 }), young).map((o) => o.chance)));
    expect(avg(taker)).toBeGreaterThan(0.6);
    expect(avg(keeper)).toBeGreaterThan(0.4);
    expect(avg(keeper)).toBeLessThan(0.6);
  });

  it('late with a lead favours keeping the ball; chasing favours the bold read', () => {
    const lead = spec({ minute: 88, scoreBefore: [1, 0], context: { ...CTX0, lateClose: true } });
    const chase = spec({ minute: 88, scoreBefore: [0, 1], context: { ...CTX0, lateClose: true } });
    expect(gameState(lead)).toBe(1);
    expect(gameState(chase)).toBe(-1);
    expect(gameState(spec())).toBe(0);
    const shield = LIBRARY.dribble.options.find((o) => o.id === 'shield')!;
    expect(contextFit(0.4, shield, lead)).toBeGreaterThan(contextFit(0.4, shield, spec()));
    expect(contextFit(0.4, shield, chase)).toBeLessThan(contextFit(0.4, shield, spec()));
    const bold = LIBRARY.shot.options.find((o) => o.risk === 3 && !o.ctx)!;
    expect(contextFit(0.5, bold, lead)).toBeLessThan(0.5);
    expect(contextFit(0.5, bold, chase)).toBeGreaterThan(0.5);
    // the protect shift is large enough to flip the best read: 1-0 up at 88' → keep the ball
    const dv = LIBRARY.dribble.variants[0];
    const pickBest = (s: MomentSpec) => buildOptions(LIBRARY.dribble, dv, s, attrs(60)).reduce((a, b) => (b.fit > a.fit ? b : a)).id;
    expect(pickBest(spec({ kind: 'dribble' }))).toBe('outside');
    expect(['layoff', 'shield']).toContain(pickBest({ ...lead, kind: 'dribble' }));
  });

  it('rain hurts dribbling reads', () => {
    const wet = spec({ context: { ...CTX0, rain: true } });
    const cutIn = LIBRARY.shot.options.find((o) => o.id === 'cut_in')!;
    expect(contextFit(0.5, cutIn, wet)).toBeLessThan(0.5);
  });

  it('Monte Carlo: a good player making the right read succeeds far more often than a weak player guessing wrong', () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const run = (a: number, pickBest: boolean) => {
      let ok = 0;
      const N = 4000;
      for (let i = 0; i < N; i++) {
        const opts = buildOptions(LIBRARY.shot, v, spec({ attackerSkill: 50 }), attrs(a));
        const o = opts.reduce((x, y) => ((pickBest ? y.fit > x.fit : y.fit < x.fit) ? y : x));
        if (resolveDecision(LIBRARY.shot, o, rnd()).success) ok++;
      }
      return ok / N;
    };
    // the right read on his strength vs. the wrong read on his weakness (relative to his level, 50)
    const good = run(70, true), bad = run(30, false);
    expect(good).toBeGreaterThan(0.55);
    expect(bad).toBeLessThan(0.2);
  });
});

describe('resolver: outcome, timeout, vision hint', () => {
  const def = kindDef('shot');
  const opts = buildOptions(def, def.variants[0], spec(), attrs(70));
  const o = opts[0];

  it('rnd below the chance succeeds, above fails; success quality beats failure quality', () => {
    const win = resolveDecision(def, o, 0);
    const lose = resolveDecision(def, o, 0.999);
    expect(win.success).toBe(true);
    expect(lose.success).toBe(false);
    expect(win.quality).toBeGreaterThan(lose.quality);
    expect(win.quality).toBeLessThanOrEqual(1);
    expect(lose.quality).toBeGreaterThanOrEqual(0);
    expect(win.stamp).toBe('גול!');
    expect(win.optionId).toBe(o.id);
  });

  it('timeout is the weakest outcome', () => {
    const t = resolveDecision(def, null, 0, 'אבי לוי');
    expect(t.success).toBe(false);
    expect(t.optionId).toBeNull();
    expect(t.stamp).toBe('היססת');
    expect(t.line).toContain('לוי');
    for (const x of opts) expect(t.quality).toBeLessThan(resolveDecision(def, x, 0.999).quality);
  });

  it('vision hints: 40 → about half the moments, 70+ always, weak vision rarely', () => {
    const best = opts.reduce((a, b) => (b.fit > a.fit ? b : a)).id;
    expect(hintProbability(40)).toBeCloseTo(0.5, 6);
    expect(hintProbability(70)).toBe(1);
    expect(hintProbability(10)).toBe(0.15);
    expect(hintOption(opts, attrs(60, { vision: 80 }), 'ST', 0.99)).toBe(best);
    expect(hintOption(opts, attrs(60, { vision: 40 }), 'ST', 0.45)).toBe(best);
    expect(hintOption(opts, attrs(60, { vision: 40 }), 'ST', 0.55)).toBeNull();
    // keepers read the game with their goalkeeping
    expect(hintOption(opts, attrs(60, { vision: 20, gk: 85 }), 'GK', 0.99)).toBe(best);
    let seen = 0;
    for (let i = 0; i < 1000; i++) if (hintOption(opts, attrs(40), 'ST', i / 1000)) seen++;
    expect(seen).toBeGreaterThan(450);
    expect(seen).toBeLessThan(550);
  });

  it('"מה היה נכון" after a poor read or a timeout, reassurance after a good read that failed', () => {
    const vv = def.variants[0];
    const sorted = [...opts].sort((a, b) => b.fit - a.fit);
    const bad = lessonLine('shot', vv, opts, sorted[sorted.length - 1], false)!;
    expect(bad.kind).toBe('lesson');
    expect(bad.text).toContain('מה היה נכון');
    expect(bad.text).toContain(sorted[0].label);
    expect(lessonLine('shot', vv, opts, sorted[sorted.length - 1], true)!.kind).toBe('lesson'); // lucky, still a lesson
    expect(lessonLine('shot', vv, opts, null, false)!.kind).toBe('lesson');
    expect(lessonLine('shot', vv, opts, sorted[0], false)!.kind).toBe('good');
    expect(lessonLine('shot', vv, opts, sorted[0], true)).toBeNull();
  });

  it('every situation has a lesson', () => {
    for (const k of KINDS) for (const vv of LIBRARY[k].variants) expect(LESSONS[`${k}/${vv.id}`], `${k}/${vv.id}`).toBeTruthy();
  });

  it('kindDef falls back for unknown kinds and pickVariant is deterministic', () => {
    expect(kindDef('nope' as MomentKind).kind).toBe('shot');
    const a = pickVariant(def, { id: 11, minute: 40 });
    const b = pickVariant(def, { id: 11, minute: 40 });
    expect(a.id).toBe(b.id);
  });
});

describe('shirt number clash', () => {
  it('a teammate with the user\'s number is renumbered, and the note follows', async () => {
    const { renumber } = await import('../../src/match/decision/index');
    const v = LIBRARY.shot.variants[1]; // the 9 asks for a one-two
    expect(v.note).toContain('ה-9');
    const { variant, fixText } = renumber(v, 9);
    const m1 = variant.magnets.find((m) => m.id === 'm1')!;
    expect(m1.n).not.toBe(9);
    expect(variant.note).not.toContain('ה-9');
    expect(variant.note).toContain(`ה-${m1.n}`);
    expect(fixText('קיר מושלם בין כהן ל-9')).toBe(`קיר מושלם בין כהן ל-${m1.n}`);
    expect(fixText('בעיטה מ-19 מטר')).toBe('בעיטה מ-19 מטר');
    const same = renumber(v, 23);
    expect(same.variant).toBe(v);
  });
});
