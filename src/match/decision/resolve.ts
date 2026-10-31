// Pure resolver for decision moments (no DOM). Unit tested in tests/unit/match-decision.test.ts.
import type { Attributes, MomentSpec, Position } from '../../core/types';
import { LIBRARY } from './scenarios';
import type { DecisionOption, KindDef, OptAttr, OptionTpl, Resolved, Variant } from './types';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export const ATTR_HE: Record<OptAttr, string> = {
  finishing: 'סיומת', passing: 'מסירה', dribbling: 'כדרור', pace: 'מהירות', heading: 'ראש', vision: 'ראיית משחק',
  defending: 'הגנה', gk: 'שוערות', stamina: 'סיבולת',
};

export const RISK_HE = ['', 'בטוח', 'מאוזן', 'נועז'] as const;

/** Is the user's team protecting a lead late on (+1), chasing (-1) or neither (0)? */
export function gameState(spec: Pick<MomentSpec, 'minute' | 'scoreBefore' | 'context'>): -1 | 0 | 1 {
  const late = spec.context.lateClose || spec.minute >= 80;
  if (!late) return 0;
  const d = spec.scoreBefore[0] - spec.scoreBefore[1];
  if (d > 0) return 1;
  return -1;
}

/**
 * Situational fit after context: protecting a lead late on favours keeping the ball (bold:false +0.3, risky −0.08/−0.15),
 * chasing favours bold reads (+0.08) and punishes safe ones (−0.12), rain hurts touch play (−0.08).
 */
export function contextFit(base: number, tpl: OptionTpl, spec: Pick<MomentSpec, 'minute' | 'scoreBefore' | 'context'>): number {
  let f = base;
  const c = tpl.ctx ?? {};
  const st = gameState(spec);
  if (st === 1) f += c.protect ?? (tpl.bold === false ? 0.3 : tpl.risk === 1 ? 0.12 : tpl.risk === 3 ? -0.15 : -0.08);
  if (st === -1) f += c.chase ?? (tpl.risk === 3 ? 0.08 : tpl.risk === 1 && tpl.bold === false ? -0.12 : 0);
  if (spec.context.rain) f += c.rain ?? (tpl.attr === 'dribbling' || tpl.icon === 'chip' ? -0.08 : 0);
  if (spec.context.hostileCrowd) f += c.hostile ?? 0;
  if (spec.context.rivalInvolved) f += c.rival ?? 0;
  return clamp(f, 0, 1);
}

/** 30 → 0, 90 → 1 */
export const attrNorm = (v: number) => clamp((v - 30) / 60, 0, 1);

const RISK_BASE = [0, 0.1, 0, -0.1];

/** Success chance of an option. */
export function successChance(fit: number, attrValue: number, risk: 1 | 2 | 3, spec: Pick<MomentSpec, 'difficulty' | 'context'>): number {
  let p = 0.1 + 0.42 * fit + 0.36 * attrNorm(attrValue) - 0.26 * clamp(spec.difficulty, 0, 1) + RISK_BASE[risk];
  if (spec.context.hostileCrowd) p -= 0.03;
  if (spec.context.rivalInvolved) p -= 0.03;
  if (spec.context.lateClose) p -= 0.02;
  return clamp(p, 0.05, 0.93);
}

/** Quality of the execution 0..1. */
export function outcomeQuality(success: boolean, fit: number, attrValue: number, risk: 1 | 2 | 3, bold: boolean): number {
  const a = attrNorm(attrValue);
  if (success) return clamp(0.5 + 0.22 * fit + 0.1 * a + 0.08 * (risk - 1) + (bold ? 0.04 : -0.04), 0, 1);
  return clamp(0.12 + 0.2 * fit + 0.06 * a - 0.04 * (risk - 1), 0, 1);
}

export function kindDef(kind: MomentSpec['kind']): KindDef {
  return LIBRARY[kind] ?? LIBRARY.shot;
}

/** Variant choice: deterministic per spec id, filtered by keeper role for penalties. */
export function pickVariant(def: KindDef, spec: Pick<MomentSpec, 'id' | 'minute'>, pos?: Position): Variant {
  const role = pos === 'GK' ? 'keeper' : 'taker';
  const list = def.variants.filter((v) => !v.role || v.role === role);
  const pool = list.length ? list : def.variants;
  const h = Math.abs((spec.id * 2654435761 + spec.minute * 97) | 0);
  return pool[h % pool.length];
}

export function attrValue(attr: Attributes, key: OptAttr): number {
  return attr[key] ?? 50;
}

export function fillLabel(s: string, v: Variant): string {
  return s.replace(/\{(m\d|d\d|s\d)\}/g, (_, id: string) => {
    const m = v.magnets.find((x) => x.id === id);
    return m?.n !== undefined ? `#${m.n}` : 'החבר';
  });
}

export function buildOptions(def: KindDef, v: Variant, spec: MomentSpec, attr: Attributes): DecisionOption[] {
  const out: DecisionOption[] = [];
  for (const tpl of def.options) {
    const base = v.fit[tpl.id];
    if (base === undefined) continue;
    const fit = contextFit(base, tpl, spec);
    const av = attrValue(attr, tpl.attr);
    out.push({
      id: tpl.id, label: fillLabel(v.labels?.[tpl.id] ?? tpl.label, v), icon: tpl.icon, attr: tpl.attr, attrValue: Math.floor(av),
      risk: tpl.risk, fit, chance: successChance(fit, av, tpl.risk, spec), tpl,
    });
  }
  return out;
}

/**
 * Vision reveals the best read: vision >= 72 always, 55..71 sometimes (rnd < (v-55)/17), lower never.
 * Keepers read the game with `gk`.
 */
export function hintOption(opts: DecisionOption[], attr: Attributes, pos: Position | undefined, rnd: number): string | null {
  const v = pos === 'GK' ? Math.max(attr.vision, attr.gk) : attr.vision;
  const show = v >= 72 || (v >= 55 && rnd < (v - 55) / 17);
  if (!show || !opts.length) return null;
  let best = opts[0];
  for (const o of opts) if (o.fit > best.fit) best = o;
  return best.id;
}

export function surname(name?: string): string {
  if (!name) return 'השחקן';
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || name;
}

/** Resolve a pick. `rnd` in [0,1). opt=null is a timeout (weakest outcome). */
export function resolveDecision(def: KindDef, opt: DecisionOption | null, rnd: number, userName?: string): Resolved {
  const name = surname(userName);
  if (!opt) {
    return { optionId: null, success: false, quality: 0.05, stamp: 'היססת', line: `${name} קפא לרגע, וההזדמנות חלפה.` };
  }
  const success = rnd < opt.chance;
  const quality = outcomeQuality(success, opt.fit, opt.attrValue, opt.risk, opt.tpl.bold !== false);
  const stamp = (opt.tpl.stamp ?? def.stamp)[success ? 0 : 1];
  const line = opt.tpl.say[success ? 0 : 1].replace(/\{name\}/g, name);
  return { optionId: opt.id, success, quality: Math.round(quality * 100) / 100, stamp, line };
}
