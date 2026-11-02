// End-to-end QA run for the REAL engine (no ?mock).
// Builds (npx vite build), serves (npx vite preview --port 4173) and drives the app with Playwright.
//
//   npm run test:e2e                  full run
//   SKIP_BUILD=1 npm run test:e2e     reuse dist/
//   E2E_URL=http://host:port/ ...     use an already running server (no build, no preview)
//   SEASON_MAX_WEEKS=60               safety cap for the season loop
//   QA_SEED=20261031                  fixed seed for the deterministic career (default below)
//   RETIRE_AT=34                      age at which the long career retires through the UI
//   LONG_MAX_MIN=50                   time budget for the long career (minutes)
//   RANDOM_RUNS=2                     extra random-seed careers (first kick + 2 fast seasons; positions CB, GK, ST, FB)
//   E2E_ONLY=a,b,e,f                  groups: a first kick + random careers, b deterministic career (b/c/d/g/i), e viewports, f PWA
//   E2E_SHOTS=dir                     screenshot/report directory (default tests/e2e/shots)
//
// Round 3 coverage: decision moments ("רגע החלטה") picked by card and by keys 1-4 for W, CB and GK careers, the phone-fit
// table (compact/full, row details), promotion/relegation oracle on the save, transfers into lazy leagues, save/continue
// across seasons, performance timings, 360/390/430/1366 overflow audit, "ארקייד" mode.
//
// Output: summary table on stdout, screenshots in tests/e2e/shots/, raw logs in tests/e2e/shots/report.json.
// Exit code 1 when any check fails.
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const root = execSync('npm root -g').toString().trim();
    return require(path.join(root, 'playwright'));
  }
}
const { chromium } = loadPlaywright();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SHOTS = process.env.E2E_SHOTS ? path.resolve(process.env.E2E_SHOTS) : path.join(HERE, 'shots');
const PORT = 4173;
const URL = process.env.E2E_URL || `http://localhost:${PORT}/`;
const MAX_WEEKS = Number(process.env.SEASON_MAX_WEEKS || 60);
const QA_SEED = Number(process.env.QA_SEED || 20261031);
const QA_NAME = { first: 'נועם', last: 'בן שושן' };
const RETIRE_AT = Number(process.env.RETIRE_AT || 34);
const LONG_MAX_MS = Number(process.env.LONG_MAX_MIN || 50) * 60000;
const RANDOM_RUNS = Number(process.env.RANDOM_RUNS || 2);
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png')) fs.unlinkSync(path.join(SHOTS, f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ------------------------------------------------------------------ results
/** @type {{scenario:string, step:string, ok:boolean, ms:number, detail:string}[]} */
const results = [];
const log = { perf: { quickWeek: [], nextSeason: [], continue: [], saveBytes: [] }, decisions: [], firstKick: null, seasons: [], long: {}, season: { weeks: [], events: [], weekends: [], matches: [], toasts: [], tables: [], club: [], negotiation: [] }, audits: {}, errors: [], notes: [] };

function record(scenario, step, ok, ms, detail = '') {
  results.push({ scenario, step, ok, ms, detail: String(detail).replace(/\s+/g, ' ').slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${step}  ${ms}ms  ${detail ? String(detail).slice(0, 200) : ''}`);
}
async function step(scenario, name, fn) {
  const t = now();
  try {
    const detail = await fn();
    record(scenario, name, true, now() - t, detail ?? '');
    return true;
  } catch (e) {
    record(scenario, name, false, now() - t, e?.message?.split('\n')[0] ?? String(e));
    return false;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ------------------------------------------------------------------ build + serve
let server = null;
async function waitHttp(url, ms) {
  const end = now() + ms;
  while (now() < end) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  return false;
}
async function buildAndServe() {
  if (process.env.E2E_URL) return;
  if (!process.env.SKIP_BUILD) {
    const t = now();
    try {
      execSync('npx vite build', { cwd: ROOT, stdio: 'pipe' });
      record('setup', 'vite build', true, now() - t);
    } catch (e) {
      record('setup', 'vite build', false, now() - t, (e.stderr || e.stdout || e.message).toString().slice(-300));
      throw e;
    }
  }
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'pipe', detached: true });
  server.stderr.on('data', (d) => process.env.E2E_DEBUG && process.stderr.write(d));
  const ok = await waitHttp(URL, 20000);
  record('setup', 'vite preview up', ok, 0, URL);
  if (!ok) throw new Error('preview server did not start');
}
function stopServer() {
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {
      try { server.kill(); } catch { /* ignore */ }
    }
  }
}

// ------------------------------------------------------------------ browser helpers
let browser;
const MOBILE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'he-IL' };

async function newPage(opts = MOBILE, label = 'page', { seed = null } = {}) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opts });
  const page = await ctx.newPage();
  // Test-harness hook (no product change): inject a fixed seed into the Comlink "newCareer" call to the worker.
  if (seed != null)
    await page.addInitScript((sd) => {
      const orig = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (msg, ...rest) {
        try {
          if (msg && Array.isArray(msg.path) && msg.path[0] === 'newCareer' && msg.argumentList?.[0]?.value) msg.argumentList[0].value.seed = sd;
          if (msg && Array.isArray(msg.path) && msg.path[0] === 'apply' && msg.argumentList?.[0]?.value?.type === 'newCareer') msg.argumentList[0].value.seed = sd;
        } catch { /* ignore */ }
        return orig.call(this, msg, ...rest);
      };
    }, seed);
  page.setDefaultTimeout(10000);
  page.__errors = [];
  page.__label = label;
  page.on('pageerror', (e) => {
    page.__errors.push({ kind: 'pageerror', text: e.message });
    log.errors.push({ page: label, kind: 'pageerror', text: e.message });
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    // external font fetches through the sandbox proxy are not product errors
    const external = /fonts\.(googleapis|gstatic)\.com|ERR_TUNNEL|ERR_PROXY/.test(text);
    const item = { kind: `console.${m.type()}`, text, external };
    if (m.type() === 'error') page.__errors.push(item);
    log.errors.push({ page: label, ...item });
  });
  page.on('worker', (w) => {
    w.on('console', (m) => {
      if (m.type() === 'error') {
        page.__errors.push({ kind: 'worker.error', text: m.text() });
        log.errors.push({ page: label, kind: 'worker.error', text: m.text() });
      }
    });
  });
  // collect toasts as they appear (they vanish after 2.6s)
  await page.exposeFunction('__qaToast', (t) => log.season.toasts.push({ page: label, t, at: Date.now() }));
  await page.addInitScript(() => {
    const seen = new WeakSet();
    new MutationObserver(() => {
      document.querySelectorAll('.toast').forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        window.__qaToast?.(el.textContent);
      });
    }).observe(document, { childList: true, subtree: true });
  });
  return { ctx, page };
}

const KNOWN = {
  'title-screen': 'title', 'new-career': 'new', 'reveal-screen': 'reveal', 'week-screen': 'week', 'event-screen': 'event',
  'prematch-screen': 'prematch', 'match-screen': 'match', 'weekend-screen': 'weekend', 'contract-screen': 'contract',
  'agent-screen': 'agent', 'club-screen': 'club', 'table-screen': 'table', 'more-screen': 'more', 'news-screen': 'news',
  'goals-screen': 'goals', 'settings-screen': 'settings', 'team-editor': 'editor', 'career-end': 'end',
};
async function screenOf(page) {
  return page.evaluate((known) => {
    const m = document.querySelector('.screen-host > main.screen') || document.querySelector('main.screen');
    if (!m) return 'none';
    for (const c of m.classList) if (known[c]) return known[c];
    return `unknown:${m.className}`;
  }, KNOWN);
}
async function idle(page, extra = 150) {
  await page.waitForFunction(() => document.querySelector('.shell')?.getAttribute('aria-busy') !== 'true', null, { timeout: 30000 }).catch(() => {});
  await sleep(extra);
}
async function tap(page, name, opts = {}) {
  const loc = typeof name === 'string' || name instanceof RegExp ? page.getByRole('button', { name, exact: opts.exact }) : name;
  await loc.first().click({ timeout: opts.timeout ?? 10000 });
  await idle(page, opts.after ?? 150);
}
async function waitScreen(page, ids, ms = 15000) {
  const want = Array.isArray(ids) ? ids : [ids];
  const end = now() + ms;
  let s = 'none';
  while (now() < end) {
    s = await screenOf(page);
    if (want.includes(s)) return s;
    await sleep(100);
  }
  throw new Error(`expected screen ${want.join('|')} got ${s}`);
}
let shotN = 0;
async function shot(page, name, full = false) {
  const file = path.join(SHOTS, `${String(++shotN).padStart(3, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: full }).catch(() => {});
  return path.relative(ROOT, file);
}
/** Read the autosave straight from IndexedDB (the oracle for reload checks). */
async function readSave(page) {
  return page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('football-career');
        r.onerror = () => res(null);
        r.onsuccess = () => {
          try {
            const tx = r.result.transaction('saves', 'readonly');
            const g = tx.objectStore('saves').get('autosave');
            g.onsuccess = () => {
              try {
                const f = JSON.parse(g.result);
                const w = f.world;
                const pid = w.career.playerId;
                let u = w.people?.[pid];
                if (!u && Array.isArray(w.players)) {
                  const t = w.players.find((x) => x[0] === pid);
                  if (t) u = { age: t[2], clubId: t[4], pos: t[5], ...(t[13] || {}) };
                }
                // save v3: clubs may be tuples [id, name, short, city, country, leagueId, ...]
                const dc = (c) => (Array.isArray(c) ? { id: c[0], name: c[1], short: c[2], leagueId: c[5], squad: c[12], lazy: !!c[15]?.lazy } : c);
                const clubs = (w.clubs || []).map(dc);
                const club = u && u.clubId != null ? clubs.find((c) => c && c.id === u.clubId) ?? null : null;
                const league = club ? w.leagues.find((l) => l.id === club.leagueId) : null;
                const lgClubs = league ? league.clubIds.map((id) => clubs.find((c) => c.id === id)).filter(Boolean) : [];
                res({
                  week: w.season.week, season: w.season.number, totalWeeks: w.season.totalWeeks, phase: w.phase, money: w.career.money, absWeek: w.absWeek,
                  age: u?.age, clubId: u?.clubId, club: club?.name, league: league?.name, leagueTier: league?.tier, country: league?.country,
                  contract: u?.contract ? { end: u.contract.endSeason, wage: u.contract.monthlyWage, role: u.contract.role } : null,
                  injury: u?.injury ?? null, caps: w.career.nationalCaps, offers: w.career.offers?.length ?? 0, retired: !!w.career.retired,
                  pos: u?.pos, lazyInLeague: lgClubs.filter((c) => c.lazy || !c.squad?.length).length, leagueClubs: lgClubs.length, bytes: g.result.length, version: f.version,
                  armyStatus: w.career.life?.armyStatus, stage: w.career.life?.stage, autoEvents: w.lastWeekReport?.autoEvents ?? [], reportWeek: w.lastWeekReport?.absWeek ?? null,
                  offerRoles: (w.career.offers || []).map((o) => o.role), neg: w.career.negotiation?.status === 'open' ? 'open' : (w.career.negotiation?.status ?? null),
                });
              } catch {
                res(null);
              }
            };
            g.onerror = () => res(null);
          } catch {
            res(null);
          }
        };
      }),
  );
}

/** Whole save, decoded in node (clubs/tables tuples of save v3). For league-wide oracles: promotion/relegation, names, lazy clubs. */
async function readWorld(page) {
  const raw = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('football-career');
        r.onerror = () => res(null);
        r.onsuccess = () => {
          try {
            const g = r.result.transaction('saves', 'readonly').objectStore('saves').get('autosave');
            g.onsuccess = () => res(g.result ?? null);
            g.onerror = () => res(null);
          } catch {
            res(null);
          }
        };
      }),
  );
  if (!raw) return null;
  const f = JSON.parse(raw);
  const w = f.world;
  const clubs = new Map();
  for (const c of w.clubs || []) {
    const d = Array.isArray(c)
      ? { id: c[0], name: c[1], short: c[2], city: c[3], countryCode: c[4], leagueId: c[5], reputation: c[6], colors: c[8], crest: c[9], squad: c[12] || [], lazy: !!c[15]?.lazy, region: c[15]?.region, reserveOf: c[15]?.reserveOf }
      : { ...c, squad: c.squad || [], lazy: !!c.lazy };
    clubs.set(d.id, d);
  }
  const tables = {};
  for (const [lid, rows] of Object.entries(w.season?.tables || {}))
    tables[lid] = rows.map((t) => (Array.isArray(t) ? { clubId: t[0], p: t[1], w: t[2], d: t[3], l: t[4], gf: t[5], ga: t[6], pts: t[7] } : t));
  return { version: f.version, bytes: raw.length, season: w.season?.number, week: w.season?.week, phase: w.phase, leagues: w.leagues, clubs, tables, career: w.career, report: w.lastWeekReport };
}
const sortRows = (rows) => rows.slice().sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga) || b.gf - a.gf || b.w - a.w || a.clubId - b.clubId); // same order as core sortedTable
/** Round robins per season by league size (core round 5): up to 10 clubs meet 4 times, 11-12 clubs 3 times, else twice. */
const legsFor = (n) => (n <= 10 ? 4 : n <= 12 ? 3 : 2);
const REGION = { north: 'צפון', south: 'דרום', 'צפון': 'צפון', 'דרום': 'דרום' };
const normRegion = (r) => (r ? REGION[String(r).trim().toLowerCase()] ?? r : undefined);
const ATTR_NAMES = ['סיומת', 'מסירה', 'דריבל', 'מהירות', 'סיבולת', 'הגנה', 'משחק ראש', 'ראיית משחק', 'שוערות'];
const LATIN = /[A-Za-z]/;

// ------------------------------------------------------------------ the UI audit (run on every screen)
const issues = new Map(); // key -> {type, detail, screen, shot, count}
function issue(type, detail, where, shotPath) {
  const key = `${type}|${detail}`;
  const cur = issues.get(key);
  if (cur) cur.count++;
  else issues.set(key, { type, detail, screen: where, shot: shotPath, count: 1 });
}
const EN_ALLOW = new Set(['K', 'M']);
async function audit(page, where) {
  // let screen transitions settle (a running slide/rise animation moves the fixed action bar)
  await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running' && a.effect?.target?.classList?.contains('screen-host')), null, { timeout: 2000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const vis = (el) => {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const text = document.body.innerText || '';
    const bad = [];
    for (const re of [/\bNaN\b/g, /\bundefined\b/g, /\bnull\b/g, /\[object [A-Za-z]+\]/g, /\bInfinity\b/g, /\{[A-Za-z_][A-Za-z0-9_.]*\}/g, /\$\{/g]) {
      const m = text.match(re);
      if (m) bad.push(...m);
    }
    const english = [...new Set((text.match(/[A-Za-z][A-Za-z_]+/g) || []))];
    const rawIds = [...new Set((text.match(/\b[a-z]+_[a-z_]+\b/g) || []))];
    const emDash = /[—]/.test(text);
    const sw = document.documentElement.scrollWidth;
    const iw = window.innerWidth;
    const wide = [];
    if (sw > iw) {
      document.querySelectorAll('body *').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && (b.right > iw + 1 || b.left < -1) && wide.length < 4 && getComputedStyle(el).position !== 'fixed') wide.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(b.left)},${Math.round(b.right)}]`);
      });
    }
    const small = [];
    document.querySelectorAll('button, [role=button], a[href], input[type=range], [role=switch]').forEach((el) => {
      if (!vis(el) || el.closest('[aria-hidden=true]')) return;
      const b = el.getBoundingClientRect();
      if (b.height < 40 || b.width < 40) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        small.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${label}" ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    });
    // primary action reachable in viewport (thumb zone)
    const bar = document.querySelector('.action-bar');
    let barOff = false;
    if (bar && vis(bar)) {
      const b = bar.getBoundingClientRect();
      barOff = b.bottom > window.innerHeight + 1 || b.top < 0;
    }
    // BUG-13: a visible toast must not cover a button, a modal or the career-end stats
    const covered = [];
    document.querySelectorAll('.toast').forEach((t) => {
      if (!vis(t)) return;
      const a = t.getBoundingClientRect();
      document.querySelectorAll('button, .modal, .ce-grid, .dm-opts, .sb-score').forEach((el) => {
        if (!vis(el) || t.contains(el) || el.contains(t)) return;
        const b = el.getBoundingClientRect();
        const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ix > 8 && iy > 8 && covered.length < 3) covered.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 2).join('.')} "${(el.textContent || '').trim().slice(0, 18)}"`);
      });
    });
    const grammar = [...new Set(text.match(/(^|[^\d.,])1 (שערים|הופעות|בישולים|משחקים|שבועות|נקודות|עונות|שנים|חודשים)/g) || [])];
    // phone app-shell: the page never scrolls; fixed-content screens (and the decision overlay) fit the viewport
    const ih = window.innerHeight;
    const pageOver = document.scrollingElement.scrollHeight - ih;
    const scr = document.querySelector('.dm-root') || document.querySelector('main.screen');
    const screenOver = scr ? scr.scrollHeight - scr.clientHeight : 0;
    return { bad, english, rawIds, emDash, sw, iw, ih, wide, small, barOff, covered, grammar, pageOver, screenOver };
  });
  log.audits[where] = (log.audits[where] || 0) + 1;
  const sp = () => shot(page, `issue-${where}`);
  if (r.bad.length) issue('placeholder/garbage text', `${where}: ${[...new Set(r.bad)].join(', ')}`, where, await sp());
  const en = r.english.filter((w) => !EN_ALLOW.has(w));
  if (en.length) issue('english text', `${where}: ${en.slice(0, 8).join(', ')}`, where, await sp());
  if (r.rawIds.length) issue('raw id in UI', `${where}: ${r.rawIds.slice(0, 5).join(', ')}`, where, await sp());
  if (r.emDash) issue('em-dash in UI', where, where, await sp());
  if (r.sw > r.iw) issue('horizontal overflow', `${where}: scrollWidth ${r.sw} > ${r.iw} ${r.wide.join(' ; ')}`, where, await sp());
  for (const s of r.small) issue('tap target < 40px', `${where}: ${s}`, where, null);
  if (r.barOff) issue('action bar off-screen', where, where, await sp());
  if (r.covered.length) issue('BUG-13: toast covers UI', `${where}: ${r.covered.join(' ; ')}`, where, await sp());
  if (r.grammar.length) issue('BUG-11: "1 + plural"', `${where}: ${r.grammar.join(', ')}`, where, await sp());
  if (r.iw < 700) {
    const base = String(where).split(':').pop();
    if (r.pageOver > 1) issue('page scrolls on phone', `${where} ${r.iw}x${r.ih}: page ${r.pageOver}px taller than the viewport`, where, await sp());
    else if (PHONE_FIT.has(base) && r.screenOver > 1) issue('page scrolls on phone', `${where} ${r.iw}x${r.ih}: screen content ${r.screenOver}px taller than the viewport`, where, await sp());
  }
}
/** Screens that must fit one phone viewport without scrolling (long lists scroll inside their own panel instead). */
const PHONE_FIT = new Set(['title', 'new', 'reveal', 'week', 'prematch', 'match', 'match-moment', 'match-fulltime', 'decision', 'weekend', 'event', 'contract', 'career-end']);

