import { useState } from 'preact/hooks';
import type { Position } from '../../core/types';
import { busy, navigate, startCareer } from '../../app/store';
import { teamNames } from '../../app/save';
import { POS_HE } from '../i18n';
import { Magnet } from '../components/Magnet';
import { IconBack, IconDice } from '../components/Icons';

// Portrait pitch, attacking upwards. Coordinates in % of the board.
const SPOTS: { pos: Position; x: number; y: number }[] = [
  { pos: 'ST', x: 50, y: 13 },
  { pos: 'W', x: 17, y: 22 },
  { pos: 'AM', x: 50, y: 34 },
  { pos: 'CM', x: 72, y: 50 },
  { pos: 'DM', x: 38, y: 58 },
  { pos: 'FB', x: 84, y: 72 },
  { pos: 'CB', x: 40, y: 78 },
  { pos: 'GK', x: 50, y: 92 },
];
const BLURB: Record<Position, string> = {
  ST: 'הבעיטה הראשונה, הריצה מאחורי ההגנה',
  W: 'אחד על אחד, הרמה לרחבה, חדירה פנימה',
  AM: 'מסירת עומק ובעיטה מחוץ לרחבה',
  CM: 'שבירת לחץ ומסירה שפותחת משחק',
  DM: 'חטיפה, חסימה, ומסירה ראשונה קדימה',
  FB: 'חסימת כנף והצטרפות להתקפה',
  CB: 'תיקול ברגע הנכון ומשחק ראש',
  GK: 'הצלה, יציאה לכדור גבוה. כמעט משחק נפרד',
};
const FIRST = ['נועם', 'איתי', 'עידו', 'יונתן', 'אורי', 'רועי', 'אליה', 'עומרי', 'דניאל', 'יואב', 'אדם', 'מוחמד', 'עמית', 'בן'];
const LAST = ['כהן', 'לוי', 'מזרחי', 'פרץ', 'ביטון', 'אברהם', 'אזולאי', 'חדאד', 'גבאי', 'שפירא', 'בן דוד', 'עזרא', 'נסאר', 'אוחיון'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;

export function NewCareerScreen() {
  const [pos, setPos] = useState<Position>('W');
  const [first, setFirst] = useState(() => pick(FIRST));
  const [last, setLast] = useState(() => pick(LAST));
  const [shirt, setShirt] = useState(11);
  const [snapKey, setSnapKey] = useState(0);

  const choose = (p: Position) => {
    setPos(p);
    setSnapKey((k) => k + 1);
    const def: Record<Position, number> = { GK: 1, CB: 4, FB: 2, DM: 6, CM: 8, AM: 10, W: 11, ST: 9 };
    setShirt(def[p]);
  };
  const randomName = () => {
    setFirst(pick(FIRST));
    setLast(pick(LAST));
  };
  const ok = first.trim().length > 0 && last.trim().length > 0 && shirt >= 1 && shirt <= 99;
  const go = async () => {
    if (!ok) return;
    const names = await teamNames.read();
    const res = await startCareer({ type: 'newCareer', pos, firstName: first.trim(), lastName: last.trim(), shirt, ...(names ? { clubsOverride: names } : {}) });
    if (res) navigate('reveal', { replace: true });
  };

  return (
    <main class="screen has-actions new-career">
      <header class="topbar">
        <button class="icon-btn" type="button" onClick={() => navigate('title')} aria-label="חזרה">
          <IconBack />
        </button>
        <div class="tb-main">
          <h1 class="tb-title">שחקן חדש</h1>
          <div class="tb-sub">בחר עמדה על הלוח. המנוע יחליט איפה מתחילים.</div>
        </div>
      </header>

      <div class="board-wrap">
        <div class="board tactics" role="radiogroup" aria-label="עמדה">
          <svg class="pitch-lines" viewBox="0 0 100 130" preserveAspectRatio="none" aria-hidden="true">
            <g fill="none" stroke="#1E4FD8" stroke-width="0.7" stroke-opacity="0.55" stroke-linecap="round">
              <rect x="4" y="3" width="92" height="124" rx="1" />
              <path d="M4 65 H96" />
              <circle cx="50" cy="65" r="11" />
              <rect x="26" y="3" width="48" height="18" />
              <rect x="38" y="3" width="24" height="7" />
              <rect x="26" y="109" width="48" height="18" />
              <rect x="38" y="120" width="24" height="7" />
            </g>
            <path d="M18 34 C 22 26, 30 22, 40 22" fill="none" stroke="#D7263D" stroke-width="0.9" stroke-dasharray="2 2" />
            <path d="M40 22 l-3 -2 M40 22 l-3 2" stroke="#D7263D" stroke-width="0.9" />
          </svg>
          {SPOTS.map((s) => {
            const sel = s.pos === pos;
            return (
              <button
                key={s.pos}
                type="button"
                role="radio"
                aria-checked={sel}
                class={`pos-spot ${sel ? 'sel' : ''}`}
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
                onClick={() => choose(s.pos)}
              >
                <Magnet key={sel ? `s${snapKey}` : 'n'} color={sel ? 'orange' : s.pos === 'GK' ? 'yellow' : 'blue'} size={sel ? 54 : 44} snap={sel} lifted={false}>
                  {sel ? shirt : ''}
                </Magnet>
                <span class="pos-label">{POS_HE[s.pos]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div class="pos-blurb">
        <b>{POS_HE[pos]}</b>
        <span>{BLURB[pos]}</span>
      </div>

      <div class="name-row">
        <label class="field">
          <span>שם פרטי</span>
          <input class="input" value={first} maxLength={14} onInput={(e) => setFirst((e.target as HTMLInputElement).value)} autocomplete="off" />
        </label>
        <label class="field">
          <span>שם משפחה</span>
          <input class="input" value={last} maxLength={16} onInput={(e) => setLast((e.target as HTMLInputElement).value)} autocomplete="off" />
        </label>
        <button class="icon-btn dice" type="button" onClick={randomName} aria-label="שם אקראי">
          <IconDice />
        </button>
      </div>
      <div class="shirt-row">
        <span class="wall-label">מספר חולצה</span>
        <div class="stepper on-wall-stepper">
          <button type="button" aria-label="פחות" onClick={() => setShirt((n) => Math.max(1, n - 1))}>−</button>
          <output class="num" aria-live="polite">{shirt}</output>
          <button type="button" aria-label="יותר" onClick={() => setShirt((n) => Math.min(99, n + 1))}>+</button>
        </div>
      </div>

      <div class="action-bar">
        <button class="btn btn-primary" type="button" disabled={!ok || busy.value} onClick={go}>
          {busy.value ? 'הסקאוט בדרך...' : 'צא לדרך'}
        </button>
      </div>
    </main>
  );
}
