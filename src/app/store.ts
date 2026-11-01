// App state (signals) + the bridge to the simulation.
// UI renders `view` and sends Commands through `act()`. Nothing here knows game rules.
import { signal, computed, batch } from '@preact/signals';
import type { ApplyResult, Command, View } from '../core/types';
import { autosave } from './save';

export type NewCareerCmd = Extract<Command, { type: 'newCareer' }>;

/** The only thing the UI needs from the simulation (real worker or mock). */
export interface SimApi {
  newCareer(cmd: NewCareerCmd): Promise<ApplyResult>;
  apply(cmd: Command): Promise<ApplyResult>;
  load(json: string): Promise<ApplyResult>;
  exportSave(): Promise<string>;
}

let api: SimApi | null = null;
export function setSimApi(next: SimApi): void {
  api = next;
}
export function getSimApi(): SimApi {
  if (!api) throw new Error('SimApi not set: call setSimApi() before act()');
  return api;
}

// ---------------------------------------------------------------- signals
export const view = signal<View | null>(null);
export const busy = signal(false);
export const lastError = signal<string | null>(null);
export const hasSave = signal(false);

/** Small summary of the autosave for the title screen (kept in localStorage). */
export interface SaveMeta { name: string; shirt: number; colors: [string, string]; club: string; week: number; season: number }
const META_KEY = 'fc.saveMeta';
function readMeta(): SaveMeta | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(META_KEY) : null;
    return raw ? (JSON.parse(raw) as SaveMeta) : null;
  } catch {
    return null;
  }
}
export const saveMeta = signal<SaveMeta | null>(readMeta());

/** Hash route (#/week, #/table ...). Phase-driven screens override it, see ui/App.tsx. */
export type Route =
  | 'title' | 'new' | 'reveal' | 'week' | 'table' | 'club' | 'agent' | 'more'
  | 'news' | 'goals' | 'settings' | 'editor' | 'end';
const ROUTES: Route[] = ['title', 'new', 'reveal', 'week', 'table', 'club', 'agent', 'more', 'news', 'goals', 'settings', 'editor', 'end'];

function readHash(): Route {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, '').split('/')[0] as Route;
  return ROUTES.includes(h) ? h : 'title';
}
export const screen = signal<Route>(readHash());
export const navDirection = signal<'fwd' | 'back'>('fwd');

const TAB_ORDER: Route[] = ['week', 'table', 'club', 'agent', 'more'];
export function navigate(to: Route, opts: { replace?: boolean } = {}): void {
  const from = screen.value;
  const a = TAB_ORDER.indexOf(from);
  const b = TAB_ORDER.indexOf(to);
  navDirection.value = a >= 0 && b >= 0 && b < a ? 'back' : 'fwd';
  screen.value = to;
  const url = `#/${to}`;
  if (opts.replace) history.replaceState(null, '', url);
  else if (location.hash !== url) history.pushState(null, '', url);
}
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    navDirection.value = 'back';
    screen.value = readHash();
  });
}

// ---------------------------------------------------------------- toasts
export interface ToastMsg { id: number; text: string }
export const toasts = signal<ToastMsg[]>([]);
let toastId = 1;
/** Number of open modals. Toasts are suppressed while any is open. */
export const modalsOpen = signal(0);
const recentToasts = new Map<string, number>();
const TOAST_DEDUPE_MS = 10_000;
// One banner at a time; extra lines wait in a short queue (max 3) and show one after another.
const toastQueue: { text: string; ms: number }[] = [];
let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showNextToast(): void {
  const next = toastQueue.shift();
  if (!next || modalsOpen.value > 0) {
    toasts.value = [];
    toastQueue.length = 0;
    return;
  }
  const id = toastId++;
  toasts.value = [{ id, text: next.text }];
  toastTimer = setTimeout(() => dismissToast(id), next.ms);
}
export function clearToasts(): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toastQueue.length = 0;
  toasts.value = [];
}
export function dismissToast(id: number): void {
  if (!toasts.value.some((t) => t.id === id)) return;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toasts.value = [];
  if (toastQueue.length) setTimeout(showNextToast, 180);
}
export function toast(text: string, ms = 3500): void {
  if (!text || modalsOpen.value > 0) return;
  const now = Date.now();
  const last = recentToasts.get(text);
  if (last != null && now - last < TOAST_DEDUPE_MS) return;
  recentToasts.set(text, now);
  for (const [k, t] of recentToasts) if (now - t > TOAST_DEDUPE_MS) recentToasts.delete(k);
  if (toastQueue.length >= 3) toastQueue.shift();
  toastQueue.push({ text, ms });
  if (!toasts.value.length && !toastTimer) showNextToast();
}