// ------------------------------------------------------------------ flows
const POS_INDEX = { ST: 0, W: 1, AM: 2, CM: 3, DM: 4, FB: 5, CB: 6, GK: 7 };
async function startNewCareer(page, { audits = false, name = null, pos = null } = {}) {
  let taps = 0;
  await waitScreen(page, ['title']);
  if (audits) await audit(page, 'title');
  await tap(page, 'קריירה חדשה');
  taps++;
  await waitScreen(page, 'new');
  if (audits) await audit(page, 'new');
  if (name) {
    const inputs = page.locator('.new-career .name-row input');
    await inputs.nth(0).fill(name.first);
    await inputs.nth(1).fill(name.last);
  }
  if (pos) await page.locator('.new-career .pos-spot').nth(POS_INDEX[pos]).click();
  page.__tNew = now();
  await tap(page, 'צא לדרך', { timeout: 20000 });
  taps++;
  // the week screen can flash for a frame before the reveal route is pushed: wait for a stable screen
  await waitScreen(page, ['reveal', 'week'], 30000);
  (log.perf.newCareer ||= []).push(now() - page.__tNew);
  await sleep(400);
  if ((await screenOf(page)) === 'reveal') {
    if (audits) {
      await sleep(3300);
      await shot(page, 'reveal');
      await audit(page, 'reveal');
    }
    await page.locator('.reveal-screen .action-bar .btn').click();
    taps++;
    await idle(page);
  }
  await waitScreen(page, 'week');
  return taps;
}

