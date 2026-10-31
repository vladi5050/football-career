import type { ComponentChildren } from 'preact';

export function Bar({ value, max = 100, color, striped, class: cls }: { value: number; max?: number; color?: 'blue' | 'green' | 'red'; striped?: boolean; class?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div class={`bar ${color ?? ''} ${striped ? 'striped' : ''} ${cls ?? ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
      <i style={{ '--v': `${pct}%` }} />
    </div>
  );
}

/** "עוד 1 לדריבל 50" style near-goal bar. */
export function ProgressNearGoal({ text, progress, target, from = 0, label, onDark }: { text: string; progress: number; target: number; from?: number; label?: ComponentChildren; onDark?: boolean }) {
  const span = Math.max(0.0001, target - from);
  const pct = Math.max(0, Math.min(1, (progress - from) / span));
  // one decimal only when less than 1 away ("39.9 מתוך 40"), whole numbers otherwise
  const close = target - progress < 1;
  const fmt = (x: number) => (close ? (Math.floor(x * 10) / 10).toFixed(1).replace(/\.0$/, '') : String(Math.floor(x)));
  const shownText = text.replace(/\d+\.\d+/g, (m) => fmt(Number(m)));
  const hasNumbers = /מתוך/.test(text);
  return (
    <div class={`near-goal ${pct >= 0.8 ? 'hot' : ''} ${onDark ? 'on-wall' : ''}`}>
      <div class="ng-top">
        <span>{shownText}</span>
        {label ?? (hasNumbers ? null : <span class="ng-target num">{fmt(progress)}/{target}</span>)}
      </div>
      <Bar value={pct * 100} striped />
    </div>
  );
}

/** Manager patience: shown as a mood, never as a number. */
export function PatienceBar({ value }: { value: number }) {
  const mood = value > 65 ? 'רגוע ומקשיב' : value > 40 ? 'מתחיל להתעייף' : value > 20 ? 'מתופף על השולחן' : 'על סף לקום';
  const color = value > 65 ? 'green' : value > 35 ? undefined : 'red';
  return (
    <div class="patience">
      <div class="ng-top" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>סבלנות המנהל</span>
        <span class={value <= 35 ? 'marker-red' : ''}>{mood}</span>
      </div>
      <Bar value={value} color={color} />
    </div>
  );
}

export function RelationMeter({ value }: { value: number }) {
  // -100 (left, red) .. 100 (right, green) in RTL
  const p = ((100 - value) / 200) * 100;
  return <div class="rel-meter" role="meter" aria-valuemin={-100} aria-valuemax={100} aria-valuenow={value}><i style={{ '--p': `${p}%` }} /></div>;
}
