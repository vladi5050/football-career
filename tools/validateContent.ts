// Content validator. Run: npx vite-node tools/validateContent.ts
// Loads every JSON bundle in src/content and checks it against docs/CONTRACTS.md.
// Exit code 1 on any error. Warnings never fail the run.
import leaguesJson from '../src/content/leagues.json';
import namesJson from '../src/content/names.json';
import wagesJson from '../src/content/wages.json';
import themesJson from '../src/content/themes.json';
import eventsJson from '../src/content/events.json';
import type { EventTemplate, LeagueSeed, NamePool, Theme, WageBands } from '../src/core/content';

const errors: string[] = [];
const warnings: string[] = [];
const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);
const warn = (where: string, msg: string) => warnings.push(`${where}: ${msg}`);

// ------------------------------------------------------------------ constants from CONTRACTS.md / types.ts
const CATEGORIES = ['minutes', 'money', 'injury', 'transfer', 'family', 'media', 'rival', 'team', 'discipline', 'pressure', 'agent', 'army', 'fans', 'national', 'life'];
const SELECTORS = ['coach', 'agent', 'rival', 'teammate', 'captain', 'youngster', 'veteran', 'journalist', 'chairman', 'father', 'mother', 'friend', 'opp_coach'];
const BASE_PLACEHOLDERS = ['player', 'first', 'club', 'league', 'opp', 'week', 'age'];
const TRAITS = ['hot_tempered', 'loyal', 'greedy', 'grateful', 'prefers_youth', 'hates_press', 'calm', 'ambitious', 'jealous', 'mentor', 'superstitious', 'tactician', 'party_animal', 'workaholic', 'gossip'];
const ATTR_KEYS = ['finishing', 'passing', 'dribbling', 'pace', 'stamina', 'defending', 'heading', 'vision', 'gk'];
const POSITIONS = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];
const STAGES = ['youth', 'army', 'pro', 'veteran'];
const GOAL_KINDS = ['attr', 'goals', 'apps', 'transfer', 'title', 'money', 'fame', 'national', 'captain', 'custom'];
const VALUES = ['overall', 'age', 'fame', 'money', 'form', 'morale', 'fitness', 'seasonWeek', 'season', 'absWeek', 'injured', 'tier', 'foreign', 'starter', 'lastResult', 'lastRating', 'goalsSeason', 'window', 'derbyNext', 'hasOffer', 'contractLeft', 'rivalScoredLast', 'rivalGoalsSeason'];
const FUNCS: Record<string, number> = { rel: 1, attr: 1, flag: 1, trait: 2, theme: 1, recent: 2, stage: 1, pos: 1 };
const HEX = /^#[0-9A-Fa-f]{6}$/;
const SNAKE = /^[a-z][a-z0-9_]*$/;
const LATIN = /[A-Za-z]/;
const DASHES = /[–—]/;

const leagues = (leaguesJson as unknown as { leagues: LeagueSeed[] }).leagues;
const names = namesJson as unknown as Record<string, NamePool>;
const wages = wagesJson as unknown as WageBands;
const themes = themesJson as unknown as Theme[];
const events = eventsJson as unknown as EventTemplate[];