// "רגע החלטה": full-screen overlay on document.body with 2-4 option cards, a pressure timer, then a stamp and "המשך".
const GK_KINDS = new Set(['save', 'rush_out', 'penalty', 'claim_cross', 'distribution', 'set_piece_defend']);
const KEEPER_ONLY = new Set(['save', 'rush_out', 'claim_cross', 'distribution']);
async function playDecision(page, st, { via = 'click', pick = null, doAudit = false, shotName = null } = {}) {
  const t0 = now();
  const sb = await page.evaluate(() => (document.querySelector('.sb-score')?.textContent ?? '').match(/\d+/g)?.map(Number) ?? []);
  const playBtn = page.locator('.moment-card .btn-primary');
  const ready = await page
    .waitForFunction(() => { const b = document.querySelector('.moment-card:not(.ft-card) .btn-primary'); return !b || !b.disabled; }, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!ready || !(await playBtn.isVisible().catch(() => false))) return { r: 'moment-gone' };
  await playBtn.click();
  await idle(page, 50);
  const ok = await page.locator('.dm-root[data-phase=choose]').waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  if (!ok) {
    if (await page.locator('#moment-host canvas').isVisible().catch(() => false)) return { r: 'arcade-canvas' };
    return { r: 'no-overlay' };
  }
  const openMs = now() - t0;
  await sleep(750); // cards rise in
  const info = await page.evaluate(() => {
    const r = document.querySelector('.dm-root');
    const iw = window.innerWidth;
    const out = [];
    r.querySelectorAll('*').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width > 0 && (b.right > iw + 1 || b.left < -1) && out.length < 4 && !el.closest('svg')) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(b.left)},${Math.round(b.right)}]`);
    });
    const cards = [...r.querySelectorAll('.dm-card')].map((c) => {
      const lbl = c.querySelector('.dm-lbl');
      const b = c.getBoundingClientRect();
      return {
        label: lbl?.textContent ?? '', chip: c.querySelector('.dm-chip')?.textContent ?? '', risk: c.querySelector('.dm-risk small')?.textContent ?? '', hint: c.classList.contains('hint'),
        w: Math.round(b.width), h: Math.round(b.height), clipped: !!lbl && (lbl.scrollWidth > lbl.clientWidth + 1 || lbl.scrollHeight > lbl.clientHeight + 2), below: b.bottom > window.innerHeight + 1,
      };
    });
    return {
      kind: r.dataset.kind, variant: r.dataset.variant, def: r.classList.contains('def'), title: r.querySelector('.dm-title')?.textContent ?? '', stakes: r.querySelector('.dm-stakes')?.textContent ?? '',
      note: r.querySelector('.dm-note')?.textContent ?? '', score: [...r.querySelectorAll('.dm-score b')].map((b) => Number(b.textContent)), timer: !r.querySelector('.dm-timer.off'),
      cards, outside: out, rootSW: r.scrollWidth, rootCW: r.clientWidth, bodyLocked: document.body.style.overflow === 'hidden', text: r.innerText,
    };
  });
  const tag = `${st.label} s${st.season}w${st.week}`;
  if (doAudit) await audit(page, 'decision');
  if (shotName) await shot(page, shotName);
  if (info.cards.length < 2 || info.cards.length > 4) issue('decision moment: option count not 2-4', `${tag}: ${info.kind} ${info.cards.length}`, 'decision', await shot(page, 'dm-count'));
  if (info.cards.some((c) => !c.label || !c.chip || !c.risk)) issue('decision card missing label/attribute/risk', `${tag}: ${info.kind} ${JSON.stringify(info.cards.map((c) => c.label + '/' + c.chip + '/' + c.risk))}`, 'decision', await shot(page, 'dm-card'));
  if (info.cards.some((c) => c.clipped)) issue('decision card label clipped', `${tag}: ${info.cards.filter((c) => c.clipped).map((c) => c.label).join(' | ')}`, 'decision', await shot(page, 'dm-clipped'));
  if (info.cards.some((c) => c.h < 40 || c.w < 40)) issue('decision card < 40px', `${tag}`, 'decision', null);
  if (info.outside.length || info.rootSW > info.rootCW + 1) issue('decision overlay overflows horizontally', `${tag}: ${info.outside.join(' ; ')} sw ${info.rootSW}/${info.rootCW}`, 'decision', await shot(page, 'dm-overflow'));
  if (LATIN.test(info.text)) issue('english text', `decision: ${[...new Set(info.text.match(/[A-Za-z]+/g))].slice(0, 6).join(', ')}`, 'decision', await shot(page, 'dm-latin'));
  if (!info.bodyLocked) issue('decision overlay does not lock page scroll', tag, 'decision', null);
  if (sb.length === 2 && info.score.length === 2 && [...sb].sort().join() !== [...info.score].sort().join()) issue('decision overlay score differs from the scorebug', `${tag}: overlay ${info.score.join(':')} vs scorebug ${sb.join('-')}`, 'decision', await shot(page, 'dm-score'));
  const m = info.stakes.match(/(\d+)-(\d+)/);
  if (m && info.score.length === 2 && (Number(m[1]) !== info.score[0] || Number(m[2]) !== info.score[1])) issue('decision overlay score differs from its own stakes line', `${tag}: ${info.score.join(':')} vs "${info.stakes}"`, 'decision', null);
  const pos = st.pos;
  if (pos === 'GK' && !GK_KINDS.has(info.kind)) issue('goalkeeper got an outfield decision moment', `${tag}: ${info.kind} (${info.title})`, 'decision', await shot(page, 'dm-gk-kind'));
  if (pos && pos !== 'GK' && KEEPER_ONLY.has(info.kind)) issue('outfield player got a goalkeeper decision moment', `${tag}: ${pos} ${info.kind}`, 'decision', await shot(page, 'dm-kind'));
  // pick: by key (1-4) or by tapping a card
  const n = info.cards.length;
  const hintIdx = info.cards.findIndex((c) => c.hint);
  const idx = pick === 'hint' && hintIdx >= 0 ? hintIdx : typeof pick === 'number' ? Math.min(pick, n - 1) : (st.played || 0) % n;
  if (via === 'key') await page.keyboard.press(String(idx + 1));
  else await page.locator('.dm-card').nth(idx).click();
  const res = await page.locator('.dm-root[data-phase=result]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  let stamp = '', line = '', success = false;
  if (res) {
    ({ stamp, line, success } = await page.evaluate(() => ({ stamp: document.querySelector('.dm-root')?.dataset.stamp ?? '', line: document.querySelector('.dm-say p')?.textContent ?? '', success: document.querySelector('.dm-root')?.dataset.success === 'true' })));
    if (!stamp || !line) issue('decision result without stamp or commentary', `${tag}: ${info.kind}`, 'decision', await shot(page, 'dm-nostamp'));
    if (LATIN.test(line) || /undefined|NaN|\{/.test(line)) issue('decision commentary garbage', `${tag}: "${line}"`, 'decision', null);
    if (shotName) await shot(page, `${shotName}-result`);
    await page.locator('.dm-go').click().catch(() => {});
  } else issue('decision moment did not reach the result phase', `${tag}: ${info.kind} via ${via}`, 'decision', await shot(page, 'dm-stuck'));
  const gone = await page.locator('.dm-root').waitFor({ state: 'detached', timeout: 10000 }).then(() => true).catch(() => false);
  if (!gone) {
    issue('decision overlay did not close', tag, 'decision', await shot(page, 'dm-open'));
    await page.evaluate(() => document.getElementById('moment-host')?.dispatchEvent(new Event('moment-skip')));
  }
  const unlocked = await page.evaluate(() => document.body.style.overflow !== 'hidden');
  if (!unlocked) issue('page scroll still locked after the decision overlay', tag, 'decision', null);
  const rec = { run: st.label, pos, season: st.season, week: st.week, kind: info.kind, variant: info.variant, def: info.def, title: info.title, n, picked: info.cards[idx]?.label, hintPicked: !!info.cards[idx]?.hint, hint: info.cards.some((c) => c.hint), risk: info.cards[idx]?.risk, success, via, stamp, line, openMs, ms: now() - t0 };
  (log.decisions ||= []).push(rec);
  return { r: res && gone ? 'played' : 'stuck', ...rec };
}

async function playMomentByGesture(page) {
  await tap(page, 'שחק את הרגע');
  const canvas = page.locator('#moment-host canvas');
  const appeared = await canvas.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
  if (!appeared) return 'no-canvas';
  await sleep(1500); // intro
  const box = await canvas.boundingBox();
  if (box) {
    // a flick upwards from the lower middle: works as shot/pass/dribble gesture
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.75;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x + i * 4, y - i * 30);
    await page.mouse.up();
  }
  const gone = await canvas.waitFor({ state: 'detached', timeout: 30000 }).then(() => true).catch(() => false);
  if (!gone) {
    await page.evaluate(() => document.getElementById('moment-host')?.dispatchEvent(new Event('moment-skip')));
    await canvas.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    return 'stuck->skipped';
  }
  await idle(page);
  return 'played';
}

// ------------------------------------------------------------------ career driver (shared by all long scenarios)
/*
 * st = { S, label, detailed, season, week, lastLabel, weeksSeen, seasonWeeks, events, matches, played,
 *        transferDone, walkDone, negDone, reloaded, retireAt, deadline, seasonsMax, seasonLog }
 */
function newSeasonLog(st, save) {
  const s = { season: st.season, club: save?.club, league: save?.league, age: save?.age, weeks: 0, matches: 0, youth: 0, senior: 0, noMatch: 0, events: 0, injuredWeeks: 0, caps: save?.caps ?? 0, offseason: {} };
  st.seasonLog = s;
  log.seasons.push({ run: st.label, ...s });
  return log.seasons[log.seasons.length - 1];
}

async function settingsToggle(page, label, want) {
  const nav = page.locator('.bottom-nav button');
  await nav.nth(4).click();
  await idle(page);
  await page.getByRole('button', { name: /הגדרות/ }).first().click();
  await idle(page);
  const t = page.locator('.toggle', { hasText: label }).first();
  const on = (await t.getAttribute('aria-checked')) === 'true';
  if (on !== want) {
    await t.click();
    await idle(page, 200);
  }
  await backToTabs(page);
  await nav.nth(0).click();
  await idle(page);
}

/** Settings/news/goals have no bottom nav: go back with the top bar arrow (or history). */
async function backToTabs(page) {
  for (let i = 0; i < 3; i++) {
    if (await page.locator('.bottom-nav').isVisible().catch(() => false)) return;
    const back = page.locator('main.screen .topbar .icon-btn').first();
    if (await back.isVisible().catch(() => false)) await back.click().catch(() => {});
    else await page.goBack().catch(() => {});
    await idle(page, 200);
  }
}

async function weekLabelOf(page) {
  const t = (await page.locator('.week-screen .tb-sub').textContent().catch(() => '')).trim();
  const m = t.match(/עונה (\d+) · שבוע (\d+)/);
  return m ? { label: t, season: Number(m[1]), week: Number(m[2]) } : { label: t, season: NaN, week: NaN };
}

async function onWeekScreen(page, st) {
  if (st.detailed || st.week % 5 === 0) await audit(page, 'week');
  const wl = await weekLabelOf(page);
  const save = await readSave(page);
  if (wl.label !== st.lastLabel) {
    // new week
    if (st.week >= 0) {
      const ok = (wl.season === st.season && wl.week === st.week + 1) || (wl.season === st.season + 1 && wl.week === 1);
      if (!ok) issue('week/season counter jump', `${st.label}: s${st.season}w${st.week} -> s${wl.season}w${wl.week}`, 'week', await shot(page, 'counter-jump'));
    }
    if (wl.season !== st.season || !st.seasonLog) {
      st.season = wl.season;
      newSeasonLog(st, save);
      await shot(page, `${st.label}-s${st.season}-week1`);
      await checkClubConsistency(page, st, save, 'season start');
      if (save?.bytes) log.perf.saveBytes.push({ run: st.label, season: st.season, bytes: save.bytes, start: true });
      if (st.label === 'det' && st.season === 3 && !st.reloadedS3) {
        st.reloadedS3 = true;
        await reloadCompare(page, st, 'at season start');
      }
    }
    st.week = wl.week;
    st.lastLabel = wl.label;
    st.weeksSeen++;
    st.seasonLog.weeks++;
    log.seasons[log.seasons.length - 1].weeks = st.seasonLog.weeks;
    if (st.detailed) {
      const money = (await page.locator('.week-screen .money').textContent().catch(() => '')).trim();
      log.season.weeks.push({ label: wl.label, money });
      if (!/^₪[\d,.]+[KM]?$/.test(money.replace(/[‎‏]/g, ''))) issue('money format', `week ${wl.week}: "${money}"`, 'week', await shot(page, 'money'));
      if (st.week === 1 || st.week % 6 === 0) await shot(page, `week-${st.week}`);
    }
    // injury must be visible to the player
    if (save?.injury) {
      log.seasons[log.seasons.length - 1].injuredWeeks++;
      const txt = await page.evaluate(() => document.body.innerText);
      if (!/פצוע|פציעה|מחלים|החלמה/.test(txt)) issue('injury not shown on week screen', `${st.label} s${st.season}w${st.week}: ${save.injury.kind} (${save.injury.weeksLeft} weeks)`, 'week', await shot(page, `injury-hidden-s${st.season}w${st.week}`));
      else if (!st.injuryShot) {
        st.injuryShot = true;
        await shot(page, `injury-week-s${st.season}w${st.week}`);
      }
    }
    if (save && save.caps > (st.lastCaps ?? 0)) {
      log.long.national = (log.long.national || []).concat(`${st.label} s${st.season}w${st.week}: caps ${save.caps}`);
      st.lastCaps = save.caps;
    }
    if (st.detailed ? st.week % 4 === 1 : st.week === 2 || st.week === 15) await visitTabs(page, st, st.week);
    if (st.autoAfterBudget && st.decisionBudget <= 0 && !st.autoOn) {
      st.autoOn = true;
      await settingsToggle(page, 'רגעי מפתח: המשחק מחליט', true).catch(() => {});
    }
    // retirement
    if (st.retireAt && save?.age >= st.retireAt) return 'retire';
    // d. save/continue (deterministic career only)
    if (st.reloadAt === st.week && !st.reloaded && st.season === 1) {
      st.reloaded = true;
      await scenarioReload(page, wl.label);
      return 'continue';
    }
    // mid-season transfer offers (fast seasons)
    if (!st.detailed && st.season >= 2 && !st.transferDone && (await page.locator('.bottom-nav .badge').count()) > 0) {
      const r = await tryTransfer(page, st, 'midseason');
      if (r) return 'continue';
    }
  }
  if (st.reloadPlanAt === st.week && !st.reloadedMid && st.season === 1) {
    st.reloadedMid = true;
    await reloadMidWeek(page);
    return 'continue';
  }
  // the week: quick week or a manual plan
  const manual = st.detailed && st.week % 2 === 1;
  if (!manual) {
    const tq = now();
    await tap(page, 'שבוע מהיר', { after: 0 });
    await page.waitForFunction(() => !document.querySelector('main.screen.week-screen') && document.querySelector('.shell')?.getAttribute('aria-busy') !== 'true', null, { timeout: 20000 }).catch(() => {});
    log.perf.quickWeek.push(now() - tq);
    await sleep(120);
    const next = await screenOf(page);
    st.quickPaths = st.quickPaths || {};
    st.quickPaths[next] = (st.quickPaths[next] || 0) + 1;
    if (next === 'prematch') issue('quick week stopped on pre-match (decision: skip it)', `${st.label} s${st.season}w${st.week}`, 'prematch', await shot(page, 'quick-prematch'));
  } else {
    const closeBtn = page.getByRole('button', { name: 'סגור את השבוע' });
    if (!(await closeBtn.isVisible().catch(() => false)) || !(await closeBtn.isEnabled())) {
      const days = page.locator('.day.filled');
      while ((await days.count()) > 0) {
        await days.first().click();
        await sleep(60);
      }
      const items = page.locator('.tray-item');
      for (const i of [st.week % 4, 4, (st.week + 1) % 6]) {
        await items.nth(i).click();
        await sleep(80);
      }
    }
    await tap(page, 'סגור את השבוע');
  }
  return 'ok';
}

async function checkClubConsistency(page, st, save, when) {
  if (!save?.club) return;
  const s = await screenOf(page);
  if (s === 'week') {
    const title = (await page.locator('.week-screen .tb-title').textContent().catch(() => '')).trim();
    if (title !== save.club) issue('week top bar shows a different club than the save', `${when}: UI "${title}" save "${save.club}"`, 'week', await shot(page, 'club-mismatch'));
  }
}

async function onEventScreen(page, st) {
  await audit(page, 'event');
  const ev = await page.evaluate(() => ({
    title: document.querySelector('.event-title')?.textContent ?? '',
    body: document.querySelector('.event-body')?.textContent ?? '',
    because: document.querySelector('.because')?.textContent ?? null,
    category: document.querySelector('.event-top .chip')?.textContent ?? '',
    who: document.querySelector('.ew-name')?.textContent ?? null,
    options: [...document.querySelectorAll('.option-btn .opt-text')].map((b) => b.textContent),
    a11y: [...document.querySelectorAll('.option-btn')].map((b) => b.innerText.replace(/\n/g, ' | ')),
  }));
  ev.week = st.week;
  ev.season = st.season;
  ev.run = st.label;
  log.season.events.push(ev);
  st.events++;
  log.seasons[log.seasons.length - 1].events++;
  if (st.detailed && (st.events < 3 || st.events % 5 === 0)) await shot(page, `event-s${st.season}w${st.week}`);
  if (/צבא|נבחרת|העברה|קפטן/.test(ev.category + ev.title) && !st[`shotCat${ev.category}`]) {
    st[`shotCat${ev.category}`] = true;
    await shot(page, `event-${ev.category}-s${st.season}w${st.week}`);
  }
  if (ev.body.length > 220) issue('event body > 220 chars', `${ev.title} (${ev.body.length})`, 'event', await shot(page, 'event-long'));
  if (ev.options.length < 2 || ev.options.length > 4) issue('event option count', `${ev.title}: ${ev.options.length}`, 'event', await shot(page, 'event-opts'));
  const n = await page.locator('.option-btn').count();
  await page.locator('.option-btn').nth(st.detailed ? st.events % Math.max(1, n) : 0).click();
  const outcomeLines = await closeOutcome(page);
  log.outcomes ??= { shown: 0, missing: 0, empty: 0 };
  if (outcomeLines == null) log.outcomes.missing++; else { log.outcomes.shown++; if (outcomeLines === 0) log.outcomes.empty++; }
  await idle(page, 250);
}

/** Story answers open an outcome sheet ("מה זה גרם"); record it and tap on. */
async function closeOutcome(page) {
  const sheet = page.locator('.outcome-sheet');
  try { await sheet.waitFor({ state: 'visible', timeout: 2500 }); } catch { return null; }
  const lines = await sheet.locator('.outcome-line').count();
  await sheet.locator('button', { hasText: 'המשך' }).click();
  await sheet.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  return lines;
}

async function onMatchScreen(page, st) {
  const t0 = now();
  st.matches++;
  const sl = log.seasons[log.seasons.length - 1];
  sl.matches++;
  let firstMoment = true;
  const playThis = st.detailed && st.matches % 3 === 1;
  await sleep(st.detailed ? 400 : 100);
  const opening = await page.evaluate(() => (document.querySelector('.pitch-ticker')?.textContent ?? '') + ' / ' + [...document.querySelectorAll('.feed-row')].map((r) => r.textContent).join(' / '));
  const youth = /בנוער|U19|נוער/.test(opening) || (await page.locator('.scorebug .u19, .scorebug .chip').count()) > 0;
  if (youth) sl.youth++;
  else sl.senior++;
  if (st.lineup) {
    const promise = /לא בסגל/.test(st.lineup) ? 'out' : /נוער|U19/.test(st.lineup) ? 'youth' : /פותח|בהרכב/.test(st.lineup) ? 'start' : 'bench';
    const actual = /יציע|פצוע|לא נכנסת לסגל המשחק/.test(opening) ? 'out' : youth ? 'youth' : /על הספסל|מהספסל/.test(opening) ? 'bench' : 'start';
    if (promise !== actual)
      issue('pre-match lineup contradicts match', `${st.label} s${st.season}w${st.week}: pre-match "${st.lineup}", match "${opening.slice(0, 80)}"`, 'prematch', await shot(page, `lineup-mismatch-s${st.season}w${st.week}`));
  }
  const rec = { run: st.label, season: st.season, week: st.week, lineup: st.lineup || '(quick)', opening: opening.slice(0, 120) };
  log.season.matches.push(rec);
  st.lineup = null;
  while (now() - t0 < 120000) {
    if ((await screenOf(page)) !== 'match') return;
    if (await page.locator('.ft-card').isVisible().catch(() => false)) {
      await sleep(250);
      const score = (await page.locator('.ft-card .mc-title').textContent().catch(() => '')).trim();
      Object.assign(rec, { score, ms: now() - t0 });
      if (!/^\d+-\d+$/.test(score)) issue('full-time score format', `"${score}"`, 'match', await shot(page, 'ft-score'));
      else if (score.split('-').map(Number).reduce((a, b) => a + b) > 9) issue('unrealistic score', score, 'match', await shot(page, 'ft-score-high'));
      if (st.detailed && st.matches <= 3) {
        await audit(page, 'match-fulltime');
        await shot(page, `match-ft-s${st.season}w${st.week}`);
      }
      await tap(page, 'לסיכום השבוע', { after: 250 });
      return;
    }
    if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) {
      await audit(page, 'match-moment');
      // BUG-06: the scorebug must agree with the goals already in the feed
      const sb = await page.evaluate(() => ({
        score: [...document.querySelectorAll('.sb-score')].map((e) => e.textContent).join(''),
        goals: document.querySelectorAll('.feed-row.k-goal').length,
        clock: document.querySelector('.sb-clock')?.textContent ?? '',
        youth: !!document.querySelector('.scorebug.is-youth'),
      }));
      const nums = (sb.score.match(/\d+/g) || []).map(Number);
      if (nums.length === 2 && nums[0] + nums[1] !== sb.goals) issue('scorebug disagrees with goals in the feed', `${st.label} s${st.season}w${st.week}${sb.youth ? ' (U19)' : ''} at ${sb.clock}: scorebug ${nums.join('-')}, feed goals ${sb.goals}`, 'match', await shot(page, `scorebug-s${st.season}w${st.week}`));
      if ((firstMoment && playThis) || (st.decisionBudget > 0 && !st.detailed)) {
        firstMoment = false;
        if (st.decisionBudget > 0 && !st.detailed) st.decisionBudget--;
        if (st.played < 2) await shot(page, `moment-s${st.season}w${st.week}`);
        const d = await playDecision(page, st, { via: st.played % 2 ? 'key' : 'click', pick: st.played % 2 ? 'hint' : null, doAudit: st.played < 3, shotName: st.played < 2 ? `decision-${st.label}-s${st.season}w${st.week}` : null });
        st.played++;
        if (d.r !== 'played' && d.r !== 'moment-gone') issue('key moment did not resolve', `${st.label}: ${d.r}`, 'match', await shot(page, 'moment-stuck'));
        if (st.played <= 2) await shot(page, `after-moment-s${st.season}w${st.week}`);
        continue;
      }
      firstMoment = false;
      await tap(page, 'דלג לסוף המשחק');
      continue;
    }
    await sleep(120);
  }
  issue('match did not reach full time in 120s', `${st.label} s${st.season}w${st.week}`, 'match', await shot(page, 'match-stuck'));
  throw new Error('match timeout');
}

async function readWeekend(page) {
  return page.evaluate(() => ({
    headline: document.querySelector('.np-headline')?.textContent ?? null,
    score: document.querySelector('.rc-score')?.textContent ?? null,
    youth: !!document.querySelector('.result-card.is-youth, .u19-chip'),
    rating: document.querySelector('.stamp-big')?.textContent ?? null,
    stampWord: document.querySelector('.stamp-small')?.textContent ?? null,
    result: document.querySelector('.rc-line .chip')?.textContent ?? null,
    gains: [...document.querySelectorAll('.gain-row')].map((r) => r.innerText.replace(/\n/g, ' ')),
    near: [...document.querySelectorAll('.near-list .near-goal')].map((r) => ({ text: r.querySelector('.ng-top span')?.textContent ?? '', frac: r.querySelector('.ng-target')?.textContent ?? '', bar: Number(r.querySelector('.bar')?.getAttribute('aria-valuenow') ?? -1) })),
    meanwhile: [...document.querySelectorAll('.meanwhile li')].map((r) => r.textContent),
    loops: [...document.querySelectorAll('.loops li')].map((r) => r.textContent),
    summer: document.querySelector('.summer-card')?.innerText ?? null,
    button: document.querySelector('.weekend-screen .action-bar .btn')?.textContent ?? '',
  }));
}

async function onWeekendScreen(page, st) {
  await sleep(st.detailed ? 1100 : 150);
  if (st.detailed || st.week % 5 === 0) await audit(page, 'weekend');
  const we = await readWeekend(page);
  we.run = st.label;
  we.season = st.season;
  we.week = st.week;
  log.season.weekends.push(we);
  const sl = log.seasons[log.seasons.length - 1];
  if (!we.score && !/לעונה הבאה/.test(we.button)) sl.noMatch++;
  if (we.score) {
    if (we.youth) sl.youthWE = (sl.youthWE || 0) + 1;
    else sl.seniorWE = (sl.seniorWE || 0) + 1;
  }
  if (we.rating && !(Number(we.rating) >= 1 && Number(we.rating) <= 10)) issue('rating out of range', `${st.label} s${st.season}w${st.week}: ${we.rating}`, 'weekend', await shot(page, 'rating'));
  if (we.loops.length < 1) issue('week end without open loop (PRD §4)', `${st.label} s${st.season}w${st.week}`, 'weekend', st.detailed ? await shot(page, `weekend-noloop-s${st.season}w${st.week}`) : null);
  if (we.loops.length > 3) issue('more than 3 open loops', `${st.label} s${st.season}w${st.week}`, 'weekend', null);
  if (we.near.length > 2) issue('more than 2 near-goal bars', `${st.label} s${st.season}w${st.week}: ${we.near.length}`, 'weekend', await shot(page, `near3-s${st.season}w${st.week}`, true));
  for (const n of we.near) {
    const m = n.frac.match(/([\d.]+)\s*\/\s*([\d.]+)/);
    if (!m) continue;
    const [a, b] = [Number(m[1]), Number(m[2])];
    const want = b ? (a / b) * 100 : 0;
    if (b && Math.abs(want - n.bar) > 25) issue('near-goal bar fill disagrees with its numbers', `"${n.text}" ${a}/${b} bar ${n.bar}%`, 'weekend', await shot(page, 'near-bar'));
    const nums = (n.text.match(/\d+/g) || []).map(Number).filter((x) => x !== b - a);
    if (nums.length >= 1 && !nums.includes(b)) issue('near-goal text and counter use different units', `"${n.text}" vs ${a}/${b}`, 'weekend', await shot(page, 'near-units'));
  }
  // quick week answers: the week end lists exactly what report.autoEvents says (.auto-events)
  we.autoEvents = await page.$$eval('.auto-events li', (els) => els.map((e) => e.textContent)).catch(() => []);
  const sv = await readSave(page);
  const wantAuto = sv?.autoEvents ?? [];
  st.autoWeeks = (st.autoWeeks || 0) + (wantAuto.length ? 1 : 0);
  if (wantAuto.length && !we.autoEvents.length) issue('auto-events: quick week answered events but the week end has no list', `${st.label} s${st.season}w${st.week}: ${wantAuto.join(' | ').slice(0, 120)}`, 'weekend', await shot(page, `auto-events-missing-s${st.season}w${st.week}`));
  else if (wantAuto.length && wantAuto.some((t) => !we.autoEvents.includes(t))) issue('auto-events: list differs from report.autoEvents', `${st.label} s${st.season}w${st.week}: UI ${we.autoEvents.join(' | ')} / save ${wantAuto.join(' | ')}`.slice(0, 220), 'weekend', null);
  else if (!wantAuto.length && we.autoEvents.length) issue('auto-events: list shown with no auto-answered events', `${st.label} s${st.season}w${st.week}`, 'weekend', null);
  if (we.autoEvents.length && !st.autoShot) { st.autoShot = true; await shot(page, `auto-events-s${st.season}w${st.week}`, true); }
  (log.autoEvents ||= []).push({ run: st.label, season: st.season, week: st.week, save: wantAuto.length, ui: we.autoEvents.length });
  // near goals move: an attribute bar must not stay identical for 5 week ends in a row (core rotates a stalled one out after 3 weeks)
  st.nearTrack ||= ((log.nearTrackRuns ||= {})[`${st.label}#${Object.keys(log.nearTrackRuns || {}).length}`] = {});
  const seenKeys = new Set();
  for (const n of we.near) {
    const key = n.text.split(':')[0].trim();
    if (!ATTR_NAMES.includes(key)) continue;
    seenKeys.add(key);
    const tr = (st.nearTrack[key] ||= { last: null, same: 0, pairs: 0, moved: 0, flagged: false });
    const v = `${n.text}|${n.bar}`;
    if (tr.last != null) { tr.pairs++; if (tr.last === v) tr.same++; else { tr.moved++; tr.same = 0; tr.flagged = false; } }
    tr.last = v;
    if (tr.same >= 4 && !tr.flagged) { tr.flagged = true; issue('near goal stuck: the same attribute bar 5 week ends in a row', `${st.label} s${st.season}w${st.week}: "${n.text}" bar ${n.bar}%`, 'weekend', await shot(page, `near-stuck-s${st.season}w${st.week}`)); }
  }
  for (const [k, tr] of Object.entries(st.nearTrack)) if (!seenKeys.has(k)) { tr.last = null; tr.same = 0; tr.flagged = false; }
  // teenagers are not offered star roles at senior clubs (round 5)
  if (sv && sv.age < 19 && sv.offerRoles?.length) {
    (log.teenOffers ||= []).push({ run: st.label, season: st.season, week: st.week, age: sv.age, roles: sv.offerRoles });
    if (sv.offerRoles.includes('star')) issue('teen offered the star role', `${st.label} s${st.season}w${st.week}: age ${sv.age}, roles ${sv.offerRoles.join(',')}`, 'weekend', null);
  }
  for (const n of we.near) if (/\d+\.\d+\s*מתוך/.test(n.text + ' ' + n.frac)) issue('BUG-21: near-goal shows a decimal "x.y מתוך"', `"${n.text}" ${n.frac}`, 'weekend', null);
  if (we.gains.some((g) => /\+0\.0/.test(g))) issue('UX-03: "+0.0" rows in "מה השתפר"', `${st.label} s${st.season}`, 'weekend', null);
  if (st.detailed && (st.week <= 2 || st.week % 6 === 0)) await shot(page, `weekend-s${st.season}w${st.week}`, true);
  if (/לעונה הבאה/.test(we.button)) return 'offseason';
  await tap(page, 'לשבוע הבא', { after: st.detailed ? 300 : 120 });
  return 'ok';
}

/** Drive the career until offseason/end. Returns 'offseason' | 'end' | 'retire' | 'timeout'. */
async function playUntilBreak(page, st) {
  let guard = 0;
  while (guard++ < MAX_WEEKS * 14) {
    if (st.deadline && now() > st.deadline) return 'timeout';
    const s = await screenOf(page);
    try {
      if (s === 'week') {
        const r = await onWeekScreen(page, st);
        if (r === 'retire') return 'retire';
      } else if (s === 'event') await onEventScreen(page, st);
      else if (s === 'prematch') {
        await audit(page, 'prematch');
        st.lineup = (await page.locator('.lineup-status').textContent().catch(() => '')).trim();
        if (st.detailed && st.matches < 2) await shot(page, `prematch-s${st.season}w${st.week}`);
        await tap(page, page.locator('.prematch-screen .action-bar .btn-primary'));
      } else if (s === 'match') await onMatchScreen(page, st);
      else if (s === 'weekend') {
        const r = await onWeekendScreen(page, st);
        if (r === 'offseason') return 'offseason';
      } else if (s === 'contract') {
        await audit(page, 'contract');
        await shot(page, `contract-unexpected-s${st.season}w${st.week}`, true);
        log.notes.push(`${st.label}: negotiation screen opened by itself at s${st.season}w${st.week}`);
        await tap(page, /לחתום/);
      } else if (s === 'end') return 'end';
      else if (['agent', 'club', 'table', 'more', 'news', 'goals', 'settings'].includes(s)) {
        await backToTabs(page);
        await page.locator('.bottom-nav button').nth(0).click();
        await idle(page);
      } else {
        issue('unexpected screen in career loop', s, s, await shot(page, `unknown-${s}`));
        await sleep(500);
      }
    } catch (e) {
      issue('career loop error', `${st.label} ${s} s${st.season}w${st.week}: ${e.message.split('\n')[0]}`, s, await shot(page, `loop-error-${s}`));
      await sleep(400);
    }
  }
  return 'timeout';
}

