// Hebrew labels + formatting helpers. UI-only, no game rules.
import type { AttrKey, Attributes, PlanSlot, Position, SquadRole, TraitId, View } from '../core/types';

export const ATTR_HE: Record<AttrKey, string> = {
  finishing: 'סיומת', passing: 'מסירה', dribbling: 'דריבל', pace: 'מהירות', stamina: 'סיבולת',
  defending: 'הגנה', heading: 'משחק ראש', vision: 'ראיית משחק', gk: 'שוערות',
};
export const ATTR_ORDER: AttrKey[] = ['finishing', 'passing', 'dribbling', 'pace', 'stamina', 'defending', 'heading', 'vision', 'gk'];

export const POS_HE: Record<Position, string> = {
  GK: 'שוער', CB: 'בלם', FB: 'מגן', DM: 'קשר אחורי', CM: 'קשר מרכזי', AM: 'קשר התקפי', W: 'כנף', ST: 'חלוץ',
};
export const POS_SHORT: Record<Position, string> = { GK: 'שוע', CB: 'בלם', FB: 'מגן', DM: 'קשא', CM: 'קשר', AM: 'קשה', W: 'כנף', ST: 'חלו' };
/** The two attributes that matter most per position (UI emphasis only). */
export const POS_KEYS: Record<Position, AttrKey[]> = {
  GK: ['gk', 'passing'], CB: ['defending', 'heading'], FB: ['defending', 'stamina'], DM: ['defending', 'passing'],
  CM: ['passing', 'vision'], AM: ['vision', 'dribbling'], W: ['pace', 'dribbling'], ST: ['finishing', 'pace'],
};

export const ROLE_HE: Record<SquadRole, string> = { star: 'כוכב', starter: 'הרכב', rotation: 'רוטציה', prospect: 'כישרון', backup: 'מחליף' };
export const ROLES: SquadRole[] = ['backup', 'prospect', 'rotation', 'starter', 'star'];

export const TRAIT_HE: Record<TraitId, string> = {
  hot_tempered: 'חם מזג', loyal: 'נאמן', greedy: 'חמדן', grateful: 'מכיר טובה', prefers_youth: 'מאמין בצעירים',
  hates_press: 'שונא תקשורת', calm: 'רגוע', ambitious: 'שאפתן', jealous: 'קנאי', mentor: 'חונך', superstitious: 'מאמין בסימנים',
  tactician: 'טקטיקן', party_animal: 'אוהב מסיבות', workaholic: 'מכור לעבודה', gossip: 'רכלן',
};

export interface SlotInfo { label: string; short: string; color: 'blue' | 'red' | 'yellow' | 'green' | 'orange' | 'ink'; glyph: string; hint: string; cost: number }
const T = (k: AttrKey, glyph: string): SlotInfo => ({ label: `אימון ${ATTR_HE[k]}`, short: ATTR_HE[k], color: 'blue', glyph, hint: `+${ATTR_HE[k]}`, cost: -8 });
export const SLOT_INFO: Record<PlanSlot, SlotInfo> = {
  train_finishing: T('finishing', 'סי'),
  train_passing: T('passing', 'מס'),
  train_dribbling: T('dribbling', 'דר'),
  train_pace: T('pace', 'מה'),
  train_stamina: T('stamina', 'סב'),
  train_defending: T('defending', 'הג'),
  train_heading: T('heading', 'רא'),
  train_vision: T('vision', 'רמ'),
  train_gk: T('gk', 'שו'),
  rest: { label: 'מנוחה', short: 'מנוחה', color: 'green', glyph: 'zz', hint: '+כושר', cost: 14 },
  team_night: { label: 'ערב קבוצה', short: 'ערב קבוצה', color: 'yellow', glyph: 'team', hint: '+חברים', cost: -4 },
  talk_coach: { label: 'שיחה עם המאמן', short: 'שיחה', color: 'red', glyph: 'talk', hint: '+אמון מאמן', cost: 0 },
  extra_gym: { label: 'חדר כושר', short: 'חדר כושר', color: 'ink', glyph: 'gym', hint: '+סיבולת', cost: -12 },
  media: { label: 'ראיון', short: 'ראיון', color: 'orange', glyph: 'mic', hint: '+פרסום', cost: -2 },
  family: { label: 'משפחה', short: 'משפחה', color: 'green', glyph: 'home', hint: '+מורל', cost: 6 },
};
export const OTHER_SLOTS: PlanSlot[] = ['rest', 'talk_coach', 'team_night', 'extra_gym', 'family', 'media'];
export function trainingSlots(pos: Position): PlanSlot[] {
  const keys = POS_KEYS[pos];
  const all: AttrKey[] = ['finishing', 'passing', 'dribbling', 'pace', 'stamina', 'defending', 'heading', 'vision'];
  if (pos === 'GK') all.unshift('gk');
  const ordered = [...keys, ...all.filter((k) => !keys.includes(k))];
  return ordered.map((k) => `train_${k}` as PlanSlot);
}
export const DAYS = ['שלישי', 'רביעי', 'חמישי'] as const;

