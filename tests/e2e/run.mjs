// End-to-end QA run for the REAL engine (no ?mock).
// Builds (npx vite build), serves (npx vite preview --port 4173) and drives the app with Playwright.
//
//   npm run test:e2e                  full run
//   SKIP_BUILD=1 npm run test:e2e     reuse dist/
//   E2E_URL=http://host:port/ ...     use an already running server (no build, no preview)
//   SEASON_MAX_WEEKS=60               safety cap for the season loop
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
fs.mkdirSync(SHOTS, { recursive: true });
for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png')) fs.unlinkSync(path.join(SHOTS, f));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ------------------------------------------------------------------ results
/** @type {{scenario:string, step:string, ok:boolean, ms:number, detail:string}[]} */
const results = [];
const log = { firstKick: null, season: { weeks: [], events: [], weekends: [], matches: [], toasts: [], tables: [], club: [], negotiation: [] }, audits: {}, errors: [], notes: [] };

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

async function newPage(opts = MOBILE, label = 'page') {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opts });
  const page = await ctx.newPage();
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
                res({ week: w.season.week, season: w.season.number, phase: w.phase, money: w.career.money, absWeek: w.absWeek });
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
async function startNewCareer(page, { audits = false } = {}) {
  let taps = 0;
  await waitScreen(page, ['title']);
  if (audits) await audit(page, 'title');
  await tap(page, 'קריירה חדשה');
  taps++;
  await waitScreen(page, 'new');
  if (audits) await audit(page, 'new');
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

// a. ---------------------------------------------------------------- first kick
async function scenarioFirstKick(run = 1) {
  const { ctx, page } = await newPage(MOBILE, `first-kick-${run}`);
  const S = `a-first-kick#${run}`;
  try {
    let taps = 0;
    const t0 = now();
    const marks = {};
    await step(S, 'open page -> title', async () => {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await waitScreen(page, 'title', 20000);
      marks.title = now() - t0;
      return `${marks.title}ms`;
    });
    await step(S, 'title -> new career -> reveal -> week', async () => {
      taps += await startNewCareer(page);
      marks.week = now() - t0;
      return `${taps} taps, ${marks.week}ms`;
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
          await shot(page, 'first-kick-prematch');
          await tap(page, 'צא למגרש');
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
      await shot(page, 'first-kick-moment');
      log.firstKick = marks;
      (log.firstKicks ||= []).push(marks);
      assert(marks.moment < 60000, `first key moment after ${marks.moment}ms (>60s)`);
      return `${taps} taps, ${(marks.moment / 1000).toFixed(1)}s total, path ${marks.path}, lineup "${marks.lineup}", moment at ${marks.momentMinute}`;
    });
    await step(S, 'PRD: quick week skips pre-match', async () => {
      assert(!(marks.path || '').includes('prematch'), `quick week went through pre-match (${marks.path}); PRD §7 says it skips pre-match`);
    });
    await step(S, 'PRD: first match has 3 key moments', async () => {
      const n = await page.evaluate(() => document.querySelectorAll('.moment-card').length);
      // count moments by playing through with "סמלץ" (skip) per moment
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
      log.firstKick.momentsInFirstMatch = count;
      void n;
      assert(count >= 3, `first match had ${count} key moment(s); PRD §5.5 says 3 (pre-match: "${marks.lineup}", first moment at ${marks.momentMinute}, feed: ${marks.feed})`);
      return `${count} moments`;
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

// b + c + d. --------------------------------------------------------- one full season
async function scenarioSeason() {
  const { ctx, page } = await newPage(MOBILE, 'season');
  const S = 'b-season';
  const st = { week: -1, season: 1, weeksSeen: 0, events: 0, matches: 0, played: 0, quick: 0, planned: 0, unknown: 0, offseason: false, tableP: -1, reloaded: false };
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await step(S, 'new career', async () => {
      await startNewCareer(page, { audits: true });
      const club = await page.locator('.week-screen .tb-title').textContent();
      st.club = club;
      return club;
    });
    let lastWeekLabel = null;
    let weekAdvanceFails = [];
    let guard = 0;
    const seq = [];
    while (guard++ < MAX_WEEKS * 12 && !st.offseason) {
      const s = await screenOf(page);
      seq.push(s);
      if (!['week', 'event', 'prematch', 'match', 'weekend', 'contract', 'end'].includes(s)) {
        st.unknown++;
        issue('unexpected screen in season loop', s, s, await shot(page, `unknown-${s}`));
        if (st.unknown > 5) throw new Error(`stuck on ${s}`);
        await sleep(500);
        continue;
      }
      try {
        if (s === 'week') {
          await audit(page, 'week');
          const label = (await page.locator('.week-screen .tb-sub').textContent()).trim();
          const m = label.match(/עונה (\d+) · שבוע (\d+)/);
          const wk = m ? Number(m[2]) : NaN;
          if (lastWeekLabel !== label) {
            st.weeksSeen++;
            if (st.week >= 0 && wk !== st.week + 1) weekAdvanceFails.push(`${st.week}->${wk}`);
            st.week = wk;
            lastWeekLabel = label;
            const money = (await page.locator('.week-screen .money').textContent().catch(() => '')).trim();
            const fit = (await page.locator('.week-screen .meter-val').first().textContent().catch(() => '')).trim();
            log.season.weeks.push({ label, money, fitness: fit });
            if (!/^₪[\d,.]+[KM]?$/.test(money.replace(/‏|‎/g, ''))) issue('money format', `week ${wk}: "${money}"`, 'week', await shot(page, 'money'));
            if (st.weeksSeen === 1 || wk % 6 === 0) await shot(page, `week-${wk}`);
            if (wk % 4 === 1) await visitTabs(page, st, wk);
            // d. save/continue: reload mid-season on the plan screen
            if (wk === 6 && !st.reloaded) {
              st.reloaded = true;
              await scenarioReload(page, label);
              continue;
            }
          }
          // alternate quick week / manual plan
          if (wk % 2 === 0) {
            st.quick++;
            await tap(page, 'שבוע מהיר');
          } else {
            st.planned++;
            const closeBtn = page.getByRole('button', { name: 'סגור את השבוע' });
            if (!(await closeBtn.isVisible().catch(() => false)) || !(await closeBtn.isEnabled())) {
              // clear and place 3 magnets (tap-to-place)
              const days = page.locator('.day.filled');
              while ((await days.count()) > 0) {
                await days.first().click();
                await sleep(60);
              }
              const items = page.locator('.tray-item');
              const pickIdx = [wk % 4, 4, (wk + 1) % 6];
              for (const i of pickIdx) {
                await items.nth(i).click();
                await sleep(80);
              }
            }
            await tap(page, 'סגור את השבוע');
          }
        } else if (s === 'event') {
          await audit(page, 'event');
          const ev = await page.evaluate(() => ({
            title: document.querySelector('.event-title')?.textContent ?? '',
            body: document.querySelector('.event-body')?.textContent ?? '',
            because: document.querySelector('.because')?.textContent ?? null,
            category: document.querySelector('.event-top .chip')?.textContent ?? '',
            who: document.querySelector('.ew-name')?.textContent ?? null,
            options: [...document.querySelectorAll('.option-btn')].map((b) => b.textContent),
          }));
          ev.week = st.week;
          log.season.events.push(ev);
          if (st.events < 3 || st.events % 5 === 0) await shot(page, `event-w${st.week}`);
          if (ev.body.length > 220) issue('event body > 220 chars', `${ev.title} (${ev.body.length})`, 'event', await shot(page, 'event-long'));
          if (ev.options.length < 2 || ev.options.length > 4) issue('event option count', `${ev.title}: ${ev.options.length}`, 'event', await shot(page, 'event-opts'));
          const n = await page.locator('.option-btn').count();
          await page.locator('.option-btn').nth(st.events % Math.max(1, n)).click();
          st.events++;
          await idle(page, 250);
        } else if (s === 'prematch') {
          await audit(page, 'prematch');
          st.lineup = (await page.locator('.lineup-status').textContent().catch(() => '')).trim();
          if (st.matches < 2) await shot(page, `prematch-w${st.week}`);
          await tap(page, 'צא למגרש');
        } else if (s === 'match') {
          await handleMatch(page, st);
        } else if (s === 'weekend') {
          await sleep(1200); // count-ups
          await audit(page, 'weekend');
          const we = await page.evaluate(() => ({
            headline: document.querySelector('.np-headline')?.textContent ?? null,
            score: document.querySelector('.rc-score')?.textContent ?? null,
            rating: document.querySelector('.stamp-big')?.textContent ?? null,
            gains: [...document.querySelectorAll('.gain-row')].map((r) => r.textContent),
            near: [...document.querySelectorAll('.near-list .paper')].map((r) => r.textContent),
            meanwhile: [...document.querySelectorAll('.meanwhile li')].map((r) => r.textContent),
            loops: [...document.querySelectorAll('.loops li')].map((r) => r.textContent),
            button: document.querySelector('.weekend-screen .action-bar .btn')?.textContent ?? '',
          }));
          we.week = st.week;
          log.season.weekends.push(we);
          if (we.rating && !(Number(we.rating) >= 1 && Number(we.rating) <= 10)) issue('rating out of range', `week ${st.week}: ${we.rating}`, 'weekend', await shot(page, 'rating'));
          if (we.loops.length < 1) issue('week end without open loop (PRD §4)', `week ${st.week}`, 'weekend', await shot(page, `weekend-noloop-w${st.week}`));
          if (we.loops.length > 3) issue('more than 3 open loops', `week ${st.week}`, 'weekend', null);
          if (we.near.length > 2) issue('more than 2 near-goal bars', `week ${st.week}: ${we.near.length}`, 'weekend', null);
          if (st.weeksSeen <= 2 || st.week % 6 === 0) await shot(page, `weekend-w${st.week}`, true);
          if (/לעונה הבאה/.test(we.button)) {
            st.offseason = true;
            await shot(page, 'offseason-weekend', true);
            break;
          }
          await tap(page, 'לשבוע הבא', { after: 300 });
        } else if (s === 'contract') {
          await audit(page, 'contract');
          await shot(page, `contract-midseason-w${st.week}`, true);
          log.notes.push(`negotiation opened mid-season at week ${st.week}`);
          await tap(page, /לחתום/);
        } else if (s === 'end') {
          throw new Error('career ended during first season');
        }
      } catch (e) {
        issue('season loop error', `${s} week ${st.week}: ${e.message.split('\n')[0]}`, s, await shot(page, `loop-error-${s}`));
        await sleep(500);
      }
    }
    log.season.sequenceTail = seq.slice(-30);
    record(S, `season played to the end (${st.weeksSeen} weeks)`, st.offseason, 0, `events ${st.events}, matches ${st.matches}, moments played ${st.played}, quick ${st.quick}, planned ${st.planned}`);
    record(S, 'week counter advances by 1', weekAdvanceFails.length === 0, 0, weekAdvanceFails.join(', '));
    // played grows every visit until the user's league is finished (rows*(rows-1) appearances)
    const tablesOk = log.season.tables.length >= 2 && log.season.tables.every((t, i, a) => i === 0 || t.played > a[i - 1].played || a[i - 1].played >= t.rows * (t.rows - 1));
    const lastLeagueWeek = log.season.weekends.filter((w) => w.score).map((w) => w.week).pop();
    log.notes.push(`user league fixtures end at week ${lastLeagueWeek}, season has ${st.weeksSeen} weeks`);
    record(S, 'league table updates', tablesOk, 0, log.season.tables.map((t) => `w${t.week}:${t.played}`).join(' '));
    const repeated = repeatedEvents();
    record(S, 'no event variant repeats in the season', repeated.length === 0, 0, repeated.join(' | '));
    const silence = st.weeksSeen ? 1 - new Set(log.season.events.map((e) => e.week)).size / st.weeksSeen : 0;
    log.notes.push(`event weeks ${new Set(log.season.events.map((e) => e.week)).size}/${st.weeksSeen}, silence share ${(silence * 100).toFixed(0)}%`);
    errorsCheck(S, page);

    if (st.offseason) await scenarioOffseason(page);
  } finally {
    await ctx.close();
  }
}

function repeatedEvents() {
  // PRD §4: the same variant text never appears twice in a career (title + body)
  const seen = new Map();
  for (const e of log.season.events) seen.set(`${e.title}: ${e.body.slice(0, 40)}`, (seen.get(`${e.title}: ${e.body.slice(0, 40)}`) || 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([t, n]) => `${t} x${n}`);
}

async function handleMatch(page, st) {
  const t0 = now();
  st.matches++;
  let firstMoment = true;
  const playThis = st.matches % 3 === 1; // play the first moment of every 3rd match
  let shotFt = false;
  // pre-match promise vs what the match actually did
  await sleep(400);
  const opening = await page.evaluate(() => (document.querySelector('.pitch-ticker')?.textContent ?? '') + ' / ' + [...document.querySelectorAll('.feed-row')].map((r) => r.textContent).join(' / '));
  const benchInMatch = /על הספסל|מהספסל|בנוער/.test(opening);
  const startedInMatch = /אתה על הדשא/.test(opening);
  const quickSkipped = !st.lineup;
  if (!quickSkipped) {
    const promisedStart = /פותח/.test(st.lineup);
    if ((promisedStart && benchInMatch) || (!promisedStart && startedInMatch))
      issue('pre-match lineup contradicts match', `week ${st.week}: pre-match "${st.lineup}", match "${opening.slice(0, 80)}"`, 'prematch', await shot(page, `lineup-mismatch-w${st.week}`));
  }
  log.season.matches.push({ week: st.week, lineup: st.lineup || '(quick)', opening: opening.slice(0, 120) });
  st.lineup = null;
  while (now() - t0 < 120000) {
    if ((await screenOf(page)) !== 'match') return;
    if (await page.locator('.ft-card').isVisible().catch(() => false)) {
      await sleep(300);
      const score = await page.locator('.ft-card .mc-title').textContent().catch(() => '');
      Object.assign(log.season.matches[log.season.matches.length - 1], { score, ms: now() - t0 });
      if (!/^\d+-\d+$/.test((score || '').trim())) issue('full-time score format', `"${score}"`, 'match', await shot(page, 'ft-score'));
      else {
        const [a, b] = score.split('-').map(Number);
        if (a + b > 9) issue('unrealistic score', score, 'match', await shot(page, 'ft-score-high'));
      }
      if (!shotFt && st.matches <= 3) {
        shotFt = true;
        await audit(page, 'match-fulltime');
        await shot(page, `match-ft-w${st.week}`);
      }
      await tap(page, 'לסיכום השבוע', { after: 300 });
      return;
    }
    if (await page.locator('.moment-card:not(.ft-card)').isVisible().catch(() => false)) {
      await audit(page, 'match-moment');
      if (firstMoment && playThis) {
        firstMoment = false;
        if (st.played < 2) await shot(page, `moment-w${st.week}`);
        const r = await playMomentByGesture(page);
        st.played++;
        if (r !== 'played') issue('key moment did not resolve by itself', r, 'match', await shot(page, 'moment-stuck'));
        if (st.played <= 2) await shot(page, `after-moment-w${st.week}`);
        continue;
      }
      firstMoment = false;
      await tap(page, 'סמלץ את המשחק');
      continue;
    }
    await sleep(150);
  }
  issue('match did not reach full time in 120s', `week ${st.week}`, 'match', await shot(page, 'match-stuck'));
  throw new Error('match timeout');
}

async function visitTabs(page, st, wk) {
  const nav = page.locator('.bottom-nav button');
  // table
  await nav.nth(1).click();
  await idle(page);
  await waitScreen(page, 'table');
  await audit(page, 'table');
  const t = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.table-screen .ltable tbody tr')];
    const played = rows.reduce((s, r) => s + Number(r.querySelectorAll('td')[2]?.textContent || 0), 0);
    return { rows: rows.length, played, me: !!document.querySelector('.table-screen tr.me'), pts: rows.map((r) => r.querySelector('.c-pts')?.textContent) };
  });
  log.season.tables.push({ week: wk, ...t });
  if (!t.me) issue('user club not highlighted in table', `week ${wk}`, 'table', await shot(page, 'table-nome'));
  if (wk === 1 || wk % 8 === 1) await shot(page, `table-w${wk}`, true);
  // club
  await nav.nth(2).click();
  await idle(page);
  await waitScreen(page, 'club');
  await audit(page, 'club');
  const c = await page.evaluate(() => ({
    ovr: document.querySelector('.me-ovr .display')?.textContent,
    attrs: [...document.querySelectorAll('.club-screen .attr-val')].map((e) => e.textContent),
    wage: document.querySelector('.contract-strip b')?.textContent,
    pot: document.querySelector('.me-pot b')?.textContent,
  }));
  log.season.club.push({ week: wk, ...c });
  const nums = [c.ovr, ...c.attrs].map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 1 || n > 99)) issue('attribute/overall out of 1..99', `week ${wk}: ${nums.join(',')}`, 'club', await shot(page, 'club-attr'));
  if (wk === 1 || wk % 8 === 1) await shot(page, `club-w${wk}`, true);
  // agent
  await nav.nth(3).click();
  await idle(page);
  await waitScreen(page, 'agent');
  await audit(page, 'agent');
  if (wk === 1 || wk % 8 === 1) await shot(page, `agent-w${wk}`, true);
  // more + news + goals (first visit only)
  if (wk === 1 || wk === 13) {
    await nav.nth(4).click();
    await idle(page);
    await audit(page, 'more');
    for (const [name, id] of [['חדשות', 'news'], ['מטרות', 'goals']]) {
      const b = page.getByRole('button', { name });
      if (await b.first().isVisible().catch(() => false)) {
        await b.first().click();
        await idle(page);
        await audit(page, id);
        await shot(page, `${id}-w${wk}`, true);
        await page.goBack();
        await idle(page);
      }
    }
  }
  await nav.nth(0).click();
  await idle(page);
  await waitScreen(page, 'week');
}

// d. ----------------------------------------------------------------- reload / continue
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
  // reload during an unfinished week: is progress (plan + event answer) kept? PRD principle 6: autosave after every screen
  await step(S, 'reload mid-week (after closing the plan) keeps the phase', async () => {
    await tap(page, 'שבוע מהיר');
    await idle(page, 300);
    const mid = await screenOf(page);
    if (mid === 'week') return 'still on week';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitScreen(page, 'title', 20000);
    await tap(page, /המשך קריירה/);
    await sleep(800);
    const back = await screenOf(page);
    await shot(page, 'reload-midweek-continued');
    assert(back === mid || (mid === 'match' && back === 'prematch'), `was on "${mid}" before reload, continue landed on "${back}" (progress lost)`);
    return `${mid} -> ${back}`;
  });
}