// ------------------------------------------------------------------ leagues
const leagueKeys = new Set<string>();
const clubNames = new Map<string, string>(); // name -> league key
for (const l of leagues) {
  const w = `league ${l.key}`;
  if (!l.key || !SNAKE.test(l.key)) err(w, 'bad key');
  if (leagueKeys.has(l.key)) err(w, 'duplicate key');
  leagueKeys.add(l.key);
  for (const f of ['name', 'countryCode', 'country'] as const) if (typeof l[f] !== 'string' || !l[f]) err(w, `missing ${f}`);
  if (LATIN.test(l.name) || LATIN.test(l.country)) err(w, 'league/country name must be Hebrew');
  if (!Number.isInteger(l.tier) || l.tier < 1) err(w, 'bad tier');
  if (!(l.strength >= 1 && l.strength <= 100)) err(w, 'strength out of 1..100');
  if (!(l.wageFactor > 0)) err(w, 'wageFactor must be > 0');
  if (!['full', 'medium', 'result'].includes(l.simLevel)) err(w, 'bad simLevel');
  if (!Number.isInteger(l.promoteSpots) || !Number.isInteger(l.relegateSpots)) err(w, 'spots must be integers');
  if (!Array.isArray(l.clubs) || l.clubs.length < 8) err(w, 'needs >= 8 clubs');
  const pairs = new Set<string>();
  const shorts = new Map<string, string>();
  for (const c of l.clubs ?? []) {
    const cw = `${w} club ${c.name}`;
    if (c.short) {
      if (shorts.has(c.short)) err(cw, `short name "${c.short}" also used by ${shorts.get(c.short)} in this league`);
      shorts.set(c.short, c.name);
    }
    for (const f of ['name', 'short', 'city', 'stadium'] as const) if (typeof c[f] !== 'string' || !c[f]) err(cw, `missing ${f}`);
    for (const f of ['name', 'short', 'city', 'stadium'] as const) if (LATIN.test(c[f] ?? '')) err(cw, `${f} must be Hebrew`);
    if (clubNames.has(c.name)) err(cw, 'duplicate club name');
    clubNames.set(c.name, l.key);
    if (!Array.isArray(c.colors) || c.colors.length !== 2 || !c.colors.every((x) => HEX.test(x))) err(cw, 'colors must be 2 hex values');
    else {
      if (c.colors[0].toUpperCase() === c.colors[1].toUpperCase()) err(cw, 'both colours identical');
      const key = c.colors.map((x) => x.toUpperCase()).join('/');
      if (pairs.has(key)) err(cw, `colour pair ${key} reused in league`);
      pairs.add(key);
    }
    if (!(c.reputation >= 1 && c.reputation <= 100)) err(cw, 'reputation out of 1..100');
    if (c.crestCharge !== undefined && !(Number.isInteger(c.crestCharge) && c.crestCharge >= 0 && c.crestCharge <= 10)) err(cw, 'crestCharge 0..10');
    if (c.short && c.short.length > 10) warn(cw, `short name "${c.short}" is long`);
  }
}
const links = (x: string | string[] | null): string[] => (x === null ? [] : Array.isArray(x) ? x : [x]);
const byKey = new Map(leagues.map((l) => [l.key, l]));
for (const l of leagues) {
  const w = `league ${l.key}`;
  const ups = links(l.promotesTo);
  const downs = links(l.relegatesTo);
  for (const k of ups) if (!leagueKeys.has(k)) err(w, `promotesTo ${k} unknown`);
  for (const k of downs) if (!leagueKeys.has(k)) err(w, `relegatesTo ${k} unknown`);
  if (!ups.length && l.promoteSpots !== 0) err(w, 'promoteSpots without promotesTo');
  if (!downs.length && l.relegateSpots !== 0) err(w, 'relegateSpots without relegatesTo');
  if (ups.length && l.promoteSpots <= 0) err(w, 'promotesTo without promoteSpots');
  if (downs.length && l.relegateSpots <= 0) err(w, 'relegatesTo without relegateSpots');
  // links must be mutual, same country, one tier apart
  for (const k of ups) {
    const u = byKey.get(k);
    if (!u) continue;
    if (!links(u.relegatesTo).includes(l.key)) err(w, `promotes to ${k} but ${k} does not relegate to ${l.key}`);
    if (u.countryCode !== l.countryCode || u.tier !== l.tier - 1) err(w, `promotesTo ${k} must be same country, one tier up`);
  }
  for (const k of downs) {
    const d = byKey.get(k);
    if (d && !links(d.promotesTo).includes(l.key)) err(w, `relegates to ${k} but ${k} does not promote to ${l.key}`);
  }
  // spots balance: what goes down equals what comes up
  if (downs.length) {
    const up = downs.reduce((a, k) => a + (byKey.get(k)?.promoteSpots ?? 0), 0);
    if (up !== l.relegateSpots) err(w, `relegates ${l.relegateSpots} but its lower groups promote ${up}`);
    if (l.relegateSpots > l.clubs.length / 3) warn(w, 'relegates more than a third of the league');
  }
  // regions: a level with several groups needs a region on every group and on every club above and in the groups
  const groupKeys = downs.length > 1 ? downs : [];
  const groupRegions = new Set(groupKeys.map((k) => byKey.get(k)?.region).filter((x): x is string => !!x));
  for (const k of groupKeys) {
    const g = byKey.get(k);
    if (g && !g.region) err(`league ${k}`, 'regional group needs a region');
  }
  const inGroup = ups.length > 0 && ups.some((k) => links(byKey.get(k)?.relegatesTo ?? null).length > 1);
  for (const c of l.clubs ?? []) {
    if (groupKeys.length) {
      if (!c.region) err(`club ${c.name}`, `needs a region (league ${l.key} relegates into several groups)`);
      else if (!groupRegions.has(c.region)) err(`club ${c.name}`, `region "${c.region}" matches none of ${groupKeys.join(', ')}`);
    }
    if (inGroup && c.region !== l.region) err(`club ${c.name}`, `region must be "${l.region}" like its group ${l.key}`);
    if (c.reserve !== undefined && typeof c.reserve !== 'boolean') err(`club ${c.name}`, 'reserve must be boolean');
    if (c.reserve && !c.parent) err(`club ${c.name}`, 'reserve team needs a parent');
    if (c.parent !== undefined) {
      if (!c.reserve) err(`club ${c.name}`, 'parent set but reserve is not true');
      if (!clubNames.has(c.parent)) err(`club ${c.name}`, `parent "${c.parent}" does not exist`);
      if (c.parent === c.name) err(`club ${c.name}`, 'parent is itself');
      else {
        const pl = byKey.get(clubNames.get(c.parent) ?? '');
        if (pl && (pl.countryCode !== l.countryCode || pl.tier >= l.tier)) err(`club ${c.name}`, 'parent must be in a higher league of the same country');
      }
    }
    if (c.rival !== undefined) {
      if (!clubNames.has(c.rival)) err(`club ${c.name}`, `rival "${c.rival}" does not exist`);
      if (c.rival === c.name) err(`club ${c.name}`, 'rival is itself');
    }
  }
}

