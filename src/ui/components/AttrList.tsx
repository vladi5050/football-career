import type { AttrKey, Attributes, Position } from '../../core/types';
import { ATTR_HE, ATTR_ORDER, POS_KEYS } from '../i18n';
import { Bar } from './Bars';

/** Attributes with bars; shows the fractional progress to the next whole number in a lighter tone. */
export function AttrList({ attr, pos, keys }: { attr: Attributes; pos: Position; keys?: AttrKey[] }) {
  const list = (keys ?? ATTR_ORDER).filter((k) => k !== 'gk' || pos === 'GK');
  const important = POS_KEYS[pos];
  return (
    <div class="attr-list">
      {list.map((k) => {
        const v = attr[k];
        return (
          <div key={k} class={`attr-row ${important.includes(k) ? 'key' : ''}`}>
            <span class="attr-name">{ATTR_HE[k]}</span>
            <Bar value={v} max={99} color={important.includes(k) ? undefined : 'blue'} />
            <span class="attr-val num">{Math.floor(v)}</span>
          </div>
        );
      })}
    </div>
  );
}
