// What happened in the weeks a faster season speed (or "שבוע מהיר עד המשחק הבא") ran automatically.
import type { SkipSummary } from '../../core/types';
import { ATTR_HE, countHe } from '../i18n';

export function SkipCard({ skip }: { skip: SkipSummary }) {
  const moved = skip.posBefore > 0 && skip.posAfter > 0 && skip.posBefore !== skip.posAfter;
  const goals = skip.matches.reduce((s, m) => s + m.goals, 0);
  return (
    <section class="paper skip-card" aria-label="השבועות שרצו אוטומטית">
      <div class="skip-head">
        <h2 class="paper-title">{skip.weeks === 1 ? 'שבוע אחד רץ לבד' : `${skip.weeks} שבועות רצו לבד`}</h2>
        <span class="skip-stop">{skip.stopReason}</span>
      </div>

      {skip.matches.length > 0 && (
        <ul class="skip-matches">
          {skip.matches.map((m) => {
            const res = m.us > m.them ? 'w' : m.us < m.them ? 'l' : 'd';
            return (
              <li key={`${m.seasonWeek}-${m.oppId}`}>
                <span class={`skip-res ${res}`}>{res === 'w' ? 'נ' : res === 'l' ? 'ה' : 'ת'}</span>
                <span class="skip-opp">
                  <small class="skip-ha">{m.home ? 'בית' : 'חוץ'}</small> {m.oppName}
                  {m.youth && <small> · נוער</small>}
                </span>
                <b class="num skip-score" dir="ltr">{m.us}-{m.them}</b>
                <span class="skip-me num">
                  {m.rating != null ? m.rating.toFixed(1) : 'לא שיחקת'}
                  {m.goals > 0 && <i class="skip-goal">{m.goals === 1 ? ' · שער' : ` · ${m.goals} שערים`}</i>}
                  {m.assists > 0 && <i>{m.assists === 1 ? ' · בישול' : ` · ${m.assists} בישולים`}</i>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div class="skip-foot">
        {skip.posBefore > 0 && skip.posAfter > 0 && (
          <span class={`chip ${moved ? (skip.posAfter < skip.posBefore ? 'chip-green' : 'chip-red') : 'chip-ink'}`}>
            מקום {skip.posBefore} {moved ? `← ${skip.posAfter}` : 'בלי שינוי'}
          </span>
        )}
        {goals > 0 && <span class="chip chip-orange">{countHe(goals, 'שער', 'שערים')}</span>}
        {skip.gains.map((g) => (
          <span key={g.key} class="chip chip-blue">{ATTR_HE[g.key]} +{(g.after - g.before).toFixed(1)}</span>
        ))}
      </div>

      {skip.autoEvents.length > 0 && (
        <details class="skip-events">
          <summary>החלטנו בשבילך ({skip.autoEvents.length})</summary>
          <ul>
            {skip.autoEvents.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
