// Condition language: parsed once to an AST (no eval). See docs/CONTRACTS.md.
// Unknown functions/values: logged once, the whole condition evaluates to false.

export type Ast =
  | { t: 'num'; v: number }
  | { t: 'id'; name: string }
  | { t: 'call'; name: string; args: (string | number)[] }
  | { t: 'bin'; op: string; l: Ast; r: Ast }
  | { t: 'not'; e: Ast }
  | { t: 'neg'; e: Ast }
  | { t: 'never'; reason: string };

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

const OPS = ['&&', '||', '<=', '>=', '==', '!=', '<', '>', '!', '(', ')', ',', '+', '-', '*', '/'];

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ k: 'num', v: parseFloat(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j++;
      out.push({ k: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`unexpected '${c}' at ${i}`);
    // a single '=' is a common typo for '=='
    out.push({ k: 'op', v: op });
    i += op.length;
  }
  return out;
}

export function parseCondition(src: string): Ast {
  try {
    const toks = tokenize(src.replace(/(^|[^=!<>])=(?!=)/g, '$1=='));
    let p = 0;
    const peek = (): Tok | undefined => toks[p];
    const isOp = (v: string): boolean => { const t = toks[p]; return !!t && t.k === 'op' && t.v === v; };
    const expect = (v: string): void => { if (!isOp(v)) throw new Error(`expected '${v}'`); p++; };

    const primary = (): Ast => {
      const t = peek();
      if (!t) throw new Error('unexpected end');
      if (t.k === 'num') { p++; return { t: 'num', v: t.v }; }
      if (t.k === 'op' && t.v === '(') { p++; const e = orE(); expect(')'); return e; }
      if (t.k === 'id') {
        p++;
        if (isOp('(')) {
          p++;
          const args: (string | number)[] = [];
          while (!isOp(')')) {
            const a = peek();
            if (!a) throw new Error('unterminated call');
            if (a.k === 'op' && a.v === '-') { p++; const n = peek(); if (!n || n.k !== 'num') throw new Error('bad arg'); args.push(-n.v); p++; }
            else if (a.k === 'num' || a.k === 'id') { args.push(a.v); p++; }
            else throw new Error('bad arg');
            if (isOp(',')) p++;
            else if (!isOp(')')) throw new Error('expected , or )');
          }
          p++;
          return { t: 'call', name: t.v, args };
        }
        return { t: 'id', name: t.v };
      }
      throw new Error(`unexpected '${t.v}'`);
    };
    const unary = (): Ast => {
      if (isOp('-')) { p++; return { t: 'neg', e: unary() }; }
      if (isOp('!')) { p++; return { t: 'not', e: unary() }; }
      return primary();
    };
    const mul = (): Ast => {
      let l = unary();
      while (isOp('*') || isOp('/')) { const op = (peek() as Tok).v as string; p++; l = { t: 'bin', op, l, r: unary() }; }
      return l;
    };
    const add = (): Ast => {
      let l = mul();
      while (isOp('+') || isOp('-')) { const op = (peek() as Tok).v as string; p++; l = { t: 'bin', op, l, r: mul() }; }
      return l;
    };
    const cmp = (): Ast => {
      const l = add();
      for (const op of ['<=', '>=', '==', '!=', '<', '>']) {
        if (isOp(op)) { p++; return { t: 'bin', op, l, r: add() }; }
      }
      return l;
    };
    const andE = (): Ast => {
      let l = cmp();
      while (isOp('&&')) { p++; l = { t: 'bin', op: '&&', l, r: cmp() }; }
      return l;
    };
    const orE = (): Ast => {
      let l = andE();
      while (isOp('||')) { p++; l = { t: 'bin', op: '||', l, r: andE() }; }
      return l;
    };
    const ast = orE();
    if (p < toks.length) throw new Error(`trailing tokens at ${p}`);
    return ast;
  } catch (e) {
    return { t: 'never', reason: `${(e as Error).message} in "${src}"` };
  }
}

export class UnknownRef extends Error {}

export interface EvalEnv {
  value(name: string): number | undefined;
  call(name: string, args: (string | number)[]): number | undefined;
}

export function evalAst(ast: Ast, env: EvalEnv): number {
  switch (ast.t) {
    case 'num': return ast.v;
    case 'never': throw new UnknownRef(ast.reason);
    case 'id': {
      const v = env.value(ast.name);
      if (v === undefined) throw new UnknownRef(`unknown value '${ast.name}'`);
      return v;
    }
    case 'call': {
      const v = env.call(ast.name, ast.args);
      if (v === undefined) throw new UnknownRef(`unknown function '${ast.name}'`);
      return v;
    }
    case 'not': return evalAst(ast.e, env) ? 0 : 1;
    case 'neg': return -evalAst(ast.e, env);
    case 'bin': {
      if (ast.op === '&&') return evalAst(ast.l, env) && evalAst(ast.r, env) ? 1 : 0;
      if (ast.op === '||') return evalAst(ast.l, env) || evalAst(ast.r, env) ? 1 : 0;
      const l = evalAst(ast.l, env), r = evalAst(ast.r, env);
      switch (ast.op) {
        case '<': return l < r ? 1 : 0;
        case '<=': return l <= r ? 1 : 0;
        case '>': return l > r ? 1 : 0;
        case '>=': return l >= r ? 1 : 0;
        case '==': return l === r ? 1 : 0;
        case '!=': return l !== r ? 1 : 0;
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/': return r === 0 ? 0 : l / r;
      }
      return 0;
    }
  }
}

/** True when the condition holds. Unknown refs: onUnknown(msg) then false. */
export function testCondition(ast: Ast, env: EvalEnv, onUnknown?: (msg: string) => void): boolean {
  try {
    return !!evalAst(ast, env);
  } catch (e) {
    if (e instanceof UnknownRef) { onUnknown?.(e.message); return false; }
    throw e;
  }
}