/** Phone-fit table: compact/full toggle, no overflow, a row opens its details, names/crests sane. */
async function checkTableUi(page, st, wk) {
  const read = () =>
    page.evaluate(() => {
      const t = document.querySelector('.table-screen .ltable');
      const rows = [...document.querySelectorAll('.table-screen .ltable tbody tr:not(.row-detail)')];
      return {
        full: t?.classList.contains('full'),
        heads: [...document.querySelectorAll('.table-screen .ltable thead th')].map((h) => h.textContent),
        rows: rows.length,
        names: rows.map((r) => r.querySelector('.cc-name')?.textContent ?? ''),
        noCrest: rows.filter((r) => !r.querySelector('.club-cell svg, .club-cell img, .club-cell .crest')).length,
        tableW: Math.round(t?.getBoundingClientRect().width ?? 0),
        paperW: Math.round(document.querySelector('.table-paper')?.clientWidth ?? 0),
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        paperScroll: (document.querySelector('.table-paper')?.scrollWidth ?? 0) > (document.querySelector('.table-paper')?.clientWidth ?? 0) + 1,
        ellipsized: rows.filter((r) => { const n = r.querySelector('.cc-name'); return n && n.scrollWidth > n.clientWidth + 1; }).length,
        meVisible: (() => { const m = document.querySelector('.table-screen tr.me'); if (!m) return null; const b = m.getBoundingClientRect(); return b.height > 0; })(),
      };
    });
  const c = await read();
  const where = `${st.label} s${st.season}w${wk} (${page.viewportSize()?.width}px)`;
  const probs = [];
  // "מחזור X מתוך Y": Y is the league's real round count (3-4 legs in leagues of <=12 clubs)
  const sub = await page.locator('.table-screen .tb-sub').textContent().catch(() => '');
  const rm = (sub || '').match(/מחזור (\d+) מתוך (\d+)/);
  const wantRounds = (c.rows - 1) * legsFor(c.rows);
  if (!rm) probs.push(`no "מחזור X מתוך Y" label ("${sub}")`);
  else {
    if (Number(rm[2]) !== wantRounds) probs.push(`round label "${rm[0]}" but ${c.rows} clubs play ${wantRounds} rounds`);
    if (!/לפני/.test(sub) && Number(rm[1]) > Number(rm[2])) probs.push(`round label past the end: "${rm[0]}"`);
  }
  (log.roundLabels ||= []).push({ where, rows: c.rows, label: rm?.[0] ?? sub, want: wantRounds });
  if (c.names.some((n) => LATIN.test(n))) probs.push(`Latin names: ${c.names.filter((n) => LATIN.test(n)).join(', ')}`);
  if (new Set(c.names).size !== c.names.length) probs.push(`duplicate names: ${c.names.filter((n, i) => c.names.indexOf(n) !== i).join(', ')}`);
  if (c.noCrest) probs.push(`${c.noCrest} rows without a crest`);
  if (c.sw > c.iw || c.paperScroll) probs.push(`horizontal scroll (doc ${c.sw}/${c.iw}, paper ${c.paperScroll})`);
  const seg = page.locator('.table-screen .table-toggle button');
  if ((await seg.count()) === 2) {
    await seg.nth(1).click();
    await sleep(150);
    const f = await read();
    if (!f.full) probs.push('"מלא" did not switch the table');
    if (f.rows !== c.rows) probs.push(`full view rows ${f.rows} vs compact ${c.rows}`);
    if (f.sw > f.iw || f.paperScroll) probs.push(`full view scrolls horizontally (doc ${f.sw}/${f.iw})`);
    if (!st.tableFullShot) {
      st.tableFullShot = true;
      await shot(page, `table-full-${st.label}-s${st.season}w${wk}`, true);
    }
    await audit(page, 'table-full');
    log.season.tableUi = (log.season.tableUi || []).concat({ where, compactEllipsized: c.ellipsized, fullEllipsized: f.ellipsized, rows: c.rows, heads: f.heads.join(' ') });
    await seg.nth(0).click();
    await sleep(100);
  } else probs.push('no מקוצר/מלא toggle');
  // tap a row: details open
  const row = page.locator('.table-screen .ltable tbody tr.tap').nth(1);
  if (await row.isVisible().catch(() => false)) {
    await row.click();
    await sleep(150);
    const det = await page.locator('.table-screen tr.row-detail').textContent().catch(() => '');
    if (!/משחקים/.test(det)) probs.push(`row tap shows no details ("${det.slice(0, 40)}")`);
    else if (!st.rowDetailShot) {
      st.rowDetailShot = true;
      await shot(page, `table-row-detail-${st.label}`);
    }
    await row.click();
    await sleep(100);
  }
  for (const p of probs) issue('league table (phone-fit)', `${where}: ${p}`, 'table', await shot(page, 'table-problem'));
}

async function visitTabs(page, st, wk) {
  const nav = page.locator('.bottom-nav button');
  const save = await readSave(page);
  await nav.nth(1).click();
  await idle(page);
  await waitScreen(page, 'table');
  await audit(page, 'table');
  const t = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.table-screen .ltable tbody tr')];
    const played = rows.reduce((s, r) => s + Number(r.querySelectorAll('td')[2]?.textContent || 0), 0);
    return { rows: rows.length, played, me: !!document.querySelector('.table-screen tr.me'), meName: document.querySelector('.table-screen tr.me .club-cell span')?.textContent ?? null, sub: document.querySelector('.table-screen .tb-sub, .table-screen h1, .table-screen .tb-title')?.textContent ?? '' };
  });
  t.run = st.label;
  t.season = st.season;
  t.week = wk;
  log.season.tables.push(t);
  if (!t.me) issue('user club not highlighted in table', `${st.label} s${st.season}w${wk} (save club "${save?.club}")`, 'table', await shot(page, `table-nome-s${st.season}w${wk}`));
  else if (save?.club && t.meName !== save.club) issue('table highlights a different club than the save', `${t.meName} vs ${save.club}`, 'table', await shot(page, 'table-wrong-me'));
  if (st.detailed ? wk === 1 || wk % 8 === 1 : wk === 2) await shot(page, `table-s${st.season}w${wk}`, true);
  await checkTableUi(page, st, wk);
  await nav.nth(2).click();
  await idle(page);
  await waitScreen(page, 'club');
  await audit(page, 'club');
  const c = await page.evaluate(() => ({
    name: document.querySelector('.club-hero .h2')?.textContent,
    meta: document.querySelector('.club-hero .muted-wall')?.textContent,
    chips: [...document.querySelectorAll('.club-hero .chip')].map((e) => e.textContent),
    ovr: document.querySelector('.me-ovr .display')?.textContent,
    attrs: [...document.querySelectorAll('.club-screen .attr-val')].map((e) => e.textContent),
    wage: document.querySelector('.contract-strip b')?.textContent,
    pot: document.querySelector('.me-pot b')?.textContent,
    people: document.querySelectorAll('.club-screen .person-row').length,
    text: document.querySelector('.club-screen')?.innerText.slice(0, 400),
  }));
  c.run = st.label;
  c.season = st.season;
  c.week = wk;
  c.saveClub = save?.club;
  c.saveLeague = save?.league;
  c.saveAge = save?.age;
  log.season.club.push(c);
  if (save?.club && c.name !== save.club) issue('club screen shows a different club than the save', `${c.name} vs ${save.club}`, 'club', await shot(page, 'club-wrong'));
  const ageChip = c.chips.find((x) => /גיל/.test(x));
  if (save?.age && ageChip && Number(ageChip.match(/\d+/)?.[0]) !== save.age) issue('club screen age differs from save', `${ageChip} vs ${save.age}`, 'club', await shot(page, 'club-age'));
  const nums = [c.ovr, ...c.attrs].map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 1 || n > 99)) issue('attribute/overall out of 1..99', `${st.label} s${st.season}w${wk}: ${nums.join(',')}`, 'club', await shot(page, 'club-attr'));
  if (st.detailed ? wk === 1 || wk % 8 === 1 : wk === 2) await shot(page, `club-s${st.season}w${wk}`, true);
  await nav.nth(3).click();
  await idle(page);
  await waitScreen(page, 'agent');
  await audit(page, 'agent');
  if (st.detailed ? wk === 1 || wk % 8 === 1 : wk === 2) await shot(page, `agent-s${st.season}w${wk}`, true);
  if (st.detailed && (wk === 1 || wk === 13)) {
    await nav.nth(4).click();
    await idle(page);
    await audit(page, 'more');
    for (const [name, id] of [['חדשות', 'news'], ['מטרות', 'goals']]) {
      const b = page.getByRole('button', { name });
      if (await b.first().isVisible().catch(() => false)) {
        await b.first().click();
        await idle(page);
        await audit(page, id);
        await shot(page, `${id}-s${st.season}w${wk}`, true);
        await page.goBack();
        await idle(page);
      }
    }
  }
  await nav.nth(0).click();
  await idle(page);
}

// ------------------------------------------------------------------ negotiation helpers
const negInfo = async (page) =>
  page.evaluate(() => ({
    round: document.querySelector('.rounds span')?.textContent,
    finalCls: !!document.querySelector('.rounds.is-final, .final-banner'),
    offer: document.querySelector('.on-wage')?.textContent,
    last: [...document.querySelectorAll('.neg-log .bubble')].map((b) => b.textContent).slice(-1)[0] ?? '',
    glued: [...document.querySelectorAll('.neg-log .bubble')].map((b) => b.innerText).filter((t) => /״[א-ת]{2,}/.test(t)).slice(0, 1),
    ask: !document.querySelector('.neg-actions .btn-ink')?.disabled && !!document.querySelector('.neg-actions .btn-ink'),
    club: document.querySelector('.neg-head .tb-title')?.textContent,
    kind: document.querySelector('.neg-head .tb-sub')?.textContent,
  }));

/** Ask up to 3 times, stop at the final offer. Returns a text log. */
async function negotiateRounds(page, tag) {
  await audit(page, 'contract');
  await shot(page, `${tag}-contract-r1`, true);
  const rounds = [];
  for (let r = 0; r < 4; r++) {
    if ((await screenOf(page)) !== 'contract') {
      rounds.push(`closed -> ${await screenOf(page)}`);
      break;
    }
    const info = await negInfo(page);
    if (info.glued.length) issue('BUG-21: negotiation bubble glues the club short name to the text', `"${info.glued[0].slice(0, 40)}"`, 'contract', null);
    if (info.finalCls || /ההצעה האחרונה|מסכימים/.test(info.last)) {
      rounds.push(`final ${info.offer} (label "${info.round}", ask ${info.ask ? 'ENABLED' : 'disabled'})`);
      if (info.ask) issue('final offer still allows "לבקש" (BUG-03)', `${tag}: "${info.last}" label "${info.round}"`, 'contract', await shot(page, `${tag}-final-not-marked`, true));
      else if (!st_finalShot[tag]) {
        st_finalShot[tag] = true;
        await shot(page, `${tag}-contract-final`, true);
      }
      break;
    }
    await page.evaluate((k) => {
      const s = document.querySelector('.contract-screen input.slider');
      if (!s) return;
      const v = Math.min(Number(s.max), Math.round((Number(s.value) * (1 + 0.03 * k)) / 100) * 100);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(s, String(v));
      s.dispatchEvent(new Event('input', { bubbles: true }));
    }, r);
    await tap(page, 'לבקש', { exact: true, after: 400 });
    const tst = (await negInfo(page).catch(() => ({ last: '' }))).last || (log.season.toasts.slice(-1)[0]?.t ?? '');
    rounds.push(`${info.round}: ${info.offer} -> "${tst}"`);
    log.season.negotiation.push({ tag, ...info, toast: tst });
    if ((await screenOf(page)) === 'contract') {
      await audit(page, 'contract');
      await shot(page, `${tag}-contract-ask${r + 1}`, true);
    }
  }
  return rounds.join(' ; ');
}
const st_finalShot = {};

async function walkAway(page, tag) {
  await tap(page, 'לקום', { exact: true });
  await page.locator('.modal').waitFor({ state: 'visible', timeout: 3000 });
  await shot(page, `${tag}-walk-away-modal`);
  await audit(page, 'walkaway-modal');
  await page.locator('.modal').getByRole('button', { name: 'לקום וללכת' }).click();
  await idle(page, 400);
  return screenOf(page);
}

async function openAgent(page) {
  await page.locator('.bottom-nav button').nth(3).click();
  await idle(page);
  return waitScreen(page, 'agent', 5000);
}

/** Accept a transfer offer from the agent tab and verify the UI follows the new club. */
async function tryTransfer(page, st, when) {
  const before = await readSave(page);
  await openAgent(page);
  const offers = page.locator('.agent-screen .offer');
  if ((await offers.count()) === 0) {
    await page.locator('.bottom-nav button').nth(0).click();
    await idle(page);
    return false;
  }
  const target = (await offers.first().locator('.of-club').textContent().catch(() => '')).trim();
  if (!target || target === before?.club) {
    await page.locator('.bottom-nav button').nth(0).click();
    await idle(page);
    return false;
  }
  const tag = `transfer-s${st.season}`;
  const wBefore = await readWorld(page).catch(() => null);
  const tClub = wBefore ? [...wBefore.clubs.values()].find((c) => c.name === target) : null;
  const tLeague = tClub ? wBefore.leagues.find((l) => l.id === tClub.leagueId) : null;
  const lazyTarget = !!tClub && (tClub.lazy || !tClub.squad.length);
  const lazyLeague = tLeague ? tLeague.clubIds.filter((id) => wBefore.clubs.get(id)?.lazy).length : 0;
  await shot(page, `${tag}-agent`, true);
  await offers.first().getByRole('button', { name: 'לשבת למשא ומתן' }).click();
  await idle(page, 400);
  if ((await screenOf(page)) !== 'contract') {
    log.notes.push(`${st.label} ${when}: offer from ${target} did not open a negotiation (toast "${log.season.toasts.slice(-1)[0]?.t ?? ''}")`);
    await page.locator('.bottom-nav button').nth(0).click().catch(() => {});
    await idle(page);
    return false;
  }
  const rounds = await negotiateRounds(page, tag);
  let after = await screenOf(page);
  if (after === 'contract') {
    await tap(page, /לחתום/, { after: 600 });
    after = await screenOf(page);
  }
  await sleep(300);
  const save = await readSave(page);
  st.transferDone = true;
  const moved = save?.club && save.club !== before?.club;
  if (moved) st.transferJustSigned = true;
  await step(st.S, `transfer (${when}) to ${target}`, async () => {
    if (!moved) return `not moved (${rounds}); still ${save?.club}`;
    // UI must follow: week top bar, club screen, table, league
    const nav = page.locator('.bottom-nav button');
    const problems = [];
    if ((await page.locator('.bottom-nav').count()) > 0) {
      await nav.nth(0).click();
      await idle(page);
      const s = await screenOf(page);
      if (s === 'week') {
        const title = (await page.locator('.week-screen .tb-title').textContent()).trim();
        if (title !== save.club) problems.push(`week title "${title}"`);
        await shot(page, `${tag}-week-after`);
      }
      await nav.nth(2).click();
      await idle(page);
      const clubName = (await page.locator('.club-hero .h2').textContent().catch(() => '')).trim();
      if (clubName !== save.club) problems.push(`club screen "${clubName}"`);
      await shot(page, `${tag}-club-after`, true);
      await nav.nth(1).click();
      await idle(page);
      const me = (await page.locator('.table-screen tr.me .club-cell span').textContent().catch(() => '')).trim();
      if (me !== save.club) problems.push(`table highlights "${me}"`);
      // lazy league: squads materialise, the table shows the league's real clubs
      const names = await page.$$eval('.table-screen .ltable tbody tr .cc-name', (els) => els.map((e) => e.textContent));
      const wAfter = await readWorld(page).catch(() => null);
      const nl = wAfter?.leagues.find((l) => l.name === save.league && l.clubIds.includes(save.clubId));
      if (nl) {
        // in the offseason the table is last season's standings of the new league (clubs already moved for next season)
        const ids = wAfter.phase === 'offseason' && wAfter.tables[nl.id]?.length ? wAfter.tables[nl.id].map((r) => r.clubId) : nl.clubIds;
        const real = ids.map((id) => wAfter.clubs.get(id));
        const missing = real.filter((c) => !names.includes(c.name)).map((c) => c.name);
        const stillLazy = nl.clubIds.map((id) => wAfter.clubs.get(id)).filter((c) => c.lazy || c.squad.length < 16).map((c) => `${c.name} (${c.squad.length})`);
        if (missing.length) problems.push(`table lacks ${missing.slice(0, 3).join(', ')}`);
        if (names.length !== real.length) problems.push(`table rows ${names.length} vs league clubs ${real.length}`);
        if (stillLazy.length) problems.push(`squads not materialised: ${stillLazy.slice(0, 3).join(', ')}`);
        if (names.some((n) => LATIN.test(n))) problems.push(`Latin in table: ${names.filter((n) => LATIN.test(n)).join(', ')}`);
        if (new Set(names).size !== names.length) problems.push('duplicate names in the table');
      }
      if (lazyTarget || lazyLeague) {
        await nav.nth(2).click();
        await idle(page);
        const squad = await page.evaluate(() => [...document.querySelectorAll('.club-screen .person-row, .club-screen .squad-row, .club-screen .list-row')].map((r) => r.textContent.trim()).filter(Boolean));
        await shot(page, `${tag}-lazy-club-squad`, true);
        log.long.lazyTransfers = (log.long.lazyTransfers || []).concat(`${st.label} s${st.season}: ${target} (${tLeague?.name}, lazy club ${lazyTarget}, ${lazyLeague} lazy clubs in league) -> table ${names.length} rows, squad rows ${squad.length}`);
        if (squad.length < 3) problems.push(`club screen squad has ${squad.length} rows after moving into a lazy league`);
        await nav.nth(1).click();
        await idle(page);
      }
      await shot(page, `${tag}-table-after`, true);
      await nav.nth(0).click();
      await idle(page);
    }
    log.long.transfers = (log.long.transfers || []).concat(`${st.label} s${st.season} ${when}: ${before?.club} (${before?.league}) -> ${save.club} (${save.league}), wage ${save.contract?.wage}`);
    assert(problems.length === 0, `moved to ${save.club} but ${problems.join(', ')}`);
    return `${before?.club} -> ${save.club} (${save.league}, ${save.country})${lazyTarget || lazyLeague ? `; into a lazy league (${lazyLeague} lazy clubs before) -> ${save.leagueClubs} clubs, ${save.lazyInLeague} still lazy` : ''}`;
  });
  return true;
}

