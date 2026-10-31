import { describe, expect, it } from 'vitest';
import type { Attributes, ContextMods, MomentKind, MomentSpec } from '../../src/core/types';
import { LIBRARY } from '../../src/match/decision/scenarios';
import {
  attrNorm, buildOptions, contextFit, gameState, hintOption, kindDef, pickVariant, resolveDecision, successChance,
} from '../../src/match/decision/resolve';
import type { Step, Target, Variant } from '../../src/match/decision/types';

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
  it('covers all 15 moment kinds with 3+ variants and 3-4 options each', () => {
    expect(KINDS.length).toBe(15);
    for (const k of KINDS) {
      const def = LIBRARY[k];
      expect(def.kind).toBe(k);
      expect(def.variants.length, k).toBeGreaterThanOrEqual(3);
      for (const v of def.variants) {
        const offered = def.options.filter((o) => v.fit[o.id] !== undefined);
        expect(offered.length, `${k}/${v.id}`).toBeGreaterThanOrEqual(3);
        expect(offered.length, `${k}/${v.id}`).toBeLessThanOrEqual(4);
        for (const f of Object.values(v.fit)) { expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThanOrEqual(1); }
        // there is a real "right read": one option clearly ahead
        const fits = Object.values(v.fit).sort((a, b) => b - a);
        expect(fits[0] - fits[1], `${k}/${v.id} best read margin`).toBeGreaterThanOrEqual(0.049);
        expect(v.note.length).toBeGreaterThan(15);
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

  it('attribute value and difficulty move the chance', () => {
    const s = spec();
    expect(successChance(0.6, 85, 2, s)).toBeGreaterThan(successChance(0.6, 45, 2, s) + 0.15);
    expect(successChance(0.6, 70, 2, { ...s, difficulty: 0.9 })).toBeLessThan(successChance(0.6, 70, 2, { ...s, difficulty: 0.1 }));
    expect(attrNorm(30)).toBe(0);
    expect(attrNorm(90)).toBe(1);
    // safe options are easier to execute than bold ones
    expect(successChance(0.5, 60, 1, s)).toBeGreaterThan(successChance(0.5, 60, 3, s));
    // always some hope, never a sure thing
    expect(successChance(0, 1, 3, { ...s, difficulty: 1 })).toBeGreaterThanOrEqual(0.05);
    expect(successChance(1, 99, 1, { ...s, difficulty: 0 })).toBeLessThanOrEqual(0.93);
  });

  it('a pressure context lowers the chance', () => {
    const calm = spec();
    const hot = spec({ context: { ...CTX0, hostileCrowd: true, rivalInvolved: true, lateClose: true } });
    expect(successChance(0.6, 70, 2, hot)).toBeLessThan(successChance(0.6, 70, 2, calm));
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
        const opts = buildOptions(LIBRARY.shot, v, spec(), attrs(a));
        const o = opts.reduce((x, y) => ((pickBest ? y.fit > x.fit : y.fit < x.fit) ? y : x));
        if (resolveDecision(LIBRARY.shot, o, rnd()).success) ok++;
      }
      return ok / N;
    };
    const good = run(82, true), bad = run(42, false);
    expect(good).toBeGreaterThan(0.6);
    expect(bad).toBeLessThan(0.3);
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

  it('high vision reveals the best read, low vision does not, middle sometimes', () => {
    const best = opts.reduce((a, b) => (b.fit > a.fit ? b : a)).id;
    expect(hintOption(opts, attrs(60, { vision: 80 }), 'ST', 0.99)).toBe(best);
    expect(hintOption(opts, attrs(60, { vision: 40 }), 'ST', 0)).toBeNull();
    expect(hintOption(opts, attrs(60, { vision: 63 }), 'ST', 0.1)).toBe(best);
    expect(hintOption(opts, attrs(60, { vision: 63 }), 'ST', 0.9)).toBeNull();
    // keepers read the game with their goalkeeping
    expect(hintOption(opts, attrs(60, { vision: 30, gk: 85 }), 'GK', 0.99)).toBe(best);
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