// ------------------------------------------------------------------ names
const countries = new Set(leagues.map((l) => l.countryCode));
for (const cc of countries) {
  const p = names[cc];
  if (!p) { err('names', `no pool for ${cc}`); continue; }
  const min = cc === 'IL' ? 80 : 30;
  if (p.first.length < min || p.last.length < min) err('names', `${cc} needs >= ${min} first/last (has ${p.first.length}/${p.last.length})`);
  for (const n of [...p.first, ...p.last]) if (!n || LATIN.test(n)) err('names', `${cc} bad name "${n}"`);
  if (new Set(p.first).size !== p.first.length) warn('names', `${cc} duplicate first names`);
  if (new Set(p.last).size !== p.last.length) warn('names', `${cc} duplicate last names`);
}

// ------------------------------------------------------------------ wages
for (const l of leagues) {
  const band = wages[l.countryCode]?.[String(l.tier)];
  if (!band) { err('wages', `missing band for ${l.countryCode} tier ${l.tier}`); continue; }
  for (const g of ['u19', 'u23', 'prime', 'vet'] as const) {
    const r = band[g];
    if (!Array.isArray(r) || r.length !== 2 || !(r[0] > 0) || !(r[1] > r[0])) err('wages', `${l.countryCode}/${l.tier}/${g} bad range`);
  }
}