// ------------------------------------------------------------------ offseason
async function handleOffseason(page, st) {
  const S = `c-offseason${st.label === 'det' ? '' : `-${st.label}`}`;
  const sn = st.season;
  const sl = log.seasons[log.seasons.length - 1];
  st.transferJustSigned = false;
  // never start with a modal left open by a previous attempt
  if (await page.locator('.modal').isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await sleep(300);
    if (await page.locator('.modal').isVisible().catch(() => false)) await page.locator('.modal .btn').first().click().catch(() => {});
    await idle(page, 300);
    if ((await screenOf(page)) !== 'weekend') await page.locator('.bottom-nav button').nth(0).click().catch(() => {});
    await idle(page, 300);
  }
  await checkPromotion(page, st).catch((e) => record(S, `s${sn}: promotion oracle`, false, 0, e.message));
  if (st.label === 'det' && sn === 2) await reloadCompare(page, st, 'in offseason');
  const before = await readSave(page);
  sl.offseason = { contractEnd: before?.contract?.end, offers: before?.offers, wage: before?.contract?.wage };
  await audit(page, 'offseason');
  await shot(page, `${st.label}-s${sn}-offseason`, true);
  const expired = before?.contract ? before.contract.end <= sn : false;
  const summerTxt = await page.locator('.summer-card').innerText().catch(() => '');
  const abbr = summerTxt.match(/לבקש חידוש ב[^\s]*״[^\s]*$/m); // a full name like "קפו״ם אוסלו" continues on the same line
  if (abbr) issue('BUG-21: renewal button uses the club abbreviation', `"${abbr[0]}"`, 'weekend', null);
  await step(S, `s${sn}: offseason has tabs + summer card`, async () => {
    const nav = await page.locator('.bottom-nav').isVisible().catch(() => false);
    const card = await page.locator('.summer-card').isVisible().catch(() => false);
    assert(nav && card, `bottom nav ${nav}, summer card ${card}`);
    return `offers ${before?.offers}, contract until s${before?.contract?.end}${expired ? ' (EXPIRED)' : ''}`;
  });
  // 1) walk away (first time an offer or renewal can be opened)
  if (!st.walkDone) {
    await step(S, `s${sn}: walk away from a negotiation`, async () => {
      await page.locator('.summer-card .btn-ink').click();
      await idle(page);
      const s = await screenOf(page);
      assert(s === 'agent', `summer "agent" button led to ${s}`);
      const neg = page.getByRole('button', { name: 'לשבת למשא ומתן' });
      let via = 'offer';
      if (await neg.first().isVisible().catch(() => false)) await neg.first().click();
      else {
        via = 'renewal';
        await page.getByRole('button', { name: /לבקש חוזה חדש|לבקש חידוש/ }).first().click();
      }
      await idle(page, 400);
      if ((await screenOf(page)) !== 'contract') return `no negotiation via ${via}: "${log.season.toasts.slice(-1)[0]?.t ?? ''}"`;
      await page.evaluate(() => {
        const s = document.querySelector('.contract-screen input.slider');
        if (!s) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(s, s.max);
        s.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const after = await walkAway(page, `s${sn}`);
      st.walkDone = true;
      assert(after !== 'contract', 'still on contract after walking away');
      const sv = await readSave(page);
      assert(sv?.neg !== 'open', 'save still has an open negotiation');
      return `${via} -> walked away -> ${after}; toast "${log.season.toasts.slice(-1)[0]?.t ?? ''}"`;
    });
  }
  // 2) a transfer (season 2+) or a renewal negotiation to the final offer
  const navToWeekend = async () => {
    await page.locator('.bottom-nav button').nth(0).click();
    await idle(page);
    await waitScreen(page, 'weekend', 5000).catch(() => {});
  };
  // random careers: leave the first expired contract to the "המועדון יחליט" modal (no renewal, no transfer)
  const leaveToModal = expired && st.label !== 'det' && !st.modalTried;
  if (leaveToModal) st.modalTried = true;
  if (sn >= 2 && !st.transferDone && !leaveToModal) await tryTransfer(page, st, 'offseason').catch((e) => record(S, `s${sn}: transfer`, false, 0, e.message));
  if ((!st.negDone || expired) && !leaveToModal) {
    await step(S, `s${sn}: renewal negotiation -> final -> sign`, async () => {
      await navToWeekend();
      const rb = page.locator('.summer-card').getByRole('button', { name: /לבקש חידוש/ });
      if (!(await rb.isVisible().catch(() => false))) return 'no renewal button';
      if (!(await rb.isEnabled().catch(() => false))) return 'renewal button disabled';
      await rb.click({ timeout: 4000 });
      await idle(page, 400);
      if ((await screenOf(page)) !== 'contract') return `renewal refused: "${log.season.toasts.slice(-1)[0]?.t ?? ''}"`;
      const sv0 = await readSave(page);
      const rounds = await negotiateRounds(page, `renew-s${sn}`);
      if ((await screenOf(page)) !== 'contract') {
        // BUG-19: after talks collapse the renewal button should not invite another try
        await navToWeekend();
        const again = page.locator('.summer-card').getByRole('button', { name: /לבקש חידוש/ });
        const en = (await again.isVisible().catch(() => false)) && (await again.isEnabled().catch(() => false));
        if (en) issue('BUG-19: "לבקש חידוש" still enabled after talks collapsed', `${st.label} s${sn}`, 'weekend', await shot(page, `renew-after-collapse-s${sn}`));
        log.negCollapse = (log.negCollapse || []).concat(`${st.label} s${sn}: ${rounds}`);
        return `talks closed: ${rounds}; renewal button afterwards ${en ? 'ENABLED' : 'disabled/hidden'}`;
      }
      const wage = (await page.locator('.on-wage').textContent()).trim();
      await tap(page, /לחתום/, { after: 500 });
      const sv = await readSave(page);
      st.negDone = true;
      const cut = sv0?.contract?.wage && sv?.contract?.wage < sv0.contract.wage * 0.85;
      if (cut) issue('renewal signed below the current wage (BUG-10)', `s${sn}: ${sv0.contract.wage} -> ${sv.contract.wage}`, 'contract', await shot(page, `renew-cut-s${sn}`));
      return `${rounds} | signed ${wage}; wage ${sv0?.contract?.wage} -> ${sv?.contract?.wage}, until s${sv?.contract?.end}`;
    });
  }
  await navToWeekend();
  // 3) next season (expired contract -> modal)
  await step(S, `s${sn}: to next season`, async () => {
    const sv = await readSave(page);
    const nowExpired = sv?.contract ? sv.contract.end <= sn : true;
    const tn = now();
    await tap(page, 'לעונה הבאה', { after: 0 });
    await page.waitForFunction(() => !document.querySelector('main.screen.weekend-screen') || document.querySelector('.modal'), null, { timeout: 20000 }).catch(() => {});
    const nextMs = now() - tn;
    await sleep(400);
    if (!(await page.locator('.modal').isVisible().catch(() => false))) log.perf.nextSeason.push(nextMs);
    let detail = '';
    if (await page.locator('.modal').isVisible().catch(() => false)) {
      await shot(page, `s${sn}-expired-modal`);
      await audit(page, 'expired-modal');
      st.modalSeen = (st.modalSeen || 0) + 1;
      if (!st.modalChecked) {
        st.modalChecked = true;
        await page.locator('.modal').getByRole('button', { name: 'לבדוק הצעות' }).click();
        await idle(page);
        const s = await screenOf(page);
        assert(s === 'agent', `"לבדוק הצעות" led to ${s}`);
        await shot(page, `s${sn}-expired-agent`, true);
        await navToWeekend();
        await tap(page, 'לעונה הבאה', { after: 400 });
      }
      // the engine answers "המועדון יחליט" step by step (renewal talks / pointer to offers / agent finds a club / short deal)
      let presses = 0;
      const toastFrom = log.season.toasts.length;
      for (let k = 0; k < 8; k++) {
        if (await page.locator('.modal').isVisible().catch(() => false)) {
          await page.locator('.modal').getByRole('button', { name: 'המועדון יחליט' }).click();
          presses++;
          await idle(page, 600);
        } else if ((await screenOf(page)) === 'weekend') {
          await tap(page, 'לעונה הבאה', { after: 400 });
          continue;
        }
        const sc = await screenOf(page);
        detail += `press ${k + 1}: ${sc} "${log.season.toasts.slice(-1)[0]?.t ?? ''}"; `;
        if (sc === 'contract') {
          await shot(page, `s${sn}-club-decides-contract`, true);
          const rounds = await negotiateRounds(page, `decide-s${sn}`);
          if ((await screenOf(page)) === 'contract') await tap(page, /לחתום/, { after: 500 });
          detail += `negotiated (${rounds.slice(0, 80)}) -> ${await screenOf(page)}; `;
          if ((await screenOf(page)) === 'weekend') {
            await tap(page, 'לעונה הבאה', { after: 400 });
          }
        }
        if (['week', 'event', 'end'].includes(await screenOf(page))) break;
      }
      // the terms must be visible: "המועדון החליט: <club>, ₪X לחודש, <role>, ל<years>" (or the short-deal line), matching the save
      if (!/negotiated/.test(detail)) {
        await sleep(4000); // the banner shows one line at a time (3.5 s each)
        const tt = log.season.toasts.slice(toastFrom).map((x) => x.t);
        const term = tt.map((x) => x.match(/המועדון החליט: (.+?), ₪([\d,]+) לחודש, ([^,]+), ל-?(.+)$/)).find(Boolean);
        const short = tt.find((x) => /אף אחד לא סגר איתך/.test(x));
        const sv2 = await waitScreen(page, ['week', 'event', 'contract', 'end'], 15000).then(() => readSave(page));
        if (!term && !short) issue('club decides: no toast with the signed terms', `${st.label} s${sn}: toasts ${tt.join(' | ').slice(0, 160)}`, 'weekend', await shot(page, `s${sn}-decide-no-terms`));
        else if (term) {
          const wage = Number(term[2].replace(/,/g, ''));
          if (sv2?.club !== term[1] || sv2?.contract?.wage !== wage) issue('club decides: toast terms differ from the save', `${st.label} s${sn}: toast ${term[0]} / save ${sv2?.club} ₪${sv2?.contract?.wage}`, 'week', null);
          (log.clubDecidesTerms ||= []).push(`${st.label} s${sn}: ${term[0]}`);
        } else (log.clubDecidesTerms ||= []).push(`${st.label} s${sn}: ${short}`);
      }
      if (presses > 1) issue('BUG-18: "המועדון יחליט" needs more than one press', `${st.label} s${sn}: ${presses} presses: ${detail.slice(0, 200)}`, 'weekend', null);
      st.clubDecides = (st.clubDecides || []).concat(`s${sn}: ${presses} press(es): ${detail}`);
      log.notes.push(`${st.label} club-decides s${sn}: ${detail}`);
    } else if (nowExpired) issue('expired contract but no "המועדון יחליט" modal', `${st.label} s${sn}`, 'weekend', await shot(page, `s${sn}-no-modal`));
    const s = await waitScreen(page, ['week', 'event', 'contract', 'end'], 15000);
    const after = await readSave(page);
    const tl = log.season.toasts.slice(-4).map((t) => t.t).join(' | ');
    // "המועדון יחליט" may sign the best pending offer (the modal says so): only flag moves without any user decision
    if (after && before && after.club !== before.club && !/negotiated|press \d/.test(detail) && !st.transferJustSigned) issue('club changed at season start without the user signing', `${before.club} -> ${after.club}`, 'week', await shot(page, `s${sn}-auto-move`));
    if (s === 'week') await checkClubConsistency(page, st, after, `season ${sn + 1} start`);
    st.afterNext = s;
    return `${detail}-> ${s}; club ${before?.club} -> ${after?.club}, contract until s${after?.contract?.end}, age ${after?.age}; toasts: ${tl}`;
  });
  if (st.afterNext === 'week') await checkPromotionApplied(page, st).catch((e) => record(S, `s${sn + 1}: promotion applied`, false, 0, e.message));
}

// ------------------------------------------------------------------ career end
async function careerEndChecks(page, st, how) {
  const S = `g-career-end${st.label === 'det' ? '' : `-${st.label}`}`;
  await step(S, `career end screen (${how})`, async () => {
    await waitScreen(page, 'end', 15000);
    await page.locator('.ce-card img').waitFor({ state: 'visible', timeout: 20000 });
    await sleep(600);
    await audit(page, 'career-end');
    await shot(page, `${st.label}-career-end`);
    await shot(page, `${st.label}-career-end-full`, true);
    const info = await page.evaluate(() => {
      const img = document.querySelector('.ce-card img');
      return {
        w: img?.naturalWidth, h: img?.naturalHeight, reason: document.querySelector('.ce-head .muted-wall')?.textContent,
        stats: [...document.querySelectorAll('.ce-grid b')].map((b) => b.textContent),
        timeline: [...document.querySelectorAll('.ce-timeline .list-row')].map((r) => r.innerText.replace(/\n/g, ' ')),
        tlGeneric: [...document.querySelectorAll('.ce-timeline .list-row .lr-title')].filter((t) => t.textContent.trim() === 'מועדון').length,
        tlNoCrest: [...document.querySelectorAll('.ce-timeline .list-row')].filter((r) => !r.querySelector('svg, img, .crest')).length,
        story: [...document.querySelectorAll('.ce-story > div')].map((d) => d.innerText.replace(/\n+/g, ': ')),
        pathCrests: document.querySelectorAll('.offscreen [aria-label^="סמל"], .offscreen svg').length,
        trophies: [...document.querySelectorAll('.trophies li')].map((r) => r.textContent),
        buttons: [...document.querySelectorAll('.career-end button')].map((b) => b.textContent.trim()),
      };
    });
    log.long.end = info;
    // save the share card itself
    const src = await page.locator('.ce-card img').getAttribute('src');
    const data = await page.evaluate(async (u) => {
      const r = await fetch(u);
      const bl = await r.blob();
      return new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(bl);
      });
    }, src);
    fs.writeFileSync(path.join(SHOTS, `${String(++shotN).padStart(3, '0')}-${st.label}-share-card.png`), Buffer.from(String(data).split(',')[1], 'base64'));
    const problems = [];
    if (!(info.w && info.h && Math.abs(info.w / info.h - 9 / 16) < 0.01)) problems.push(`share card ${info.w}x${info.h} not 9:16`);
    if (info.stats.some((x) => !/^[\d.,-]+$/.test(x.trim()))) problems.push(`stats ${info.stats.join(',')}`);
    if (info.timeline.length < Math.max(1, st.season - 1)) problems.push(`timeline has ${info.timeline.length} rows for ${st.season} seasons`);
    if (info.tlGeneric) problems.push(`BUG-15: ${info.tlGeneric} timeline rows say "מועדון"`);
    if (info.tlNoCrest) problems.push(`BUG-15: ${info.tlNoCrest} timeline rows without a crest`);
    if (info.story.length < 2) problems.push(`career story lines: ${info.story.length}/2 (PRD §12 decision + person)`);
    const one = info.timeline.filter((t) => /(^|[^\d])1 (שערים|הופעות|בישולים)/.test(t));
    if (one.length) problems.push(`BUG-11 grammar: ${one[0]}`);
    assert(problems.length === 0, problems.join('; '));
    return `${info.w}x${info.h}, stats ${info.stats.join('/')}, ${info.timeline.length} seasons, trophies ${info.trophies.length}, path crests ${info.pathCrests}, story: ${info.story.join(' / ').slice(0, 120)}; reason "${info.reason}"`;
  });
  await step(S, 'career end -> new career button', async () => {
    const b = page.getByRole('button', { name: /קריירה חדשה|שחקן חדש|להתחיל/ });
    assert(await b.first().isVisible().catch(() => false), 'no new-career button on the career-end screen');
    await b.first().click();
    await idle(page);
    const s = await screenOf(page);
    assert(s === 'new', `went to ${s}`);
    return s;
  });
}

async function retireViaUi(page, st) {
  const S = `g-career-end${st.label === 'det' ? '' : `-${st.label}`}`;
  await step(S, `retire via "לתלות את הנעליים" at age ${(await readSave(page))?.age}`, async () => {
    await page.locator('.bottom-nav button').nth(4).click();
    await idle(page);
    await tap(page, 'לתלות את הנעליים');
    await page.locator('.modal').waitFor({ state: 'visible', timeout: 3000 });
    await shot(page, `${st.label}-retire-modal`);
    await page.locator('.modal').getByRole('button', { name: 'לפרוש' }).click();
    await idle(page, 500);
    const s = await waitScreen(page, ['end'], 10000);
    return s;
  });
}

