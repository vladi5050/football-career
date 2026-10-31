import type { ComponentChildren } from 'preact';
import type { View } from '../../core/types';
import { moneyShort, weekLabel } from '../i18n';
import { Crest } from './Crest';
import { IconBack } from './Icons';

/** Header used on tab screens: crest, title, week, money. */
export function TopBar({ v, title, sub, onBack, right }: { v?: View | null; title: ComponentChildren; sub?: ComponentChildren; onBack?: () => void; right?: ComponentChildren }) {
  return (
    <header class="topbar">
      {onBack && (
        <button class="icon-btn" type="button" onClick={onBack} aria-label="חזרה">
          <IconBack />
        </button>
      )}
      {!onBack && v?.club && <Crest spec={v.club.crest} colors={v.club.colors} name={v.club.name} short={v.club.short} size={38} />}
      <div class="tb-main">
        <h1 class="tb-title">{title}</h1>
        <div class="tb-sub">{sub ?? (v ? weekLabel(v) : null)}</div>
      </div>
      {v?.player.injury && !right && (
        <span class="inj-badge" title={v.player.injury.kind}>
          <span aria-hidden="true">+</span> פצוע · {v.player.injury.weeksLeft === 1 ? 'שבוע' : `${v.player.injury.weeksLeft} שב׳`}
        </span>
      )}
      {right ?? (v && <span class="money num">{moneyShort(v.career.money)}</span>)}
    </header>
  );
}
