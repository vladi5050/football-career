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
//   RANDOM_RUNS=2                     extra random-seed careers (first kick + 2 fast seasons)
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
const SHOTS = path.join(HERE, 'shots');
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
const log = { firstKick: null, seasons: [], long: {}, season: { weeks: [], events: [], weekends: [], matches: [], toasts: [], tables: [], club: [], negotiation: [] }, audits: {}, errors: [], notes: [] };

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
  await page.exposeFunction('__qaToast', (t) => log.season.toasts.push({ page: label, t }));
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
                const club = u && u.clubId != null ? (Array.isArray(w.clubs) ? w.clubs.find((c) => c && c.id === u.clubId) ?? w.clubs[u.clubId] : null) : null;
                const league = club ? w.leagues.find((l) => l.id === club.leagueId) : null;
                res({
                  week: w.season.week, season: w.season.number, totalWeeks: w.season.totalWeeks, phase: w.phase, money: w.career.money, absWeek: w.absWeek,
                  age: u?.age, clubId: u?.clubId, club: club?.name, league: league?.name, leagueTier: league?.tier, country: league?.country,
                  contract: u?.contract ? { end: u.contract.endSeason, wage: u.contract.monthlyWage, role: u.contract.role } : null,
                  injury: u?.injury ?? null, caps: w.career.nationalCaps, offers: w.career.offers?.length ?? 0, retired: !!w.career.retired,
                  armyStatus: w.career.life?.armyStatus, stage: w.career.life?.stage, neg: w.career.negotiation?.status === 'open' ? 'open' : (w.career.negotiation?.status ?? null),
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
    return { bad, english, rawIds, emDash, sw, iw, wide, small, barOff };
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
}

// ------------------------------------------------------------------ flows
async function startNewCareer(page, { audits = false, name = null } = {}) {
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
  await tap(page, 'צא לדרך', { timeout: 20000 });
  taps++;
  // the week screen can flash for a frame before the reveal route is pushed: wait for a stable screen
  await waitScreen(page, ['reveal', 'week'], 30000);
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
  await nav.nth(0).click();
  await idle(page);
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
    await tap(page, 'שבוע מהיר');
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
  await idle(page, 250);
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
        goals: [...document.querySelectorAll('.feed-row')].filter((r) => /שער!/.test(r.textContent)).length,
      }));
      const nums = (sb.score.match(/\d+/g) || []).map(Number);
      if (nums.length === 2 && nums[0] + nums[1] !== sb.goals) issue('scorebug disagrees with goals in the feed', `${st.label} s${st.season}w${st.week}: scorebug ${nums.join('-')}, feed goals ${sb.goals}`, 'match', await shot(page, `scorebug-s${st.season}w${st.week}`));
      if (firstMoment && playThis) {
        firstMoment = false;
        if (st.played < 2) await shot(page, `moment-s${st.season}w${st.week}`);
        const r = await playMomentByGesture(page);
        st.played++;
        if (r !== 'played') issue('key moment did not resolve by itself', r, 'match', await shot(page, 'moment-stuck'));
        if (st.played <= 2) await shot(page, `after-moment-s${st.season}w${st.week}`);
        continue;
      }
      firstMoment = false;
      await tap(page, 'סמלץ את המשחק');
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
    const m = n.frac.match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) continue;
    const [a, b] = [Number(m[1]), Number(m[2])];
    const want = b ? (a / b) * 100 : 0;
    if (b && Math.abs(want - n.bar) > 25) issue('near-goal bar fill disagrees with its numbers', `"${n.text}" ${a}/${b} bar ${n.bar}%`, 'weekend', await shot(page, 'near-bar'));
    const nums = (n.text.match(/\d+/g) || []).map(Number).filter((x) => x !== b - a);
    if (nums.length >= 1 && !nums.includes(b)) issue('near-goal text and counter use different units', `"${n.text}" vs ${a}/${b}`, 'weekend', await shot(page, 'near-units'));
  }
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
      await shot(page, `${tag}-table-after`, true);
      await nav.nth(0).click();
      await idle(page);
    }
    log.long.transfers = (log.long.transfers || []).concat(`${st.label} s${st.season} ${when}: ${before?.club} (${before?.league}) -> ${save.club} (${save.league}), wage ${save.contract?.wage}`);
    assert(problems.length === 0, `moved to ${save.club} but ${problems.join(', ')}`);
    return `${before?.club} -> ${save.club} (${save.league})`;
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
  const before = await readSave(page);
  sl.offseason = { contractEnd: before?.contract?.end, offers: before?.offers, wage: before?.contract?.wage };
  await audit(page, 'offseason');
  await shot(page, `${st.label}-s${sn}-offseason`, true);
  const expired = before?.contract ? before.contract.end <= sn : false;
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
  if (sn >= 2 && !st.transferDone) await tryTransfer(page, st, 'offseason').catch((e) => record(S, `s${sn}: transfer`, false, 0, e.message));
  if (!st.negDone || expired) {
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
      if ((await screenOf(page)) !== 'contract') return `talks closed: ${rounds}`;
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
    await tap(page, 'לעונה הבאה', { after: 400 });
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
      for (let k = 0; k < 8; k++) {
        if (await page.locator('.modal').isVisible().catch(() => false)) {
          await page.locator('.modal').getByRole('button', { name: 'המועדון יחליט' }).click();
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
      st.clubDecides = (st.clubDecides || []).concat(`s${sn}: ${detail}`);
      log.notes.push(`${st.label} club-decides s${sn}: ${detail}`);
    } else if (nowExpired) issue('expired contract but no "המועדון יחליט" modal', `${st.label} s${sn}`, 'weekend', await shot(page, `s${sn}-no-modal`));
    const s = await waitScreen(page, ['week', 'event', 'contract', 'end'], 15000);
    const after = await readSave(page);
    const tl = log.season.toasts.slice(-4).map((t) => t.t).join(' | ');
    if (after && before && after.club !== before.club && !/negotiated/.test(detail) && !st.transferJustSigned) issue('club changed at season start without the user signing', `${before.club} -> ${after.club}`, 'week', await shot(page, `s${sn}-auto-move`));
    if (s === 'week') await checkClubConsistency(page, st, after, `season ${sn + 1} start`);
    return `${detail}-> ${s}; club ${before?.club} -> ${after?.club}, contract until s${after?.contract?.end}, age ${after?.age}; toasts: ${tl}`;
  });
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
    assert(problems.length === 0, problems.join('; '));
    return `${info.w}x${info.h}, stats ${info.stats.join('/')}, ${info.timeline.length} seasons, trophies ${info.trophies.length}, reason "${info.reason}"`;
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
async function scenarioFirstKick(run, seed, { continueSeasons = 0 } = {}) {
  const tag = seed === QA_SEED ? 'fixed' : 'random';
  const S = `a-first-kick#${run}-${tag}`;
  const { ctx, page } = await newPage(MOBILE, `first-kick-${run}`, { seed: seed === QA_SEED ? seed : null });
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
      taps += await startNewCareer(page, { name: seed === QA_SEED ? QA_NAME : null });
      marks.week = now() - t0;
      const save = await readSave(page);
      marks.start = `${save?.club} (${save?.league}), age ${save?.age}`;
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
    await step(S, 'first match has >= 3 key moments (PRD §5.5)', async () => {
      let count = 1;
      for (let i = 0; i < 8; i++) {
        if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) {
          await page.locator('.moment-card .btn-ghost').click();
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
      return `${count} moments`;
    });
    if (continueSeasons > 0) {
      // random-seed careers: 2 fast seasons to exercise offseason transitions on unknown worlds
      const st = { S: `h-random#${run}`, label: `rnd${run}`, detailed: false, season: 1, week: -1, lastLabel: null, weeksSeen: 0, events: 0, matches: 0, played: 0, deadline: now() + 12 * 60000 };
      if ((await screenOf(page)) === 'match') {
        const ft = page.getByRole('button', { name: 'לסיכום השבוע' });
        const sim = page.getByRole('button', { name: 'סמלץ את המשחק' });
        if (await sim.isEnabled().catch(() => false)) await sim.click().catch(() => {});
        await ft.waitFor({ timeout: 20000 }).catch(() => {});
        await ft.click().catch(() => {});
        await idle(page);
      }
      st.lastLabel = null;
      newSeasonLog(st, await readSave(page));
      await settingsToggle(page, 'סמלץ רגעי מפתח', true).catch(() => {});
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

function errorsCheck(S, page) {
  const errs = page.__errors.filter((e) => !e.external);
  record(S, 'no page/console errors', errs.length === 0, 0, errs.slice(0, 3).map((e) => `${e.kind}: ${e.text}`).join(' | '));
}

// ------------------------------------------------------------------ b+c+d+g. deterministic long career
async function scenarioCareer() {
  const S = 'b-season1';
  const { ctx, page } = await newPage(MOBILE, 'career', { seed: QA_SEED });
  const st = { S, label: 'det', detailed: true, season: 0, week: -1, lastLabel: null, weeksSeen: 0, events: 0, matches: 0, played: 0, reloadAt: 6, reloadPlanAt: 7, retireAt: RETIRE_AT };
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await step(S, `new career (seed ${QA_SEED}, ${QA_NAME.first} ${QA_NAME.last})`, async () => {
      await startNewCareer(page, { audits: true, name: QA_NAME });
      const save = await readSave(page);
      return `${save?.club} (${save?.league}, ${save?.country}), age ${save?.age}`;
    });
    // season 1 in detail
    let r = await playUntilBreak(page, st);
    const s1 = log.seasons.find((x) => x.run === 'det' && x.season === 1);
    record(S, `season 1 played to the end (${s1?.weeks} weeks)`, r === 'offseason', 0, `events ${st.events}, matches ${st.matches} (senior results ${s1?.seniorWE || 0}, youth results ${s1?.youthWE || 0}), weeks without a match ${s1?.noMatch}, moments played ${st.played}, quick-week landed on ${JSON.stringify(st.quickPaths)}`);
    const tables = log.season.tables.filter((t) => t.run === 'det' && t.season === 1);
    record(S, 'league table updates', tables.length >= 2 && tables.every((t, i, a) => i === 0 || t.played > a[i - 1].played || a[i - 1].played >= t.rows * (t.rows - 1)), 0, tables.map((t) => `w${t.week}:${t.played}`).join(' '));
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
    await settingsToggle(page, 'סמלץ רגעי מפתח', true).catch(() => {});
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
async function scenarioViewport(name, opts) {
  const S = `e-${name}`;
  const { ctx, page } = await newPage(opts, name);
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
    await step(S, 'tabs render', async () => {
      for (let i = 1; i < 5; i++) {
        await page.locator('.bottom-nav button').nth(i).click();
        await idle(page, 250);
        const s = await screenOf(page);
        await audit(page, `${name}:${s}`);
        await shot(page, `${name}-${s}`);
      }
      await page.locator('.bottom-nav button').nth(0).click();
      await idle(page);
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
          await idle(page);
        } else if (s === 'prematch') {
          await audit(page, `${name}:prematch`);
          await shot(page, `${name}-prematch`);
          await tap(page, page.locator('.prematch-screen .action-bar .btn-primary'));
        } else if (s === 'match') {
          if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) {
            await audit(page, `${name}:match`);
            await shot(page, `${name}-moment`);
            await tap(page, 'סמלץ את המשחק');
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
  for (const t of ['placeholder/garbage text', 'english text', 'raw id in UI', 'horizontal overflow', 'tap target < 40px', 'em-dash in UI', 'action bar off-screen'])
    if (!byType.has(t)) auditRows.push(['PASS', 'ui-audit', t, '', '']);
  const all = [...rows, ...auditRows];
  const w = [4, 16, 52, 7];
  console.log('\n================ E2E SUMMARY ================');
  for (const r of all) console.log(`${r[0].padEnd(w[0])} | ${r[1].padEnd(w[1])} | ${r[2].slice(0, w[2]).padEnd(w[2])} | ${r[3].padEnd(w[3])} | ${r[4].slice(0, 160)}`);
  const fails = all.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${all.length - fails} passed, ${fails} failed. Screenshots: ${path.relative(ROOT, SHOTS)}/`);
  if (log.firstKick) console.log(`First kick: ${log.firstKick.taps} taps, ${(log.firstKick.moment / 1000).toFixed(1)}s (title ${log.firstKick.title}ms, week ${log.firstKick.week}ms), path ${log.firstKick.path}`);
  fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ results, issues: [...issues.values()], log }, null, 2));
  return fails;
}

let fails = 1;
try {
  await buildAndServe();
  const proxy = process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } } : {};
  browser = await chromium.launch(proxy);
  const only = (process.env.E2E_ONLY || 'a,b,e,f').split(',');
  if (only.includes('a')) {
    await scenarioFirstKick(1, QA_SEED).catch((e) => record('a-first-kick', 'scenario crashed', false, 0, e.message));
    for (let i = 0; i < RANDOM_RUNS; i++) await scenarioFirstKick(i + 2, null, { continueSeasons: 2 }).catch((e) => record(`a/h-random#${i + 2}`, 'scenario crashed', false, 0, e.message));
  }
  if (only.includes('b')) await scenarioCareer().catch((e) => record('b-career', 'scenario crashed', false, 0, e.stack?.split('\n').slice(0, 2).join(' ') ?? e.message));
  if (only.includes('e')) {
    await scenarioViewport('desktop', { viewport: { width: 1366, height: 860 }, locale: 'he-IL' }).catch((e) => record('e-desktop', 'scenario crashed', false, 0, e.message));
    await scenarioViewport('small', { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'he-IL' }).catch((e) => record('e-small', 'scenario crashed', false, 0, e.message));
  }
  if (only.includes('f')) await scenarioPwa().catch((e) => record('f-pwa', 'scenario crashed', false, 0, e.message));
} catch (e) {
  record('setup', 'fatal', false, 0, e.message);
} finally {
  fails = summary();
  await browser?.close().catch(() => {});
  stopServer();
}
process.exit(fails ? 1 : 0);