// ------------------------------------------------------------------ themes
const themeIds = new Set<string>();
for (const t of themes) {
  const w = `theme ${t.id}`;
  if (!SNAKE.test(t.id)) err(w, 'bad id');
  if (themeIds.has(t.id)) err(w, 'duplicate id');
  themeIds.add(t.id);
  if (!t.name || !t.desc || LATIN.test(t.name + t.desc)) err(w, 'name/desc missing or not Hebrew');
  if (DASHES.test(t.name + t.desc)) err(w, 'contains en/em dash');
  for (const [k, v] of Object.entries(t.categoryBoost ?? {})) {
    if (!CATEGORIES.includes(k)) err(w, `unknown category ${k}`);
    if (!(typeof v === 'number' && v > 0)) err(w, `boost ${k} must be > 0`);
  }
}

// ------------------------------------------------------------------ condition parser
type Tok = { t: 'num' | 'id' | 'op'; v: string };
function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const two = src.slice(i, i + 2);
    if (['&&', '||', '<=', '>=', '==', '!='].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('()<>!,'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    const prev = out[out.length - 1];
    const unaryMinus = c === '-' && /\d/.test(src[i + 1] ?? '') && (!prev || (prev.t === 'op' && prev.v !== ')'));
    if (/\d/.test(c) || unaryMinus) {
      let j = i + 1;
      while (j < src.length && /[\d.]/.test(src[j])) j++;
      out.push({ t: 'num', v: src.slice(i, j) }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /\w/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue;
    }
    throw new Error(`unexpected character "${c}"`);
  }
  return out;
}

interface CondCtx { roles: Set<string>; usedTags: string[]; usedFlags: string[] }
function parseCondition(src: string, ctx: CondCtx): void {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`expected "${v ?? 'token'}" at token ${p}`);
    p++;
    return t;
  };
  const isCmp = (t?: Tok) => !!t && t.t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(t.v);
  function primary(): void {
    const t = peek();
    if (!t) throw new Error('unexpected end');
    if (t.t === 'num') { p++; return; }
    if (t.t === 'op' && t.v === '(') { p++; orExpr(); eat(')'); return; }
    if (t.t === 'id') {
      p++;
      if (peek()?.v === '(') {
        const arity = FUNCS[t.v];
        if (arity === undefined) throw new Error(`unknown function ${t.v}()`);
        eat('(');
        const args: string[] = [];
        for (;;) {
          const a = eat();
          if (a.t === 'op') throw new Error(`bad argument to ${t.v}()`);
          args.push(a.v);
          if (peek()?.v === ',') { p++; continue; }
          break;
        }
        eat(')');
        if (args.length !== arity) throw new Error(`${t.v}() takes ${arity} args`);
        checkFnArgs(t.v, args, ctx);
        return;
      }
      if (!VALUES.includes(t.v)) throw new Error(`unknown value "${t.v}"`);
      return;
    }
    throw new Error(`unexpected "${t.v}"`);
  }
  function cmp(): void { primary(); if (isCmp(peek())) { p++; primary(); } }
  function unary(): void { if (peek()?.v === '!') { p++; unary(); } else cmp(); }
  function andExpr(): void { unary(); while (peek()?.v === '&&') { p++; unary(); } }
  function orExpr(): void { andExpr(); while (peek()?.v === '||') { p++; andExpr(); } }
  orExpr();
  if (p !== toks.length) throw new Error(`trailing tokens after position ${p}`);
}
function checkFnArgs(fn: string, args: string[], ctx: CondCtx): void {
  const [a, b] = args;
  switch (fn) {
    case 'rel': if (!ctx.roles.has(a) && !SELECTORS.includes(a)) throw new Error(`rel(${a}): role not in cast`); break;
    case 'attr': if (!ATTR_KEYS.includes(a)) throw new Error(`attr(${a}) unknown`); break;
    case 'trait':
      if (!ctx.roles.has(a) && !SELECTORS.includes(a)) throw new Error(`trait(${a}): role not in cast`);
      if (!TRAITS.includes(b)) throw new Error(`trait ${b} unknown`);
      break;
    case 'theme': if (!themeIds.has(a)) throw new Error(`theme(${a}) unknown`); break;
    case 'stage': if (!STAGES.includes(a)) throw new Error(`stage(${a}) unknown`); break;
    case 'pos': if (!POSITIONS.includes(a)) throw new Error(`pos(${a}) unknown`); break;
    case 'recent': if (!/^\d+$/.test(b)) throw new Error('recent(tag, weeks) needs a number'); ctx.usedTags.push(a); break;
    case 'flag': ctx.usedFlags.push(a); break;
  }
}