// ------------------------------------------------------------------ d. reload / continue
async function scenarioReload(page, label) {
  const S = 'd-save-continue';
  const before = {
    label,
    club: (await page.locator('.week-screen .tb-title').textContent()).trim(),
    money: (await page.locator('.week-screen .money').textContent()).trim(),
  };
  const save = await readSave(page);
  await step(S, 'autosave matches the screen before reload', async () => {
    assert(save, 'no autosave in IndexedDB');
    assert(`שבוע ${save.week + 1}` === label.split(' · ')[1], `save week ${save.week + 1} vs UI "${label}"`);
    return `save phase ${save.phase}, week ${save.week + 1}`;
  });
  await step(S, 'reload -> title shows continue with same club/week', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitScreen(page, 'title', 20000);
    const sub = (await page.locator('.title-actions .btn-primary .sub').textContent().catch(() => '')).trim();
    await shot(page, 'reload-title');
    assert(sub.includes(before.club), `continue subtitle "${sub}" lacks club "${before.club}"`);
    assert(sub.includes(label.split(' · ')[1]), `continue subtitle "${sub}" lacks "${label.split(' · ')[1]}"`);
    return sub;
  });
  await step(S, 'continue -> same week/club/money', async () => {
    const t = now();
    await tap(page, /המשך קריירה/);
    await waitScreen(page, 'week', 10000);
    const ms = now() - t;
    const after = {
      label: (await page.locator('.week-screen .tb-sub').textContent()).trim(),
      club: (await page.locator('.week-screen .tb-title').textContent()).trim(),
      money: (await page.locator('.week-screen .money').textContent()).trim(),
    };
    await shot(page, 'reload-continued');
    assert(JSON.stringify(after) === JSON.stringify(before), `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
    assert(ms < 1500, `continue took ${ms}ms (PRD S1: < 1s)`);
    return `${ms}ms`;
  });
}

/** d. save/continue across seasons: reload in the offseason and at a new season's start, continue must land in the same place. */
async function reloadCompare(page, st, where) {
  await step('d-save-continue', `reload + continue ${where} (s${st.season})`, async () => {
    const b = await readSave(page);
    const sb = await screenOf(page);
    const summerBefore = await page.locator('.summer-card').isVisible().catch(() => false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitScreen(page, 'title', 20000);
    const sub = (await page.locator('.title-actions .btn-primary .sub').textContent().catch(() => '')).trim();
    const t = now();
    await tap(page, /המשך קריירה/);
    const sa = await waitScreen(page, [sb], 10000).catch(() => screenOf(page));
    const ms = now() - t;
    log.perf.continue.push(ms);
    const a = await readSave(page);
    await shot(page, `reload-${where.replace(/\s+/g, '-')}-s${st.season}`);
    const keys = ['season', 'week', 'phase', 'club', 'money', 'age', 'clubId'];
    const diff = keys.filter((k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])).map((k) => `${k} ${b?.[k]} -> ${a?.[k]}`);
    if (b?.contract?.end !== a?.contract?.end) diff.push(`contract end ${b?.contract?.end} -> ${a?.contract?.end}`);
    assert(sa === sb, `was on ${sb}, continue landed on ${sa}`);
    assert(diff.length === 0, diff.join(', '));
    if (summerBefore) assert(await page.locator('.summer-card').isVisible().catch(() => false), 'summer card gone after continue');
    assert(sub.includes(b?.club ?? '###'), `continue subtitle "${sub}" lacks club "${b?.club}"`);
    return `${sb} -> ${sa} in ${ms}ms; "${sub}"; save v${a?.version}, ${Math.round((a?.bytes ?? 0) / 1024)} KB`;
  });
}

/**
 * Promotion/relegation oracle. Called in the offseason: season.tables still hold the finished season, clubs already carry
 * their next-season league. Checks every link between tiers, closed leagues, sizes, and remembers the moves for the next season.
 */
async function checkPromotion(page, st) {
  const w = await readWorld(page);
  if (!w || w.phase !== 'offseason') return;
  log.perf.saveBytes.push({ run: st.label, season: w.season, bytes: w.bytes });
  const S = `i-promotion${st.label === 'det' ? '' : `-${st.label}`}`;
  await step(S, `s${w.season}: promotion/relegation across all leagues`, async () => {
    const problems = [];
    const lg = new Map(w.leagues.map((l) => [l.id, l]));
    const moves = [];
    const owner = new Map();
    for (const l of w.leagues) for (const id of l.clubIds) {
      if (owner.has(id)) problems.push(`club ${w.clubs.get(id)?.name} in two leagues`);
      owner.set(id, l.id);
      if (w.clubs.get(id)?.leagueId !== l.id) problems.push(`${w.clubs.get(id)?.name}: leagueId ${w.clubs.get(id)?.leagueId} but listed in ${l.name}`);
    }
    for (const [lid, rows] of Object.entries(w.tables)) {
      const from = lg.get(Number(lid));
      if (!from || !rows.length) continue;
      const sorted = sortRows(rows);
      sorted.forEach((r, i) => {
        const now_ = w.clubs.get(r.clubId)?.leagueId;
        if (now_ == null || now_ === from.id) return;
        const to = lg.get(now_);
        moves.push({ club: w.clubs.get(r.clubId)?.name, clubId: r.clubId, from, to, place: i + 1, n: sorted.length });
      });
      if (from.clubIds.length !== rows.length) problems.push(`${from.name} (${from.country}): ${rows.length} clubs this season, ${from.clubIds.length} next season`);
    }
    for (const m of moves) {
      const down = m.to.tier > m.from.tier;
      const ids = down ? (m.from.relegatesToIds ?? [m.from.relegatesTo]) : (m.from.promotesToIds ?? [m.from.promotesTo]);
      // round 6: a reserve team may switch regional group to stay out of its relegated parent's league
      if (m.to.tier === m.from.tier && w.clubs.get(m.clubId)?.reserveOf == null && !moves.some((x) => x.from.id === m.to.id && x.to.id === m.from.id && w.clubs.get(x.clubId)?.reserveOf != null)) problems.push(`${m.club}: moved sideways ${m.from.name} -> ${m.to.name}`);
      if (m.to.tier === m.from.tier) continue;
      if (Math.abs(m.to.tier - m.from.tier) !== 1) problems.push(`${m.club}: ${m.from.name} (tier ${m.from.tier}) -> ${m.to.name} (tier ${m.to.tier})`);
      if (!ids.includes(m.to.id)) problems.push(`${m.club}: ${m.from.name} -> ${m.to.name} is not a linked league`);
      // round 6: a parent in the drop zone stays up when its reserve team can't make room; the next club goes down instead
      const parentKeptUp = () => sortRows(w.tables[m.from.id] ?? []).slice(m.n - m.from.relegateSpots).some((r) => w.clubs.get(r.clubId)?.leagueId === m.from.id && [...w.clubs.values()].some((c) => c.reserveOf === r.clubId));
      if (down && m.place <= m.n - m.from.relegateSpots && !parentKeptUp()) problems.push(`${m.club} relegated from ${m.from.name} in place ${m.place}/${m.n} (relegation spots ${m.from.relegateSpots})`);
      if (!down && m.place > Math.max(m.from.promoteSpots + 3, Math.ceil(m.n / 2))) problems.push(`${m.club} promoted from ${m.from.name} in place ${m.place}/${m.n} (promotion spots ${m.from.promoteSpots})`);
      if (m.from.country !== m.to.country) problems.push(`${m.club}: moved country ${m.from.country} -> ${m.to.country}`);
    }
    // closed leagues (no links) and every relegation zone actually used
    for (const l of w.leagues) {
      const linked = (l.promotesToIds?.length || l.promotesTo != null || l.relegatesToIds?.length || l.relegatesTo != null);
      const mv = moves.filter((m) => m.from.id === l.id || m.to.id === l.id);
      if (!linked && mv.length) problems.push(`closed league ${l.name} had moves`);
      const down = moves.filter((m) => m.from.id === l.id && m.to.tier > l.tier).length;
      const up = moves.filter((m) => m.to.id === l.id && m.from.tier > l.tier).length;
      if (down !== up) problems.push(`${l.name}: ${down} relegated but ${up} promoted into it`);
      if ((l.relegatesToIds?.length || l.relegatesTo != null) && l.relegateSpots > 0 && down === 0 && w.tables[l.id]?.length) problems.push(`${l.name}: has ${l.relegateSpots} relegation spots but nobody went down`);
    }
    // the season-end week report ("בינתיים") must agree with the moves
    const lastWe = [...log.season.weekends].reverse().find((x) => x.run === st.label);
    const said = (lastWe?.meanwhile || []).map((t) => t.match(/^(.+) (עולה|יורדת) /)).filter(Boolean);
    for (const m of said) {
      const mv = moves.find((x) => x.club === m[1]);
      if (!mv) problems.push(`week report says "${m[0]}" but ${m[1]} did not move`);
      else if ((m[2] === 'יורדת') !== mv.to.tier > mv.from.tier) problems.push(`week report direction wrong for ${m[1]}`);
    }
    // round counts (round 5): every club played (n-1) x legs; leagues of <=12 clubs meet 3-4 times
    const smallLeagues = [];
    for (const [lid, rows] of Object.entries(w.tables)) {
      const l = lg.get(Number(lid));
      if (!l || !rows.length) continue;
      const want = (rows.length - 1) * legsFor(rows.length);
      const bad = rows.filter((r) => r.p !== want);
      if (bad.length) problems.push(`${l.name} (${rows.length} clubs): ${bad.length} clubs played ${[...new Set(bad.map((r) => r.p))].join('/')} matches, expected ${want}`);
      if (rows.length <= 12) smallLeagues.push(`${l.name} ${rows.length}x${legsFor(rows.length)}`);
    }
    // BUG-24: a reserve team is never in its parent's league or above it (same country), before or after the moves
    const reserves = [...w.clubs.values()].filter((c) => c.reserveOf != null);
    for (const c of reserves) {
      const par = w.clubs.get(c.reserveOf);
      const cl = lg.get(c.leagueId), pl = par ? lg.get(par.leagueId) : null;
      if (cl && pl && cl.countryCode === pl.countryCode && (cl.id === pl.id || cl.tier < pl.tier)) problems.push(`BUG-24: reserve team ${c.name} (${cl.name}, tier ${cl.tier}) in or above its parent's league ${par.name} (${pl.name}, tier ${pl.tier})`);
    }
    const reservesBlocked = [];
    for (const [lid, rows] of Object.entries(w.tables)) {
      const l = lg.get(Number(lid));
      if (!l || !l.promoteSpots) continue;
      sortRows(rows).slice(0, l.promoteSpots).forEach((r) => { const c = w.clubs.get(r.clubId); if (c?.reserveOf != null && c.leagueId === l.id) reservesBlocked.push(`${c.name} (${l.name})`); });
    }
    // BUG-23: clubs relegated into regional groups go to their own region. A wrong group counts only if a swap with
    // another club relegated from the same league would have put both right (both in one region is unavoidable).
    const regionNotes = [];
    for (const upper of w.leagues) {
      const down = moves.filter((m) => m.from.id === upper.id && m.to.tier > upper.tier);
      for (const m of down) {
        const cr = normRegion(w.clubs.get(m.clubId)?.region);
        const gr = normRegion(m.to.region);
        if (!cr || !gr || cr === gr) continue;
        const swap = down.find((o) => o !== m && normRegion(o.to.region) === cr && normRegion(w.clubs.get(o.clubId)?.region) !== cr);
        if (swap) problems.push(`BUG-23: ${m.club} (${cr}) relegated to ${m.to.name} while ${swap.club} (${normRegion(w.clubs.get(swap.clubId)?.region) ?? 'no region'}) took the ${cr} slot`);
        else regionNotes.push(`${m.club} (${cr}) -> ${m.to.name} (no other slot)`);
      }
    }
    const mls = w.leagues.filter((l) => /MLS|אמריקא|ארצות הברית|ארה״ב/.test(l.name + l.country));
    st.lastMoves = moves.map((m) => ({ clubId: m.clubId, club: m.club, from: m.from.name, to: m.to.name, toId: m.to.id, fromId: m.from.id, tierFrom: m.from.tier, tierTo: m.to.tier, country: m.to.country }));
    const il = moves.filter((m) => m.from.country === 'ישראל').map((m) => `${m.club}: ${m.from.name} -> ${m.to.name}`);
    (log.promotion ||= []).push({ run: st.label, season: w.season, moves: moves.length, israel: il, mls: mls.map((l) => l.name), sample: moves.slice(0, 6).map((m) => `${m.club} ${m.from.name}#${m.place} -> ${m.to.name}`), smallLeagues, reserves: reserves.length, reservesBlocked, regionNotes });
    assert(problems.length === 0, problems.slice(0, 6).join(' | '));
    return `${moves.length} moves in ${new Set(moves.map((m) => m.from.country)).size} countries; Israel: ${il.join(', ') || 'none'}; closed: ${mls.map((l) => l.name).join(', ') || 'no US league found'}; ${smallLeagues.length} small leagues with 3-4 legs; ${reserves.length} reserve teams, blocked in a promotion spot: ${reservesBlocked.join(', ') || 'none'}; unavoidable region mismatches: ${regionNotes.length}`;
  });
}

/** Next season: the clubs that moved must be in their new league's table; in the user's league the UI table must show them. */
async function checkPromotionApplied(page, st) {
  if (!st.lastMoves?.length) return;
  const moves = st.lastMoves;
  st.lastMoves = null;
  const w = await readWorld(page);
  const S = `i-promotion${st.label === 'det' ? '' : `-${st.label}`}`;
  await step(S, `s${w.season}: moved clubs play in their new leagues`, async () => {
    const problems = [];
    for (const m of moves) {
      const rows = w.tables[m.toId] ?? [];
      if (rows.length && !rows.some((r) => r.clubId === m.clubId)) problems.push(`${m.club} not in the ${m.to} table`);
      const old = w.tables[m.fromId] ?? [];
      if (old.some((r) => r.clubId === m.clubId)) problems.push(`${m.club} still in the ${m.from} table`);
    }
    // UI: the user's league table
    const sv = await readSave(page);
    const mine = moves.filter((m) => m.to === sv?.league || m.from === sv?.league);
    let ui = '';
    if (mine.length && (await screenOf(page)) === 'week') {
      await page.locator('.bottom-nav button').nth(1).click();
      await idle(page);
      const names = await page.$$eval('.table-screen .ltable tbody tr .cc-name', (els) => els.map((e) => e.textContent));
      for (const m of mine) {
        const shown = names.includes(m.club);
        if (m.to === sv.league && !shown) problems.push(`UI table of ${sv.league} lacks ${m.club} (came from ${m.from})`);
        if (m.from === sv.league && shown && m.to !== sv.league) problems.push(`UI table of ${sv.league} still shows ${m.club} (moved to ${m.to})`);
      }
      ui = `; UI table checked for ${mine.length} moved clubs`;
      await shot(page, `promotion-table-s${w.season}`, true);
      await page.locator('.bottom-nav button').nth(0).click();
      await idle(page);
    }
    assert(problems.length === 0, problems.slice(0, 6).join(' | '));
    return `${moves.length} moved clubs found in their new tables${ui}`;
  });
}

/** World sanity: real club names (no Latin), no duplicates within a country, crest specs and colours. */
async function checkWorldNames(page, S) {
  const w = await readWorld(page);
  await step(S, 'world: leagues/clubs, names, crests', async () => {
    const clubs = [...w.clubs.values()];
    const latin = clubs.filter((c) => LATIN.test(`${c.name}${c.short}${c.city}`)).map((c) => `${c.name}/${c.short}`);
    const byCountry = new Map();
    for (const c of clubs) {
      const k = `${c.countryCode}|${c.name}`;
      byCountry.set(k, (byCountry.get(k) || 0) + 1);
    }
    const dups = [...byCountry].filter(([, n]) => n > 1).map(([k, n]) => `${k.split('|')[1]} x${n}`);
    const shortDup = new Map();
    for (const l of w.leagues) {
      const seen = new Map();
      for (const id of l.clubIds) {
        const c = w.clubs.get(id);
        if (seen.has(c.short)) shortDup.set(`${l.name}: ${c.short}`, `${seen.get(c.short)} / ${c.name}`);
        seen.set(c.short, c.name);
      }
    }
    const bad = clubs.filter((c) => !c.name?.trim() || !c.short?.trim() || /undefined|null|NaN|\d{3,}/.test(`${c.name} ${c.short}`.replace(/(^|\s)(18|19|20)\d\d(?=\s|$)/g, ' '))).map((c) => c.name);
    const longShort = clubs.filter((c) => c.short && [...c.short].length > 8).map((c) => c.short);
    const sameColors = clubs.filter((c) => Array.isArray(c.colors) && String(c.colors[0]).toLowerCase() === String(c.colors[1]).toLowerCase()).map((c) => c.name);
    const noCrest = clubs.filter((c) => !c.crest).map((c) => c.name);
    const lazy = clubs.filter((c) => c.lazy).length;
    const tiers = new Map();
    for (const l of w.leagues) tiers.set(l.country, Math.max(tiers.get(l.country) || 0, l.tier));
    log.world = { leagues: w.leagues.length, clubs: clubs.length, lazy, countries: tiers.size, latin, dups, shortDup: [...shortDup].map(([k, v]) => `${k} (${v})`), bad, longShort: [...new Set(longShort)].slice(0, 20), sameColors, noCrest, bytes: w.bytes, version: w.version };
    const probs = [];
    if (latin.length) probs.push(`Latin in ${latin.length} club names: ${latin.slice(0, 5).join(', ')}`);
    if (dups.length) probs.push(`duplicate club names: ${dups.slice(0, 5).join(', ')}`);
    if (shortDup.size) probs.push(`duplicate short names in a league: ${[...shortDup].slice(0, 4).map(([k, v]) => `${k} (${v})`).join(', ')}`);
    if (bad.length) probs.push(`bad names: ${bad.slice(0, 5).join(', ')}`);
    if (sameColors.length) probs.push(`crest with identical colours: ${sameColors.slice(0, 5).join(', ')}`);
    if (noCrest.length) probs.push(`no crest: ${noCrest.slice(0, 5).join(', ')}`);
    assert(probs.length === 0, probs.join(' | '));
    return `${w.leagues.length} leagues, ${clubs.length} clubs (${lazy} lazy), ${tiers.size} countries, save v${w.version} ${Math.round(w.bytes / 1024)} KB`;
  });
}

async function reloadMidWeek(page) {
  const S = 'd-save-continue';
  await step(S, 'reload mid-week (after closing the plan) keeps the phase', async () => {
    const items = page.locator('.tray-item');
    const closeBtn = page.getByRole('button', { name: 'סגור את השבוע' });
    if (!(await closeBtn.isEnabled().catch(() => false))) for (const i of [0, 4, 1]) await items.nth(i).click();
    await tap(page, 'סגור את השבוע', { after: 400 });
    const mid = await screenOf(page);
    const midText = await page.evaluate(() => document.querySelector('.event-title, .lineup-status')?.textContent ?? '');
    if (mid === 'week') return 'still on week';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitScreen(page, 'title', 20000);
    await tap(page, /המשך קריירה/);
    await sleep(800);
    const back = await screenOf(page);
    const backText = await page.evaluate(() => document.querySelector('.event-title, .lineup-status')?.textContent ?? '');
    await shot(page, 'reload-midweek-continued');
    assert(back === mid, `was on "${mid}" before reload, continue landed on "${back}" (progress lost)`);
    assert(backText === midText, `same screen but different content: "${midText}" -> "${backText}"`);
    return `${mid} ("${midText}") -> ${back}`;
  });
}

