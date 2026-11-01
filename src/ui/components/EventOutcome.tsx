import { useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { eventOutcome } from '../../app/store';
import { TapedCard } from './TapedCard';

/** Right after a story answer: what the choice caused (relations, morale, money, goals, news). */
export function EventOutcomeSheet() {
  const o = eventOutcome.value;
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => { eventOutcome.value = null; };
  useEffect(() => {
    if (!o) return;
    btn.current?.focus();
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [o]);
  if (!o) return null;
  const lines = o.lines.length ? o.lines : [{ text: 'בינתיים זה עבר בשקט. אף אחד לא אמר כלום.', tone: 'info' as const }];
  return createPortal(
    <div class="modal-backdrop outcome-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal outcome-sheet" role="dialog" aria-modal="true" aria-label={`מה זה גרם: ${o.title}`}>
        <TapedCard tape="center">
          <div class="outcome-kicker">{o.title}</div>
          <h2 class="paper-title outcome-choice">"{o.choice}"</h2>
          <ul class="outcome-lines">
            {lines.map((l, i) => (
              <li key={i} class={`outcome-line tone-${l.tone} rise`} style={{ '--delay': `${80 + i * 90}ms` }}>
                <span class="ol-text">{l.text}</span>
                {l.delta && <span class="ol-delta num">{l.delta}</span>}
              </li>
            ))}
          </ul>
          {o.followUp && <p class="outcome-follow">זה עוד יחזור אליך.</p>}
          <div class="modal-actions">
            <button ref={btn} type="button" class="btn btn-ink" onClick={close}>המשך</button>
          </div>
        </TapedCard>
      </div>
    </div>,
    document.body,
  );
}
