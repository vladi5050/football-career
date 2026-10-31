import { describe, expect, it } from 'vitest';
import { evalAst, parseCondition, testCondition, type EvalEnv } from '../../src/core/conditions';

const env = (vals: Record<string, number>, calls: Record<string, (a: (string | number)[]) => number> = {}): EvalEnv => ({
  value: (n) => vals[n],
  call: (n, a) => calls[n]?.(a),
});

describe('condition parser', () => {
  const e = env({ age: 17, fame: 30, morale: 50 }, {
    rel: (a) => (a[0] === 'coach' ? 25 : -10),
    flag: (a) => (a[0] === 'party' ? 2 : 0),
    recent: (a) => (a[0] === 'injury' && Number(a[1]) >= 4 ? 1 : 0),
    trait: (a) => (a[0] === 'coach' && a[1] === 'hot_tempered' ? 1 : 0),
  });
  const t = (src: string): boolean => testCondition(parseCondition(src), e);
  it('comparisons and numbers', () => {
    expect(t('age >= 17')).toBe(true);
    expect(t('age > 17')).toBe(false);
    expect(t('fame == 30')).toBe(true);
    expect(t('fame != 30')).toBe(false);
    expect(t('morale < 50.5')).toBe(true);
  });
  it('functions with args', () => {
    expect(t('rel(coach) < 30')).toBe(true);
    expect(t('rel(agent) < -5')).toBe(true);
    expect(t('flag(party) >= 1')).toBe(true);
    expect(t('recent(injury, 6)')).toBe(true);
    expect(t('recent(injury, 2)')).toBe(false);
    expect(t('trait(coach, hot_tempered) == 1')).toBe(true);
  });
  it('boolean operators and precedence', () => {
    expect(t('age > 20 || fame > 20 && morale == 50')).toBe(true);
    expect(t('(age > 20 || fame > 20) && morale == 49')).toBe(false);
    expect(t('!(age > 20)')).toBe(true);
    expect(t('!flag(nothing)')).toBe(true);
    expect(t('age + 3 == 20')).toBe(true);
    expect(t('-age < 0')).toBe(true);
  });
  it('single = is read as ==', () => {
    expect(t('age = 17')).toBe(true);
  });
  it('unknown function or value: false, reported', () => {
    const msgs: string[] = [];
    expect(testCondition(parseCondition('unknownFn(x) > 1'), e, (m) => msgs.push(m))).toBe(false);
    expect(testCondition(parseCondition('nope > 1 || age > 1'), e, (m) => msgs.push(m))).toBe(false);
    expect(msgs.length).toBe(2);
  });
  it('syntax errors become a never node, not an exception', () => {
    const ast = parseCondition('rel(coach < 3');
    expect(ast.t).toBe('never');
    expect(testCondition(ast, e)).toBe(false);
    expect(parseCondition('age >= ').t).toBe('never');
    expect(parseCondition('age $ 3').t).toBe('never');
  });
  it('evaluates to numbers', () => {
    expect(evalAst(parseCondition('age * 2'), e)).toBe(34);
  });
});