// ------------------------------------------------------------------ a. first kick
async function scenarioFirstKick(run, seed, { continueSeasons = 0, pos = 'W' } = {}) {
  const tag = seed === QA_SEED ? 'fixed' : 'random';
  const S = `a-first-kick#${run}-${tag}-${pos}`;
  // random runs get a logged random seed (injected like the fixed one) so any finding can be replayed with QA_SEED
  const useSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
  const { ctx, page } = await newPage(MOBILE, `first-kick-${run}`, { seed: useSeed });
  try {
    let taps = 0;
    const t0 = now();
    const marks = { run, seed: tag };
    await step(S, 'open page -> title', async () => {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await waitScreen(page, 'title', 20000);
      marks.title = now() - t0;
      return `${marks.title}ms`;
    });
    await step(S, 'title -> new career -> reveal -> week', async () => {
      taps += await startNewCareer(page, { name: seed === QA_SEED ? QA_NAME : null, pos });
      marks.week = now() - t0;
      const save = await readSave(page);
      marks.start = `${save?.club} (${save?.league}), age ${save?.age}, ${save?.pos}, seed ${useSeed}`;
      assert(save?.pos === pos, `picked ${pos} on the board, save has ${save?.pos}`);
      return `${taps} taps, ${marks.week}ms, ${marks.start}`;
    });
    await step(S, 'quick week -> first key moment', async () => {
      await tap(page, 'שבוע מהיר');
      taps++;
      const seen = [];
      const end = now() + 60000;
      while (now() < end) {
        const s = await screenOf(page);
        if (!seen.includes(s)) seen.push(s);
        if (s === 'event') {
          await page.locator('.option-btn').first().click();
          await closeOutcome(page);
          taps++;
          await idle(page);
        } else if (s === 'prematch') {
          marks.lineup = (await page.locator('.lineup-status').textContent().catch(() => '')).trim();
          await tap(page, page.locator('.prematch-screen .action-bar .btn-primary'));
          taps++;
        } else if (s === 'match') {
          if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) {
            marks.feed = await page.evaluate(() => [...document.querySelectorAll('.feed-row')].map((r) => r.textContent).join(' / '));
            marks.momentMinute = (await page.locator('.sb-clock').textContent().catch(() => '')).trim();
            break;
          }
          if (await page.locator('.ft-card').isVisible().catch(() => false)) throw new Error(`match ended without a key moment (screens: ${seen.join('>')})`);
          await sleep(100);
        } else if (s === 'weekend') throw new Error(`week ended without a key moment (screens: ${seen.join('>')})`);
        else await sleep(100);
      }
      assert(await page.locator('.moment-card:not(.ft-card)').isVisible(), `no key moment within 60s (screens: ${seen.join('>')})`);
      marks.moment = now() - t0;
      marks.taps = taps;
      marks.path = seen.join('>');
      await shot(page, `first-kick-${run}-moment`);
      log.firstKick = marks;
      (log.firstKicks ||= []).push(marks);
      assert(marks.moment < 60000, `first key moment after ${marks.moment}ms (>60s)`);
      return `${taps} taps, ${(marks.moment / 1000).toFixed(1)}s total, path ${marks.path}, moment at ${marks.momentMinute}`;
    });
    await step(S, 'quick week skips pre-match (CTO decision)', async () => {
      assert(!(marks.path || '').includes('prematch'), `quick week went through pre-match (${marks.path})`);
    });
    const dst = { label: `fk${run}`, pos, season: 1, week: 1, played: 0 };
    await step(S, 'first match has >= 3 key moments (PRD §5.5), all played as decisions', async () => {
      let count = 1;
      for (let i = 0; i < 8; i++) {
        if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) {
          const d = await playDecision(page, dst, { via: i % 2 ? 'key' : 'click', doAudit: true, shotName: i < 2 ? `decision-fk${run}-${pos}-${i + 1}` : null });
          dst.played++;
          if (d.r !== 'played') throw new Error(`decision moment ${i + 1}: ${d.r}`);
          await idle(page);
        }
        const end = now() + 15000;
        while (now() < end) {
          if (await page.locator('.ft-card').isVisible().catch(() => false)) break;
          if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) break;
          if ((await screenOf(page)) !== 'match') break;
          await sleep(100);
        }
        if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) count++;
        else break;
      }
      marks.momentsInFirstMatch = count;
      assert(count >= 3, `first match had ${count} key moment(s) (feed: ${marks.feed})`);
      const ds = log.decisions.filter((d) => d.run === dst.label);
      return `${count} moments: ${ds.map((d) => `${d.kind}/${d.variant} ${d.n} cards -> "${d.stamp}"`).join('; ')}`;
    });
    if (continueSeasons > 0) {
      // random-seed careers: 2 fast seasons to exercise offseason transitions on unknown worlds
      const st = { S: `h-random#${run}-${pos}`, label: `rnd${run}`, pos, decisionBudget: 10, autoAfterBudget: true, detailed: false, season: 1, week: -1, lastLabel: null, weeksSeen: 0, events: 0, matches: 0, played: 0, deadline: now() + 12 * 60000 };
      if ((await screenOf(page)) === 'match') {
        const ft = page.getByRole('button', { name: 'לסיכום השבוע' });
        const sim = page.getByRole('button', { name: 'דלג לסוף המשחק' });
        if (await sim.isEnabled().catch(() => false)) await sim.click().catch(() => {});
        await ft.waitFor({ timeout: 20000 }).catch(() => {});
        await ft.click().catch(() => {});
        await idle(page);
      }
      st.lastLabel = null;
      newSeasonLog(st, await readSave(page));
      await settingsToggle(page, 'תנועה מופחתת', true).catch(() => {});
      for (let k = 0; k < continueSeasons; k++) {
        const r = await playUntilBreak(page, st);
        record(st.S, `season ${st.season} played (${log.seasons[log.seasons.length - 1].weeks} weeks)`, r === 'offseason', 0, `${r}; ${JSON.stringify(log.seasons[log.seasons.length - 1])}`);
        if (r !== 'offseason') break;
        await handleOffseason(page, st);
      }
      errorsCheck(st.S, page);
    } else errorsCheck(S, page);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ n. "המועדון יחליט" on demand (round 4)
/** Edit the autosave in IndexedDB (test-only): fn gets the parsed save file and returns it changed. */
async function patchSave(page, fnSrc) {
  return page.evaluate(
    (src) =>
      new Promise((res) => {
        const r = indexedDB.open('football-career');
        r.onerror = () => res(false);
        r.onsuccess = () => {
          const tx = r.result.transaction('saves', 'readwrite');
          const os = tx.objectStore('saves');
          const g = os.get('autosave');
          g.onsuccess = () => {
            try {
              const f = JSON.parse(g.result);
              // eslint-disable-next-line no-new-func
              const out = new Function('f', src)(f);
              os.put(JSON.stringify(out ?? f), 'autosave');
              tx.oncomplete = () => res(true);
            } catch (e) {
              res(String(e));
            }
          };
          g.onerror = () => res(false);
        };
      }),
    fnSrc,
  );
}

async function scenarioClubDecides() {
  const S = 'n-club-decides';
  const { ctx, page } = await newPage(MOBILE, 'club-decides', { seed: QA_SEED + 11 });
  try {
    const st = { S, label: 'cd', pos: 'ST', decisionBudget: 0, autoAfterBudget: true, detailed: false, season: 1, week: -1, lastLabel: null, weeksSeen: 0, events: 0, matches: 0, played: 0, deadline: now() + 12 * 60000 };
    await step(S, 'new career, season 1 to the offseason', async () => {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await waitScreen(page, 'title', 20000);
      await startNewCareer(page, { pos: 'ST' });
      await settingsToggle(page, 'תנועה מופחתת', true).catch(() => {});
      newSeasonLog(st, await readSave(page));
      const r = await playUntilBreak(page, st);
      assert(r === 'offseason', `stopped with ${r}`);
      const sv = await readSave(page);
      return `${sv?.club} (${sv?.league}), contract until s${sv?.contract?.end}, offers ${sv?.offers}`;
    });
    await step(S, 'expire the contract (save edit), reload, continue to the week end', async () => {
      const ok = await patchSave(page, `
        const w = f.world; const pid = w.career.playerId;
        const t = (w.players || []).find((x) => x[0] === pid);
        const c = t ? t[13]?.contract : w.people[pid]?.contract;
        if (!c) throw new Error('no contract');
        c.endSeason = w.season.number;
        return f;`);
      assert(ok === true, `save edit failed: ${ok}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitScreen(page, 'title', 20000);
      await tap(page, /המשך קריירה/);
      const s = await waitScreen(page, ['weekend'], 10000).catch(() => screenOf(page));
      assert(s === 'weekend', `continue landed on ${s}`);
      const sv = await readSave(page);
      return `contract until s${sv?.contract?.end} (season ${sv?.season}), offers ${sv?.offers}`;
    });
    const before = await readSave(page);
    const from = log.season.toasts.length;
    let presses = 0;
    await step(S, '"לעונה הבאה" -> modal -> "המועדון יחליט" decides in one press', async () => {
      await tap(page, 'לעונה הבאה', { after: 400 });
      assert(await page.locator('.modal').isVisible().catch(() => false), 'no expired-contract modal');
      await shot(page, 'cd-modal');
      await page.locator('.modal').getByRole('button', { name: 'המועדון יחליט' }).click();
      presses++;
      const s = await waitScreen(page, ['week', 'event', 'contract'], 15000).catch(() => screenOf(page));
      await sleep(4500); // let the toast queue play out
      await shot(page, 'cd-after');
      const sv = await readSave(page);
      assert(s !== 'contract', 'opened a negotiation instead of deciding');
      assert(sv?.season === before.season + 1, `season ${before?.season} -> ${sv?.season}`);
      assert(sv?.contract?.end > before.season, `contract still ends s${sv?.contract?.end}`);
      return `${presses} press -> ${s}; ${before?.club} -> ${sv?.club}, ₪${sv?.contract?.wage}, ${sv?.contract?.role}, until s${sv?.contract?.end}`;
    });
    await step(S, 'the decision is shown: toast with club, wage, role, years (matches the save)', async () => {
      const tt = log.season.toasts.slice(from).filter((x) => x.page === 'club-decides').map((x) => x.t);
      const sv = await readSave(page);
      const news = await page.evaluate(() => new Promise((res) => {
        const r = indexedDB.open('football-career');
        r.onsuccess = () => { const g = r.result.transaction('saves', 'readonly').objectStore('saves').get('autosave'); g.onsuccess = () => { try { res((JSON.parse(g.result).world.news || []).slice(0, 8).map((n) => n.headline)); } catch { res([]); } }; };
        r.onerror = () => res([]);
      }));
      const coreLine = news.find((h) => /המועדון החליט|אף אחד לא סגר איתך/.test(h)) ?? null;
      const term = tt.map((x) => x.match(/המועדון החליט: (.+?), ₪([\d,]+) לחודש, ([^,]+), ל-?(.+?)(\. הקש לסגירה)?$/)).find(Boolean);
      const short = tt.find((x) => /אף אחד לא סגר איתך/.test(x));
      (log.clubDecidesTerms ||= []).push(`cd: toasts [${tt.join(' | ')}] news "${coreLine}"`);
      if (!term && !short) issue('club decides: no toast with the signed terms', `cd s${before.season}: toasts [${tt.join(' | ') || 'none'}]; engine news "${coreLine ?? 'none'}"`, 'week', await shot(page, 'cd-no-terms'));
      assert(term || short, `no terms toast after the decision (toasts: ${tt.join(' | ') || 'none'}; the engine's news line: "${coreLine ?? 'none'}")`);
      if (term) assert(term[1] === sv?.club && Number(term[2].replace(/,/g, '')) === sv?.contract?.wage, `toast "${term[0]}" vs save ${sv?.club} ₪${sv?.contract?.wage}`);
      return term ? term[0] : short;
    });
    errorsCheck(S, page);
  } finally {
    await ctx.close();
  }
}

function errorsCheck(S, page) {
  const errs = page.__errors.filter((e) => !e.external);
  record(S, 'no page/console errors', errs.length === 0, 0, errs.slice(0, 3).map((e) => `${e.kind}: ${e.text}`).join(' | '));
}

// ------------------------------------------------------------------ b+c+d+g. deterministic long career
async function scenarioCareer() {
  const S = 'b-season1';
  const { ctx, page } = await newPage(MOBILE, 'career', { seed: QA_SEED });
  const st = { S, label: 'det', pos: 'W', detailed: true, season: 0, week: -1, lastLabel: null, weeksSeen: 0, events: 0, matches: 0, played: 0, reloadAt: 6, reloadPlanAt: 7, retireAt: RETIRE_AT };
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await step(S, `new career (seed ${QA_SEED}, ${QA_NAME.first} ${QA_NAME.last})`, async () => {
      await startNewCareer(page, { audits: true, name: QA_NAME, pos: 'W' });
      const save = await readSave(page);
      return `${save?.club} (${save?.league}, ${save?.country}), age ${save?.age}, ${save?.pos}; new career ${log.perf.newCareer.slice(-1)[0]}ms`;
    });
    await checkWorldNames(page, S);
    // season 1 in detail
    let r = await playUntilBreak(page, st);
    const s1 = log.seasons.find((x) => x.run === 'det' && x.season === 1);
    record(S, `season 1 played to the end (${s1?.weeks} weeks)`, r === 'offseason', 0, `events ${st.events}, matches ${st.matches} (senior results ${s1?.seniorWE || 0}, youth results ${s1?.youthWE || 0}), weeks without a match ${s1?.noMatch}, moments played ${st.played}, quick-week landed on ${JSON.stringify(st.quickPaths)}`);
    const tables = log.season.tables.filter((t) => t.run === 'det' && t.season === 1);
    record(S, 'league table updates', tables.length >= 2 && tables.every((t, i, a) => i === 0 || t.played > a[i - 1].played || a[i - 1].played >= t.rows * (t.rows - 1) * legsFor(t.rows)), 0, tables.map((t) => `w${t.week}:${t.played}`).join(' '));
    const seen = new Map();
    for (const e of log.season.events.filter((e) => e.run === 'det')) seen.set(`${e.title}: ${e.body.slice(0, 40)}`, (seen.get(`${e.title}: ${e.body.slice(0, 40)}`) || 0) + 1);
    const rep = [...seen].filter(([, n]) => n > 1).map(([t, n]) => `${t} x${n}`);
    record(S, 'no event variant repeats in season 1', rep.length === 0, 0, rep.join(' | '));
    const evWeeks = new Set(log.season.events.filter((e) => e.run === 'det' && e.season === 1).map((e) => e.week)).size;
    log.notes.push(`det season 1: event weeks ${evWeeks}/${s1?.weeks} (silence ${(100 - (evWeeks / (s1?.weeks || 1)) * 100).toFixed(0)}%), weeks without a match ${s1?.noMatch}`);
    errorsCheck(S, page);
    if (r !== 'offseason') return;
    // long career, fast
    st.detailed = false;
    st.S = 'g-long-career';
    st.deadline = now() + LONG_MAX_MS;
    await settingsToggle(page, 'רגעי מפתח: המשחק מחליט', true).catch(() => {});
    await settingsToggle(page, 'תנועה מופחתת', true).catch(() => {});
    await waitScreen(page, ['weekend'], 5000).catch(() => {});
    let how = null;
    for (let k = 0; k < 30; k++) {
      await handleOffseason(page, st);
      r = await playUntilBreak(page, st);
      const sl = log.seasons[log.seasons.length - 1];
      record('g-long-career', `season ${st.season}: ${sl.club} (${sl.league}), age ${sl.age}`, r === 'offseason' || r === 'retire' || r === 'end', 0, `${sl.weeks} weeks, ${sl.seniorWE || 0} senior / ${sl.youthWE || 0} youth results, ${sl.noMatch} weeks without a match, ${sl.events} events, injured ${sl.injuredWeeks} weeks -> ${r}`);
      if (r === 'retire') {
        await retireViaUi(page, st);
        how = 'retired via UI';
        break;
      }
      if (r === 'end') {
        how = 'career ended by the engine';
        break;
      }
      if (r !== 'offseason') {
        record('g-long-career', 'reach retirement', false, 0, `stopped (${r}) in season ${st.season}, age ${(await readSave(page))?.age}`);
        break;
      }
    }
    if (how) await careerEndChecks(page, st, how);
    errorsCheck('g-long-career', page);
  } finally {
    await ctx.close();
  }
}

// e. ----------------------------------------------------------------- desktop + small phone smoke
async function scenarioViewport(name, { arcade = false, ...opts }) {
  const S = `e-${name}`;
  const { ctx, page } = await newPage(opts, name);
  const vst = { label: name, season: 1, week: 1, played: 0, pos: 'W' };
  try {
    await step(S, 'title -> week', async () => {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => document.fonts?.ready);
      await shot(page, `${name}-title`);
      await audit(page, `${name}:title`);
      await startNewCareer(page);
      await sleep(400);
      await shot(page, `${name}-week`);
      await audit(page, `${name}:week`);
    });
    if (name === 'desktop') {
      await step(S, 'side panel visible at 1366px', async () => {
        assert(await page.locator('.shell-row.has-side').isVisible(), 'no side panel (.has-side) at 1366px');
      });
    }
    await step(S, 'tabs render (table compact + full, more, settings, news, goals)', async () => {
      for (let i = 1; i < 5; i++) {
        await page.locator('.bottom-nav button').nth(i).click();
        await idle(page, 250);
        const s = await screenOf(page);
        await audit(page, `${name}:${s}`);
        await shot(page, `${name}-${s}`);
        if (s === 'table') {
          await checkTableUi(page, { label: name, season: 1 }, 1);
          await page.locator('.table-screen .table-toggle button').nth(1).click().catch(() => {});
          await sleep(150);
          await audit(page, `${name}:table-full`);
          await shot(page, `${name}-table-full`);
          await page.locator('.table-screen .table-toggle button').nth(0).click().catch(() => {});
        }
        if (s === 'more') {
          for (const [label, id] of [['הגדרות', 'settings'], ['חדשות', 'news'], ['מטרות', 'goals']]) {
            const b = page.getByRole('button', { name: label });
            if (await b.first().isVisible().catch(() => false)) {
              await b.first().click();
              await idle(page, 250);
              await audit(page, `${name}:${id}`);
              await shot(page, `${name}-${id}`);
              await backToTabs(page);
              await page.locator('.bottom-nav button').nth(4).click();
              await idle(page, 200);
            }
          }
        }
      }
      await page.locator('.bottom-nav button').nth(0).click();
      await idle(page);
      const iss = [...issues.values()].filter((x) => x.screen.startsWith(`${name}:`) && /overflow|tap target|table/.test(x.type));
      return iss.length ? `${iss.length} audit issue(s), see ui-audit` : 'clean';
    });
    await step(S, 'week -> match screens', async () => {
      await tap(page, 'שבוע מהיר');
      const end = now() + 60000;
      while (now() < end) {
        const s = await screenOf(page);
        if (s === 'event') {
          await audit(page, `${name}:event`);
          await shot(page, `${name}-event`);
          await page.locator('.option-btn').first().click();
          await closeOutcome(page);
          await idle(page);
        } else if (s === 'prematch') {
          await audit(page, `${name}:prematch`);
          await shot(page, `${name}-prematch`);
          await tap(page, page.locator('.prematch-screen .action-bar .btn-primary'));
        } else if (s === 'match') {
          if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) {
            await audit(page, `${name}:match`);
            await shot(page, `${name}-moment`);
            if (!vst.played) {
              const d = await playDecision(page, vst, { via: name === 'desktop' ? 'key' : 'click', doAudit: true, shotName: `${name}-decision` });
              vst.played++;
              if (d.r !== 'played') throw new Error(`decision moment: ${d.r}`);
              continue;
            }
            await tap(page, 'דלג לסוף המשחק');
          } else if (await page.locator('.ft-card').isVisible().catch(() => false)) {
            await tap(page, 'לסיכום השבוע');
          } else await sleep(150);
        } else if (s === 'weekend') {
          await sleep(1000);
          await audit(page, `${name}:weekend`);
          await shot(page, `${name}-weekend`);
          return;
        } else await sleep(150);
      }
      throw new Error('did not reach week end');
    });
    if (arcade) {
      await step(S, 'settings "ארקייד": key moment plays as the Pixi swipe game', async () => {
        if ((await screenOf(page)) === 'weekend') await tap(page, 'לשבוע הבא');
        await waitScreen(page, 'week');
        await page.locator('.bottom-nav button').nth(4).click();
        await idle(page);
        await page.getByRole('button', { name: /הגדרות/ }).first().click();
        await idle(page);
        await page.getByRole('button', { name: /ארקייד/ }).click();
        await shot(page, `${name}-settings-arcade`);
        await backToTabs(page);
        await page.locator('.bottom-nav button').nth(0).click();
        await idle(page);
        await tap(page, 'שבוע מהיר');
        const end = now() + 60000;
        while (now() < end) {
          const s = await screenOf(page);
          if (s === 'event') {
            await page.locator('.option-btn').first().click();
            await closeOutcome(page);
          await closeOutcome(page);
            await idle(page);
          } else if (s === 'match' && (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false))) break;
          else if (s === 'weekend') {
            await tap(page, 'לשבוע הבא');
            await tap(page, 'שבוע מהיר');
          } else await sleep(150);
        }
        const r = await playMomentByGesture(page);
        assert(r === 'played', `arcade moment: ${r}`);
        assert((await page.locator('.dm-root').count()) === 0, 'decision overlay shown in arcade mode');
        // back to the default
        await page.getByRole('button', { name: 'דלג לסוף המשחק' }).click().catch(() => {});
        return r;
      });
    }
    errorsCheck(S, page);
  } finally {
    await ctx.close();
  }
}