/** The one money format (matches core fmtMoney): "₪7,400", "₪1.2 מיליון". */
export function money(n: number): string {
  const r = Math.round(n);
  if (Math.abs(r) >= 1_000_000) return `₪${(r / 1_000_000).toFixed(1).replace(/\.0$/, '')} מיליון`;
  return `₪${r.toLocaleString('en-US')}`;
}
/** Kept for older call sites: same format as money(). */
export const moneyShort = money;
export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).replace(/[״׳"']/g, '');
}
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
export function lastName(name: string): string {
  const p = name.trim().split(/\s+/);
  return p.slice(1).join(' ') || p[0] || '';
}
export function avgRating(s: { apps: number; ratingSum: number }): number {
  return s.apps ? Math.round((s.ratingSum / s.apps) * 10) / 10 : 0;
}
export function ratingClass(r: number): string {
  return r >= 7.2 ? 'r-hi' : r >= 6.5 ? 'r-mid' : 'r-lo';
}
/** Engine rating bands: 8+ מצוין, 7.2+ טוב מאוד, 6.5+ טוב, 5.8+ סביר, below חלש. */
export function ratingWord(r: number): string {
  return r >= 8 ? 'מצוין' : r >= 7.2 ? 'טוב מאוד' : r >= 6.5 ? 'טוב' : r >= 5.8 ? 'סביר' : 'חלש';
}
export function relationWord(r: number): string {
  if (r >= 60) return 'סומך עליך';
  if (r >= 25) return 'מחבב אותך';
  if (r >= -10) return 'ניטרלי';
  if (r >= -40) return 'מסויג';
  return 'עוין';
}
export function attrFloor(a: Attributes, k: AttrKey): number {
  return Math.floor(a[k]);
}

/** The single most "almost there" attribute: e.g. dribbling 49.6 -> "עוד 1 לדריבל 50". */
export function nearestAttrGoal(v: View): { key: AttrKey; value: number; target: number; text: string; frac: number } | null {
  const keys = POS_KEYS[v.player.pos];
  let best: { key: AttrKey; value: number; target: number; text: string; frac: number } | null = null;
  for (const k of [...keys, ...ATTR_ORDER.filter((x) => !keys.includes(x) && x !== 'gk')]) {
    const val = v.player.attr[k];
    const target = Math.floor(val / 5) * 5 + 5;
    const gap = target - val;
    const score = gap - (keys.includes(k) ? 1.2 : 0);
    if (!best || score < best.target - best.value - (keys.includes(best.key) ? 1.2 : 0)) {
      best = { key: k, value: val, target, text: `עוד ${Math.max(1, Math.ceil(gap))} ל${ATTR_HE[k]} ${target}`, frac: 1 - gap / 5 };
    }
  }
  return best;
}

export function weekLabel(v: View): string {
  return `עונה ${v.season.number} · שבוע ${v.season.week + 1}`;
}
export const START_KIND_HE = {
  israel: { title: 'נוער בישראל', line: 'נשארת בבית. מחלקת הנוער רצתה אותך מיד.' },
  foreign_academy: { title: 'אקדמיה בחו״ל', line: 'אקדמיה באירופה הציעה לך מקום. מזוודה אחת, חלום אחד.' },
  raised_abroad: { title: 'גדלת בחו״ל', line: 'נולדת לישראלים בחו״ל. הנבחרת עוד לא יודעת עליך.' },
} as const;

/** Hebrew count: 1 -> "שער אחד" / "הופעה אחת", n -> "n שערים". */
export function countHe(n: number, one: string, many: string, fem = false): string {
  if (n === 1) return `${one} ${fem ? 'אחת' : 'אחד'}`;
  return `${n} ${many}`;
}

/** Training facilities as stars: 4 -> "★★★★☆". */
export function starsHe(n: number): string {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return '★'.repeat(k) + '☆'.repeat(5 - k);
}

/** Training persistence (1..100) in words. */
export function persistenceHe(p: number): string {
  return p >= 75 ? 'גבוהה מאוד' : p >= 58 ? 'גבוהה' : p >= 40 ? 'בינונית' : p >= 22 ? 'נמוכה' : 'נמוכה מאוד';
}

export type SeasonSpeedUi = 'full' | 'balanced' | 'key';
/** Season speed choices (new career + settings). */
export const SEASON_SPEEDS: { id: SeasonSpeedUi; label: string; sub: string }[] = [
  { id: 'full', label: 'כל משחק', sub: 'משחקים כל שבת. הכי הרבה רגעים, הכי הרבה זמן' },
  { id: 'balanced', label: 'משחקים חשובים', sub: 'דרבי, צמודות בטבלה, הצמרת והתחתית וסוף עונה במאבק. שאר השבועות רצים לבד' },
  { id: 'key', label: 'רק משחקי מפתח', sub: 'דרבי, משחקים מכריעים ויריבות ישירות בסוף העונה. עונה עוברת מהר' },
];