// ---------------------------------------------------------------- local UI settings
const LS_KEY = 'fc.ui.settings';
/** Key-moment style: 'decision' = tactical read on the whiteboard (default), 'arcade' = Pixi swipe mini-game. */
export type MomentStyle = 'decision' | 'arcade';
interface UiSettings { reducedMotion: boolean; seenReveal: boolean; autoMoments: boolean; momentStyle: MomentStyle }
function loadUi(): UiSettings {
  const osReduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { reducedMotion: osReduced, seenReveal: false, autoMoments: false, momentStyle: 'decision', ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { reducedMotion: osReduced, seenReveal: false, autoMoments: false, momentStyle: 'decision' };
}
export const uiSettings = signal<UiSettings>(loadUi());
export function setUiSetting<K extends keyof UiSettings>(k: K, v: UiSettings[K]): void {
  uiSettings.value = { ...uiSettings.value, [k]: v };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(uiSettings.value));
  } catch {
    /* ignore */
  }
}
export const reducedMotion = computed(() => uiSettings.value.reducedMotion);

/** True while the Match screen should keep showing full time after the engine moved on. */
export const matchOutro = signal(false);

// ---------------------------------------------------------------- commands
function applyResult(res: ApplyResult): void {
  const prev = view.value;
  batch(() => {
    if (prev?.phase === 'match' && res.view.phase !== 'match') matchOutro.value = true;
    view.value = res.view;
  });
  res.toast?.filter((t) => !alreadyOnScreen(t, res.view)).forEach((t) => toast(t));
  if (res.saveDue) void persist();
}

/** Skip toasts that repeat something the next screen already shows (negotiation log, week report, news). */
function alreadyOnScreen(text: string, v: View): boolean {
  const norm = (x: string) => x.replace(/[\s."'״]+/g, '');
  const t = norm(text);
  if (!t) return true;
  const shown: string[] = [];
  if (v.phase === 'retired') return true; // the career-end screen speaks for itself
  if (v.phase === 'event' && /החלטה/.test(text)) return true; // the event screen is the decision
  if (v.phase === 'negotiation' && v.career.negotiation) shown.push(...v.career.negotiation.log);
  const rep = v.lastWeekReport;
  if (rep && (v.phase === 'postmatch' || v.phase === 'weekend' || v.phase === 'offseason')) {
    shown.push(...rep.meanwhile, ...rep.openLoops);
    if (rep.headline) shown.push(rep.headline);
  }
  shown.push(...v.news.slice(0, 3).map((n) => n.headline));
  return shown.some((s) => {
    const n = norm(s);
    return n === t || (t.length > 12 && n.includes(t));
  });
}

async function persist(): Promise<void> {
  try {
    const json = await getSimApi().exportSave();
    await autosave.write(json);
    hasSave.value = true;
    const v = view.value;
    if (v) {
      const meta: SaveMeta = { name: v.player.name, shirt: v.player.shirt, colors: v.club?.colors ?? ['#F28C28', '#1B2A4A'], club: v.club?.name ?? '', week: v.season.week + 1, season: v.season.number };
      saveMeta.value = meta;
      try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* ignore */ }
    }
  } catch (e) {
    console.warn('autosave failed', e);
  }
}

async function run(fn: () => Promise<ApplyResult>): Promise<ApplyResult | null> {
  if (busy.value) return null;
  busy.value = true;
  lastError.value = null;
  try {
    const res = await fn();
    applyResult(res);
    return res;
  } catch (e) {
    console.error(e);
    lastError.value = e instanceof Error ? e.message : String(e);
    toast('משהו השתבש. נסה שוב.');
    return null;
  } finally {
    busy.value = false;
  }
}

/** Send any command to the sim. Resolves with the result (or null if busy/failed). */
export function act(cmd: Command): Promise<ApplyResult | null> {
  return run(() => getSimApi().apply(cmd));
}

export async function startCareer(cmd: NewCareerCmd): Promise<ApplyResult | null> {
  const res = await run(() => getSimApi().newCareer(cmd));
  if (res) {
    await persist();
    setUiSetting('seenReveal', false);
  }
  return res;
}

export async function continueCareer(): Promise<boolean> {
  const json = await autosave.read();
  if (!json) return false;
  const res = await run(() => getSimApi().load(json));
  return !!res;
}

export async function importSave(json: string): Promise<boolean> {
  const res = await run(() => getSimApi().load(json));
  if (res) await persist();
  return !!res;
}

export async function exportSaveJson(): Promise<string> {
  return getSimApi().exportSave();
}

export async function deleteSave(): Promise<void> {
  await autosave.clear();
  hasSave.value = false;
  saveMeta.value = null;
  try { localStorage.removeItem(META_KEY); } catch { /* ignore */ }
  view.value = null;
  navigate('title', { replace: true });
}