// c. ----------------------------------------------------------------- offseason + negotiation
async function scenarioOffseason(page) {
  const S = 'c-offseason';
  await audit(page, 'offseason');
  await step(S, 'offseason: offers reachable before next season', async () => {
    await page.evaluate(() => (location.hash = '#/agent'));
    await sleep(500);
    const s = await screenOf(page);
    await page.evaluate(() => history.back());
    await sleep(300);
    assert(s === 'agent', `on offseason screen the agent/offers tab is unreachable (hash #/agent shows "${s}", no bottom nav)`);
  });
  await step(S, 'go to next season', async () => {
    await waitScreen(page, 'weekend');
    await tap(page, 'לעונה הבאה', { after: 500 });
    const s = await waitScreen(page, ['week', 'event', 'contract'], 15000);
    await shot(page, `season2-${s}`);
    if (s === 'week') return (await page.locator('.week-screen .tb-sub').textContent()).trim();
    return s;
  });
  const toastsSeen = log.season.toasts.slice(-8).map((t) => t.t);
  log.notes.push(`toasts at season change: ${toastsSeen.join(' | ')}`);
  let opened = false;
  await step(S, 'open negotiation (offer or renewal)', async () => {
    if ((await screenOf(page)) === 'contract') {
      opened = true;
      return 'already in negotiation';
    }
    if ((await screenOf(page)) !== 'week') throw new Error(`not on week (${await screenOf(page)})`);
    await page.locator('.bottom-nav button').nth(3).click();
    await idle(page);
    await waitScreen(page, 'agent');
    await shot(page, 'season2-agent', true);
    const neg = page.getByRole('button', { name: 'לשבת למשא ומתן' });
    let via = 'offer';
    if (await neg.first().isVisible().catch(() => false)) await neg.first().click();
    else {
      via = 'renewal';
      await page.getByRole('button', { name: 'לבקש חוזה חדש' }).click();
    }
    await idle(page, 400);
    const s = await screenOf(page);
    if (s !== 'contract') {
      const lastToasts = log.season.toasts.slice(-2).map((t) => t.t).join(' | ');
      throw new Error(`${via}: no negotiation screen (stayed on ${s}); toast: ${lastToasts}`);
    }
    opened = true;
    return via;
  });
  if (!opened) return;
  const negInfo = async () =>
    page.evaluate(() => ({
      round: document.querySelector('.rounds span')?.textContent,
      offer: document.querySelector('.on-wage')?.textContent,
      last: [...document.querySelectorAll('.neg-log .bubble')].map((b) => b.textContent).slice(-1)[0] ?? '',
      ask: !document.querySelector('.neg-actions .btn-ink')?.disabled,
    }));
  await step(S, 'negotiate 3 rounds', async () => {
    await audit(page, 'contract');
    await shot(page, 'contract-r1', true);
    const rounds = [];
    for (let r = 0; r < 4; r++) {
      if ((await screenOf(page)) !== 'contract') {
        rounds.push(`closed -> ${await screenOf(page)}`);
        break;
      }
      const info = await negInfo();
      if (/ההצעה האחרונה/.test(info.last)) {
        rounds.push(`final offer ${info.offer} (label "${info.round}")`);
        break;
      }
      // demand: push toward the top of the agent range (+10% each round)
      await page.evaluate((k) => {
        const s = document.querySelector('.contract-screen input.slider');
        if (!s) return;
        const v = Math.min(Number(s.max), Math.round((Number(s.value) * (1 + 0.1 * k)) / 100) * 100);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(s, String(v));
        s.dispatchEvent(new Event('input', { bubbles: true }));
      }, r);
      await tap(page, 'לבקש', { exact: true, after: 400 });
      const tst = log.season.toasts.slice(-1)[0]?.t ?? '';
      rounds.push(`${info.round}: offer ${info.offer} -> "${tst}"`);
      log.season.negotiation.push({ ...info, toast: tst });
      if ((await screenOf(page)) === 'contract') {
        await audit(page, 'contract');
        await shot(page, `contract-after-ask${r + 1}`, true);
      }
    }
    return rounds.join(' ; ');
  });
  await step(S, 'UI marks the engine\'s final offer (no more asks)', async () => {
    if ((await screenOf(page)) !== 'contract') return `negotiation already closed (${await screenOf(page)})`;
    const info = await negInfo();
    if (/ההצעה האחרונה/.test(info.last) && info.ask) {
      await shot(page, 'contract-final-not-marked', true);
      throw new Error(`engine said "${info.last}" but UI shows "${info.round}" and "לבקש" is still enabled (one more ask = talks collapse)`);
    }
    return `${info.round}, ask enabled ${info.ask}`;
  });
  await step(S, 'final offer: accept', async () => {
    const s = await screenOf(page);
    if (s !== 'contract') return `negotiation already closed (${s})`;
    const wage = (await page.locator('.on-wage').textContent()).trim();
    await tap(page, /לחתום/, { after: 500 });
    const after = await screenOf(page);
    await shot(page, `after-sign-${after}`);
    assert(after !== 'contract', 'still on contract after signing');
    let signed = '';
    if (['week', 'agent', 'club', 'table', 'more'].includes(after)) {
      await page.locator('.bottom-nav button').nth(2).click();
      await idle(page);
      signed = (await page.locator('.contract-strip b').first().textContent().catch(() => '')).trim();
      await shot(page, 'club-after-sign', true);
      await page.locator('.bottom-nav button').nth(0).click();
      await idle(page);
      assert(signed === wage, `club screen wage ${signed} != signed ${wage}`);
    }
    return `signed ${wage}, club shows ${signed}, landed on ${after}`;
  });
  await step(S, 'walk away from a second negotiation', async () => {
    if ((await screenOf(page)) !== 'week') return `skipped (on ${await screenOf(page)})`;
    await page.locator('.bottom-nav button').nth(3).click();
    await idle(page);
    const neg = page.getByRole('button', { name: 'לשבת למשא ומתן' });
    if (await neg.first().isVisible().catch(() => false)) await neg.first().click();
    else await page.getByRole('button', { name: 'לבקש חוזה חדש' }).click();
    await idle(page, 400);
    if ((await screenOf(page)) !== 'contract') return `no negotiation opened; toast "${log.season.toasts.slice(-1)[0]?.t ?? ''}"`;
    await tap(page, 'לקום', { exact: true });
    await page.locator('.modal').waitFor({ state: 'visible', timeout: 3000 });
    await shot(page, 'walk-away-modal');
    await audit(page, 'walkaway-modal');
    await page.locator('.modal').getByRole('button', { name: 'לקום וללכת' }).click();
    await idle(page, 400);
    const after = await screenOf(page);
    assert(after !== 'contract', 'still on contract after walking away');
    return `-> ${after}; toast "${log.season.toasts.slice(-1)[0]?.t ?? ''}"`;
  });
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
          await tap(page, 'צא למגרש');
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
  if (only.includes('a')) for (let i = 1; i <= Number(process.env.FIRSTKICK_RUNS || 3); i++) await scenarioFirstKick(i).catch((e) => record('a-first-kick', 'scenario crashed', false, 0, e.message));
  if (only.includes('b')) await scenarioSeason().catch((e) => record('b-season', 'scenario crashed', false, 0, e.message));
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