// f. ----------------------------------------------------------------- PWA / offline
async function scenarioPwa() {
  const S = 'f-pwa';
  const { ctx, page } = await newPage({ viewport: { width: 390, height: 844 }, locale: 'he-IL' }, 'pwa');
  try {
    await page.goto(URL, { waitUntil: 'load' });
    await step(S, 'manifest linked and valid', async () => {
      const href = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'));
      assert(href, 'no <link rel=manifest>');
      const m = await page.evaluate(async (h) => (await fetch(h)).json(), href);
      const problems = [];
      if (!m.name) problems.push('name missing');
      if (!m.short_name) problems.push('short_name missing');
      if (m.lang !== 'he') problems.push(`lang=${m.lang}`);
      if (m.dir !== 'rtl') problems.push(`dir=${m.dir}`);
      if (!['standalone', 'fullscreen'].includes(m.display)) problems.push(`display=${m.display}`);
      if (!m.icons?.length) problems.push('no icons');
      if (m.icons?.length && !m.icons.some((i) => /png/.test(i.type || i.src) && /(192|512)/.test(i.sizes || ''))) problems.push('no 192/512 PNG icon (only SVG: Chrome installability and iOS home-screen icon need PNG)');
      if (!m.start_url) problems.push('start_url missing (defaults to the page URL)');
      log.notes.push(`manifest: ${JSON.stringify(m)}`);
      const hard = problems.filter((p) => /name|lang|dir|display|no icons/.test(p) && !/PNG/.test(p));
      if (problems.length) log.notes.push(`manifest remarks: ${problems.join('; ')}`);
      assert(hard.length === 0, hard.join('; '));
      return `${m.name} / ${m.lang} / ${m.dir}${problems.length ? ` (remarks: ${problems.join('; ')})` : ''}`;
    });
    await step(S, 'html lang=he dir=rtl', async () => {
      const a = await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]);
      assert(a[0] === 'he' && a[1] === 'rtl', `html lang/dir = ${a}`);
    });
    await step(S, 'service worker registered', async () => {
      const r = await page.evaluate(
        () =>
          new Promise((res) => {
            if (!('serviceWorker' in navigator)) return res('unsupported');
            const t = setTimeout(async () => {
              const regs = await navigator.serviceWorker.getRegistrations();
              res(regs.length ? `registered (not ready): ${regs[0].scope}` : 'none');
            }, 15000);
            navigator.serviceWorker.ready.then((reg) => {
              clearTimeout(t);
              res(`ready: ${reg.scope} active=${!!reg.active}`);
            });
          }),
      );
      assert(String(r).startsWith('ready'), r);
      return r;
    });
    await step(S, 'offline reload renders title', async () => {
      await page.reload({ waitUntil: 'load' });
      await sleep(1000);
      await ctx.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitScreen(page, 'title', 10000);
      await shot(page, 'offline-title');
      return 'ok';
    });
    await step(S, 'offline: new career starts (worker + content cached)', async () => {
      await startNewCareer(page);
      await shot(page, 'offline-week');
      await ctx.setOffline(false);
      return 'ok';
    });
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ main
const pct = (arr, q) => {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
};
/** Checks computed from the whole run (performance, decision coverage, round-2 balance items). */
function derivedChecks() {
  const P = log.perf;
  const nc = P.newCareer || [];
  record('k-perf', 'new career: tap "צא לדרך" -> reveal', nc.length > 0 && pct(nc, 0.5) < 2500, 0, `n=${nc.length} median ${pct(nc, 0.5)}ms max ${Math.max(...nc)}ms`);
  const qw = P.quickWeek;
  record('k-perf', 'quick week: tap -> next screen', qw.length > 0 && pct(qw, 0.5) < 1000 && pct(qw, 0.95) < 2500, 0, `n=${qw.length} median ${pct(qw, 0.5)}ms p95 ${pct(qw, 0.95)}ms max ${Math.max(...qw)}ms`);
  const ns = P.nextSeason;
  record('k-perf', 'offseason -> next season', ns.length === 0 || pct(ns, 0.95) < 3000, 0, `n=${ns.length} median ${pct(ns, 0.5)}ms max ${ns.length ? Math.max(...ns) : '-'}ms`);
  const ct = P.continue;
  record('k-perf', 'continue after reload', ct.length === 0 || Math.max(...ct) < 1500, 0, `n=${ct.length} ${ct.join(', ')}ms`);
  const sb = P.saveBytes.filter((x) => x.run === 'det');
  const maxB = Math.max(0, ...sb.map((x) => x.bytes));
  record('k-perf', 'save size stays small over a career', maxB < 3_000_000, 0, `det: ${sb.filter((_, i) => i % 3 === 0).map((x) => `s${x.season} ${Math.round(x.bytes / 1024)}KB`).join(', ')}; max ${Math.round(maxB / 1024)} KB`);
  // decision moments per position
  for (const pos of ['W', 'CB', 'GK']) {
    const ds = log.decisions.filter((d) => d.pos === pos);
    if (!ds.length && !(process.env.E2E_ONLY || 'a,b,e,f').split(',').includes('a')) continue;
    const kinds = {};
    for (const d of ds) kinds[d.kind] = (kinds[d.kind] || 0) + 1;
    const stamps = {};
    for (const d of ds) stamps[d.stamp] = (stamps[d.stamp] || 0) + 1;
    const ok = ds.filter((d) => d.success).length;
    const hintOk = ds.filter((d) => d.hintPicked);
    record('j-decisions', `${pos}: decision moments played by card/key`, ds.length >= 3 && ds.every((d) => d.stamp), 0, `${ds.length} played, ${ok} succeeded (hint card picked ${hintOk.length}x, ${hintOk.filter((d) => d.success).length} ok); kinds ${JSON.stringify(kinds)}; stamps ${JSON.stringify(stamps)}; keys ${ds.filter((d) => d.via === 'key').length}`);
  }
  // toasts: the same text twice within 4s
  const dup = [];
  const t = log.season.toasts;
  for (let i = 1; i < t.length; i++) for (let j = i - 1; j >= 0 && t[i].at - t[j].at < 4000; j--) if (t[j].page === t[i].page && t[j].t === t[i].t) { dup.push(t[i].t); break; }
  log.toastDup = [...new Set(dup)];
  // rival loop
  const rival = log.season.weekends.filter((w) => w.loops.some((l) => /0 שערים העונה/.test(l))).length;
  log.notes.push(`UX-04 rival "0 שערים העונה" loops: ${rival}; toast duplicates: ${dup.length} (${log.toastDup.slice(0, 4).join(' | ')})`);
  // BUG-16: potential range vs overall (deterministic career)
  const cl = log.season.club.filter((c) => c.run === 'det' && c.pot && c.ovr);
  const pts = cl.map((c) => ({ age: c.saveAge, ovr: Number(c.ovr), lo: Number(String(c.pot).split('-')[0]), hi: Number(String(c.pot).split('-')[1]) }));
  const peak = Math.max(0, ...pts.map((p) => p.ovr));
  const late = pts.filter((p) => p.age >= 29);
  const off = late.filter((p) => p.lo > peak + 6);
  log.potential = pts.filter((_, i) => i % 2 === 0).map((p) => `${p.age}: ${p.ovr} (${p.lo}-${p.hi})`);
  if (pts.length || (process.env.E2E_ONLY || 'a,b,e,f').split(',').includes('b')) record('l-round2', 'BUG-16: scout potential range converges on the real level', pts.length > 0 && off.length === 0, 0, `peak ovr ${peak}; ${log.potential.slice(-6).join(', ')}`);
  // round 4 (QA): auto-answered events card, near goals moving, teen roles, club-decides terms, round labels
  const ae = log.autoEvents || [];
  const aeIssues = [...issues.values()].filter((i) => i.type.startsWith('auto-events'));
  record('m-round4', 'week end lists quick-week answers (.auto-events = report.autoEvents)', ae.some((x) => x.save > 0) && aeIssues.length === 0, 0, `${ae.filter((x) => x.save > 0).length} week ends with auto answers, ${ae.filter((x) => x.ui > 0).length} lists shown; ${aeIssues.map((i) => i.detail).slice(0, 2).join(' | ')}`);
  const tracks = Object.values(log.nearTrackRuns || {}).flatMap((o) => Object.values(o));
  const pairs = tracks.reduce((s, t) => s + t.pairs, 0), moved = tracks.reduce((s, t) => s + t.moved, 0);
  const stuck = [...issues.values()].filter((i) => i.type.startsWith('near goal stuck'));
  record('m-round4', 'near-goal attribute bars move between weeks', pairs > 0 && stuck.length === 0, 0, `${moved}/${pairs} consecutive week ends changed (${pairs ? Math.round((moved / pairs) * 100) : 0}%); stuck: ${stuck.map((i) => i.detail).slice(0, 2).join(' | ') || 'none'}`);
  const teen = log.teenOffers || [];
  record('m-round4', 'teen (<19) offers: no "star" role', !teen.some((x) => x.roles.includes('star')), 0, `${teen.length} week ends with offers to a teenager; roles ${JSON.stringify(teen.flatMap((x) => x.roles).reduce((m, r) => ((m[r] = (m[r] || 0) + 1), m), {}))}`);
  const terms = log.clubDecidesTerms || [];
  const noTerms = [...issues.values()].filter((i) => i.type.startsWith('club decides'));
  record('m-round4', '"המועדון יחליט" shows the signed terms', noTerms.length === 0, 0, `${terms.length} decisions: ${terms.slice(0, 3).join(' | ')}${noTerms.length ? ` ; problems: ${noTerms.map((i) => i.detail).join(' | ')}` : ''}`);
  const rl = log.roundLabels || [];
  record('m-round4', 'table "מחזור X מתוך Y" = real round count', rl.length > 0 && rl.every((x) => x.label.includes(`מתוך ${x.want}`)), 0, `${rl.length} table visits; leagues seen: ${[...new Set(rl.map((x) => `${x.rows} clubs -> ${x.want}`))].join(', ')}`);
  const caps = (log.long.national || []).slice(-1)[0] ?? 'no caps';
  log.notes.push(`BUG-20 national caps (det): ${caps}`);
}

function summary() {
  const rows = results.map((r) => [r.ok ? 'PASS' : 'FAIL', r.scenario, r.step, `${(r.ms / 1000).toFixed(1)}s`, r.detail]);
  const auditRows = [];
  const byType = new Map();
  for (const i of issues.values()) {
    if (!byType.has(i.type)) byType.set(i.type, []);
    byType.get(i.type).push(i);
  }
  for (const [type, list] of byType) {
    auditRows.push(['FAIL', 'ui-audit', type, '', `${list.length} distinct: ${list.slice(0, 3).map((x) => x.detail).join(' | ')}`]);
  }
  for (const t of ['placeholder/garbage text', 'english text', 'raw id in UI', 'horizontal overflow', 'tap target < 40px', 'em-dash in UI', 'action bar off-screen', 'BUG-13: toast covers UI', 'BUG-11: "1 + plural"', 'injury not shown on week screen', 'league table (phone-fit)', 'decision overlay overflows horizontally', 'decision card label clipped', 'page scrolls on phone'])
    if (!byType.has(t)) auditRows.push(['PASS', 'ui-audit', t, '', '']);
  const all = [...rows, ...auditRows];
  const w = [4, 16, 52, 7];
  console.log('\n================ E2E SUMMARY ================');
  for (const r of all) console.log(`${r[0].padEnd(w[0])} | ${r[1].padEnd(w[1])} | ${r[2].slice(0, w[2]).padEnd(w[2])} | ${r[3].padEnd(w[3])} | ${r[4].slice(0, 160)}`);
  const fails = all.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${all.length - fails} passed, ${fails} failed. Screenshots: ${path.relative(ROOT, SHOTS)}/`);
  if (log.firstKick) console.log(`First kick: ${log.firstKick.taps} taps, ${(log.firstKick.moment / 1000).toFixed(1)}s (title ${log.firstKick.title}ms, week ${log.firstKick.week}ms), path ${log.firstKick.path}`);
  if (log.outcomes) console.log(`Story outcomes: ${log.outcomes.shown} shown, ${log.outcomes.missing} missing, ${log.outcomes.empty} empty`);
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ results, issues: [...issues.values()], log }, null, 2));
  return fails;
}

let fails = 1;
process.on('SIGTERM', () => { try { derivedChecks(); } catch { /* ignore */ } fails = summary(); stopServer(); process.exit(1); });
try {
  await buildAndServe();
  const proxy = process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {};
  browser = await chromium.launch(proxy);
  const only = (process.env.E2E_ONLY || 'a,b,e,f,n').split(',');
  if (only.includes('a')) {
    await scenarioFirstKick(1, QA_SEED).catch((e) => record('a-first-kick', 'scenario crashed', false, 0, e.message));
    for (let i = 0; i < RANDOM_RUNS; i++) await scenarioFirstKick(i + 2, null, { continueSeasons: 2, pos: ['CB', 'GK', 'ST', 'FB'][i % 4] }).catch((e) => record(`a/h-random#${i + 2}`, 'scenario crashed', false, 0, e.message));
  }
  if (only.includes('b')) await scenarioCareer().catch((e) => record('b-career', 'scenario crashed', false, 0, e.stack?.split('\n').slice(0, 2).join(' ') ?? e.message));
  if (only.includes('e')) {
    await scenarioViewport('desktop', { viewport: { width: 1366, height: 860 }, locale: 'he-IL' }).catch((e) => record('e-desktop', 'scenario crashed', false, 0, e.message));
    await scenarioViewport('small', { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'he-IL' }).catch((e) => record('e-small', 'scenario crashed', false, 0, e.message));
    await scenarioViewport('p390', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'he-IL', arcade: true }).catch((e) => record('e-p390', 'scenario crashed', false, 0, e.message));
    await scenarioViewport('p430', { viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, locale: 'he-IL' }).catch((e) => record('e-p430', 'scenario crashed', false, 0, e.message));
  }
  if (only.includes('n')) await scenarioClubDecides().catch((e) => record('n-club-decides', 'scenario crashed', false, 0, e.message));
  if (only.includes('f')) await scenarioPwa().catch((e) => record('f-pwa', 'scenario crashed', false, 0, e.message));
} catch (e) {
  record('setup', 'fatal', false, 0, e.message);
} finally {
  try {
    derivedChecks();
  } catch (e) {
    record('setup', 'derived checks', false, 0, e.message);
  }
  fails = summary();
  await browser?.close().catch(() => {});
  stopServer();
}
process.exit(fails ? 1 : 0);