// ------------------------------------------------------------------ effects
const N = '-?\\d+';
const EFFECTS: { re: RegExp; role?: number; text?: number; flag?: number; tag?: number; attr?: number }[] = [
  { re: new RegExp(`^rel\\((\\w+)\\)\\s*[+-]=\\s*${N}$`), role: 1 },
  { re: new RegExp(`^(?:morale|fame|money|form|fitness|potential)\\s*[+-]=\\s*${N}$`) },
  { re: new RegExp(`^attr\\((\\w+)\\)\\s*[+-]=\\s*${N}$`), attr: 1 },
  { re: new RegExp(`^flag\\((\\w+)\\)\\s*(?:\\+=|-=|=)\\s*${N}$`), flag: 1 },
  { re: /^memory\((\w+),\s*(\w+),\s*\d+\)$/, role: 1 },
  { re: /^history\((\w+)\)$/, tag: 1 },
  { re: /^promise\((\w+),\s*\d+,\s*(\w+)\)$/, role: 1 },
  { re: /^injury\(\d+\)$/ },
  { re: new RegExp(`^goal\\((?:${GOAL_KINDS.join('|')}),\\s*\\d+,\\s*([^(),]+)\\)$`), text: 1 },
  { re: /^news\(([^()]+)\)$/, text: 1 },
  { re: /^offer\((?:any|abroad|bigger)\)$/ },
  { re: /^squadRole\((?:starter|rotation|backup)\)$/ },
];

// ------------------------------------------------------------------ events
const PH = /\{(\w+)\}/g;
const ids = new Set<string>();
const producedTags = new Set<string>();
const producedFlags = new Set<string>();
const chainTargets = new Map<string, string[]>();
const usedTagRefs: { where: string; tag: string }[] = [];
const usedFlagRefs: { where: string; flag: string }[] = [];
let optionCount = 0;
let variantCount = 0;

function checkText(where: string, text: string, roles: Set<string>): void {
  if (LATIN.test(text.replace(PH, ''))) err(where, `non-Hebrew letters in "${text}"`);
  if (DASHES.test(text)) err(where, `en/em dash in "${text}"`);
  for (const m of text.matchAll(PH)) if (!BASE_PLACEHOLDERS.includes(m[1]) && !roles.has(m[1])) err(where, `unknown placeholder {${m[1]}}`);
  const stripped = text.replace(PH, '');
  if (/[{}]/.test(stripped)) err(where, 'stray brace');
}

