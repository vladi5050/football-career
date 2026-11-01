// Decision-moment odds in real careers: plays N careers per position for S seasons, and at every moment
// records the chance of the best read, of the vision-hinted card and of all options (a random pick).
//   npx vite-node tools/decisionOdds.ts [careersPerPos=3] [seasons=2]
// QA round 4 targets (outfield): best read ≈ 55-65%, all options ≈ 35-45%. Keepers keep their own line.
// Also prints the situation library: variants per kind and how many each position can reach (role + pos filters).
import { normalizeContent } from '../src/core/contentLoad';
import { apply, newGame } from '../src/core/game';
import { autoOptionId } from '../src/core/events';
import { buildOptions, hintOption, kindDef, pickVariant } from '../src/match/decision/resolve';
import { LIBRARY } from '../src/match/decision/scenarios';
import { KINDS_BY_POS } from '../src/core/matchSim';
declare const process: { argv: string[]; cwd(): string };
const args = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const N = Number(args[0] ?? 3), SEASONS = Number(args[1] ?? 2);
const modName = 'node:fs';
const fs = (await import(/* @vite-ignore */ modName)) as { readFileSync(p: string, e: string): string };
const parts: Record<string, unknown> = {};
for (const k of ['leagues', 'names', 'wages', 'themes', 'events']) parts[k] = JSON.parse(fs.readFileSync(`${process.cwd()}/src/content/${k}.json`, 'utf8'));
const content = normalizeContent(parts as never);
{
  const perKind = Object.entries(LIBRARY).map(([k, d]) => `${k} ${d.variants.length}`);
  console.log(`situations: ${Object.values(LIBRARY).reduce((a, d) => a + d.variants.length, 0)}  (${perKind.join(', ')})`);
  const reach = (Object.keys(KINDS_BY_POS) as (keyof typeof KINDS_BY_POS)[]).map((pos) => {
    const role = pos === 'GK' ? 'keeper' : 'taker';
    let n = 0;
    for (const [k] of KINDS_BY_POS[pos]) {
      const vs = LIBRARY[k].variants.filter((v) => !v.role || v.role === role);
      const pv = vs.filter((v) => !v.pos || v.pos.includes(pos));
      n += (pv.length ? pv : vs).length;
    }
    return `${pos} ${n}`;
  });
  console.log(`reachable per position: ${reach.join(', ')}`);
}
let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const pos of ['W', 'CB', 'GK', 'ST', 'CM', 'FB', 'AM', 'DM'] as const) {
  const best: number[] = [], all: number[] = [], hinted: number[] = [], diff: number[] = []; let picks = 0, ok = 0;
  for (let i = 0; i < N; i++) {
    let w: any = newGame({ type: 'newCareer', seed: 777 + i * 13, pos, firstName: 'א', lastName: 'ב' }, content);
    const run = (cmd: any) => { w = apply(w, cmd, content).world; };
    let guard = 0;
    while (!w.career.retired && w.career.seasonsPlayed < SEASONS && guard++ < 20000) {
      switch (w.phase) {
        case 'plan': if (w.career.lastPlan) run({ type: 'setPlan', plan: w.career.lastPlan }); else run({ type: 'quickWeek' }); break;
        case 'event': run({ type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) }); break;
        case 'prematch': run({ type: 'startMatch' }); break;
        case 'match': {
          const live = w.live; const m = live.moments[live.pendingMomentIndex];
          if (!m) { run({ type: 'simRestOfMatch' }); break; }
          const u = w.people[w.career.playerId];
          const def = kindDef(m.kind); const v = pickVariant(def, m, u.pos);
          const opts = buildOptions(def, v, m, u.attr);
          const b = opts.reduce((x: any, y: any) => (y.fit > x.fit ? y : x));
          best.push(b.chance); all.push(...opts.map((o: any) => o.chance)); diff.push(m.difficulty);
          const h = hintOption(opts, u.attr, u.pos, rnd()); if (h) hinted.push(opts.find((o: any) => o.id === h)!.chance);
          const o = opts[Math.floor(rnd() * opts.length)]; const s = rnd() < o.chance; picks++; if (s) ok++;
          run({ type: 'momentResult', result: { momentId: m.id, success: s, quality: s ? 0.7 : 0.2, skipped: false } });
          break;
        }
        case 'postmatch': case 'weekend': case 'offseason': run({ type: 'finishWeek' }); break;
        case 'negotiation': run({ type: 'acceptNegotiation' }); break;
        default: run({ type: 'finishWeek' });
      }
    }
  }
  const avg = (x: number[]) => (x.reduce((a, b) => a + b, 0) / Math.max(1, x.length));
  console.log(`${pos}: moments ${best.length}  difficulty ${avg(diff).toFixed(2)}  best/read ${(avg(best) * 100).toFixed(1)}%  hinted ${(avg(hinted) * 100).toFixed(1)}% (n=${hinted.length})  all options ${(avg(all) * 100).toFixed(1)}%  random-pick success ${ok}/${picks}`);
}