for (const ev of events) {
  const w = `event ${ev.id}`;
  if (!ev.id || !SNAKE.test(ev.id)) err(w, 'bad id');
  if (ids.has(ev.id)) err(w, 'duplicate id');
  ids.add(ev.id);
  if (!CATEGORIES.includes(ev.category)) err(w, `unknown category ${ev.category}`);
  if (!(typeof ev.weight === 'number' && ev.weight > 0)) err(w, 'weight must be > 0');
  if (ev.cooldown !== undefined && !(Number.isInteger(ev.cooldown) && ev.cooldown >= 0)) err(w, 'bad cooldown');
  const roles = new Set(Object.keys(ev.cast ?? {}));
  for (const [role, sel] of Object.entries(ev.cast ?? {})) {
    if (!SNAKE.test(role)) err(w, `bad role name ${role}`);
    if (BASE_PLACEHOLDERS.includes(role)) err(w, `role ${role} shadows a built-in placeholder`);
    if (!SELECTORS.includes(sel)) err(w, `unknown selector ${sel}`);
  }
  const ctx: CondCtx = { roles, usedTags: [], usedFlags: [] };
  for (const c of ev.when ?? []) {
    try { parseCondition(c, ctx); } catch (e) { err(w, `condition "${c}": ${(e as Error).message}`); }
  }
  ctx.usedTags.forEach((tag) => usedTagRefs.push({ where: w, tag }));
  ctx.usedFlags.forEach((flag) => usedFlagRefs.push({ where: w, flag }));
  if (ev.because !== undefined) usedTagRefs.push({ where: `${w} because`, tag: ev.because });

  const minV = ev.chainOnly ? 2 : 3;
  if (!Array.isArray(ev.variants) || ev.variants.length < minV || ev.variants.length > 5) err(w, `needs ${minV}-5 variants (has ${ev.variants?.length})`);
  for (const [i, v] of (ev.variants ?? []).entries()) {
    variantCount++;
    if (!v.title || !v.body) err(`${w} v${i}`, 'missing title/body');
    if (v.body && v.body.length > 220) err(`${w} v${i}`, `body ${v.body.length} chars > 220`);
    if (v.title && v.title.length > 40) warn(`${w} v${i}`, 'long title');
    checkText(`${w} v${i}`, `${v.title} ${v.body}`, roles);
  }
  if (!Array.isArray(ev.options) || ev.options.length < 2 || ev.options.length > 4) err(w, 'needs 2-4 options');
  const optIds = new Set<string>();
  const defaults = (ev.options ?? []).filter((o) => o.default === true).length;
  if (defaults > 1) err(w, `${defaults} options marked default (max 1)`);
  if (defaults === 0) warn(w, 'no default option (quick week will fall back to a heuristic)');
  for (const o of ev.options ?? []) {
    if (o.default !== undefined && typeof o.default !== 'boolean') err(`${w} option ${o.id}`, 'default must be boolean');
    optionCount++;
    const ow = `${w} option ${o.id}`;
    if (!o.id || !SNAKE.test(o.id)) err(ow, 'bad option id');
    if (optIds.has(o.id)) err(ow, 'duplicate option id');
    optIds.add(o.id);
    if (!o.text) err(ow, 'missing text');
    else if (o.text.length > 60) err(ow, `text ${o.text.length} chars > 60`);
    checkText(ow, `${o.text} ${o.hint ?? ''}`, roles);
    if (!Array.isArray(o.effects) || o.effects.length === 0) err(ow, 'no effects');
    for (const e of o.effects ?? []) {
      const rule = EFFECTS.find((r) => r.re.test(e));
      if (!rule) { err(ow, `effect "${e}" not in closed list`); continue; }
      const m = e.match(rule.re)!;
      if (rule.role && !roles.has(m[rule.role]) && !SELECTORS.includes(m[rule.role])) err(ow, `effect "${e}": role not in cast`);
      if (rule.attr && !ATTR_KEYS.includes(m[rule.attr])) err(ow, `effect "${e}": unknown attr`);
      if (rule.tag) producedTags.add(m[rule.tag]);
      if (rule.flag) producedFlags.add(m[rule.flag]);
      if (rule.text) checkText(ow, m[rule.text], roles);
    }
    for (const ch of o.chain ?? []) {
      if (!(Number.isInteger(ch.after) && ch.after >= 1)) err(ow, 'chain.after must be >= 1');
      const list = chainTargets.get(ch.event) ?? [];
      list.push(ev.id);
      chainTargets.set(ch.event, list);
    }
  }
}
// uniqueness across templates: titles and option texts must never repeat (QA UX-07)
const titleOwner = new Map<string, string>();
const optionOwner = new Map<string, string>();
for (const ev of events) {
  for (const v of ev.variants ?? []) {
    const prev = titleOwner.get(v.title);
    if (prev !== undefined && prev !== ev.id) err(`event ${ev.id}`, `title "${v.title}" also used by ${prev}`);
    else if (prev === ev.id) err(`event ${ev.id}`, `title "${v.title}" repeated inside the template`);
    titleOwner.set(v.title, ev.id);
  }
  for (const o of ev.options ?? []) {
    const prev = optionOwner.get(o.text);
    if (prev !== undefined && prev !== ev.id) err(`event ${ev.id}`, `option text "${o.text}" also used by ${prev}`);
    optionOwner.set(o.text, ev.id);
  }
}
// Hebrew style: a prefix letter glued to a digit needs a maqaf ("ב-3", not "ב3")
const GLUED = /(^|[\s"(])[בלמוהכש]\d/;
for (const ev of events) {
  const texts = [...(ev.variants ?? []).flatMap((v) => [v.title, v.body]), ...(ev.options ?? []).flatMap((o) => [o.text, o.hint ?? '', ...o.effects])];
  for (const t of texts) if (GLUED.test(t)) err(`event ${ev.id}`, `prefix glued to a number in "${t}" (use a maqaf)`);
}
const byId = new Map(events.map((e) => [e.id, e]));
for (const [target, from] of chainTargets) {
  const t = byId.get(target);
  if (!t) { err(`chain from ${from.join(',')}`, `target ${target} does not exist`); continue; }
  if (!t.chainOnly) warn(`event ${target}`, 'is a chain target but not chainOnly');
  // chains reuse the parent's cast: every role used by the child must exist in each parent
  for (const parentId of from) {
    const parentRoles = Object.keys(byId.get(parentId)?.cast ?? {});
    for (const role of Object.keys(t.cast ?? {})) if (!parentRoles.includes(role)) warn(`event ${target}`, `role ${role} not in parent ${parentId} cast (engine will reselect)`);
  }
}
for (const e of events) if (e.chainOnly && !chainTargets.has(e.id)) err(`event ${e.id}`, 'chainOnly but nothing chains to it');
for (const r of usedTagRefs) if (!producedTags.has(r.tag)) err(r.where, `history tag "${r.tag}" is never produced by history()`);
for (const r of usedFlagRefs) if (!producedFlags.has(r.flag)) warn(r.where, `flag "${r.flag}" is never set by an event (engine must set it)`);

// ------------------------------------------------------------------ report
const chainOnly = events.filter((e) => e.chainOnly).length;
const catCounts: Record<string, number> = {};
for (const e of events) catCounts[e.category] = (catCounts[e.category] ?? 0) + 1;
if (events.length < 70) err('events', `only ${events.length} templates (need >= 70)`);
if (chainOnly < 10) err('events', `only ${chainOnly} chain follow-ups (need >= 10)`);
for (const c of CATEGORIES) if (!catCounts[c]) err('events', `no events in category ${c}`);

console.log(`leagues ${leagues.length}, clubs ${clubNames.size}, name pools ${Object.keys(names).length}, themes ${themes.length}`);
console.log(`events ${events.length} (chain-only ${chainOnly}, chains ${chainTargets.size}), variants ${variantCount}, options ${optionCount}`);
console.log(`categories: ${Object.entries(catCounts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
for (const x of warnings) console.log(`WARN  ${x}`);
for (const x of errors) console.log(`ERROR ${x}`);
console.log(errors.length ? `FAILED with ${errors.length} error(s)` : `OK (${warnings.length} warning(s))`);
if (errors.length) (globalThis as unknown as { process: { exit(code: number): never } }).process.exit(1);
