import { useState } from 'preact/hooks';
import { view } from '../../app/store';
import type { View } from '../../core/types';
import { vx } from '../viewExtras';
import { TopBar } from '../components/TopBar';
import { Crest } from '../components/Crest';

const FORM_HE: Record<string, string> = { W: 'נ', D: 'ת', L: 'ה' };

/** Matchday played / total rounds of THIS league (double round robin), from the table itself. */
export function leagueRound(v: View): { played: number; total: number } {
  const n = v.table.length;
  const me = v.table.find((r) => r.clubId === v.club?.id);
  const played = me?.p ?? Math.max(0, ...v.table.map((r) => r.p));
  return { played, total: Math.max(1, v.leagueZones?.rounds ?? (n - 1) * 2) };
}

/**
 * Fits 360-430px without horizontal scroll: fixed layout, the club name takes the remaining width and ellipsizes.
 * "מקוצר": # · club · מש׳ · הפרש · נק׳.  "מלא": # · club · נ-ת-ה · כושר · נק׳.  Tap a row for its details.
 */
export function LeagueTable({ v, compact, full }: { v: View; compact?: boolean; full?: boolean }) {
  const zones = vx(v).leagueZones ?? { promote: 0, relegate: 2, champion: 1 };
  const [open, setOpen] = useState<number | null>(null);
  const n = v.table.length;
  const rows = compact ? v.table.slice(0, 8) : v.table;
  const wide = full && !compact;
  return (
    <table class={`ltable ${compact ? 'compact' : ''} ${wide ? 'full' : ''}`}>
      <colgroup>
        <col class="w-pos" />
        <col />
        {wide ? <col class="w-wdl" /> : <col class="w-p" />}
        {wide ? <col class="w-form" /> : <col class="w-gd" />}
        <col class="w-pts" />
      </colgroup>
      <thead>
        <tr>
          <th class="c-pos">#</th>
          <th class="c-club">קבוצה</th>
          {wide ? <th>נ-ת-ה</th> : <th>מש׳</th>}
          {wide ? <th>כושר</th> : <th>הפרש</th>}
          <th class="c-pts">נק׳</th>
        </tr>
      </thead>
      <tbody>
        {rows.flatMap((r, i) => {
          const pos = i + 1;
          const zone = pos <= (zones.champion ?? 0) ? 'z-champ' : pos <= zones.promote ? 'z-promo' : pos > n - zones.relegate ? 'z-releg' : '';
          const me = r.clubId === v.club?.id;
          const gd = r.gf - r.ga;
          const gdText = gd > 0 ? `+${gd}` : String(gd);
          const isOpen = open === r.clubId && !compact;
          const main = (
            <tr
              key={r.clubId}
              class={`${zone} ${me ? 'me' : ''} ${compact ? '' : 'tap'}`}
              onClick={compact ? undefined : () => setOpen(isOpen ? null : r.clubId)}
              aria-expanded={compact ? undefined : isOpen}
            >
              <td class="c-pos num">{pos}</td>
              <td class="c-club">
                <div class="club-cell">
                  <Crest spec={r.crest} colors={r.colors} name={r.name} short={r.short} size={compact ? 18 : 20} />
                  <span class="cc-name">{compact ? r.short : r.name}</span>
                </div>
              </td>
              {wide ? (
                <td class="num c-wdl">
                  {r.w}-{r.d}-{r.l}
                </td>
              ) : (
                <td class="num">{r.p}</td>
              )}
              {wide ? (
                <td class="c-form">
                  {r.form.slice(-5).map((f, j) => (
                    <i key={j} class={`fd fd-${f}`} />
                  ))}
                </td>
              ) : (
                <td class="num">{gdText}</td>
              )}
              <td class="c-pts num">{r.pts}</td>
            </tr>
          );
          if (!isOpen) return [main];
          return [
            main,
            <tr key={`${r.clubId}-d`} class={`row-detail ${me ? 'me' : ''}`}>
              <td colSpan={5}>
                <div class="rd">
                  <b>{r.name}</b>
                  <span>
                    {r.p} משחקים · {r.w} נ׳ {r.d} ת׳ {r.l} ה׳ · שערים <bdi class="num">{r.gf}:{r.ga}</bdi> ({gdText})
                  </span>
                  {r.form.length > 0 && (
                    <span class="rd-form" aria-label={`5 אחרונים: ${r.form.slice(-5).map((f) => FORM_HE[f] ?? f).join(' ')}`}>
                      5 אחרונים:{' '}
                      {r.form.slice(-5).map((f, j) => (
                        <i key={j} class={`fd fd-${f}`} />
                      ))}
                    </span>
                  )}
                </div>
              </td>
            </tr>,
          ];
        })}
      </tbody>
    </table>
  );
}

export function TableScreen() {
  const v = view.value!;
  const zones = vx(v).leagueZones ?? { promote: 0, relegate: 2, champion: 1 };
  const [full, setFull] = useState(false);
  const { played, total } = leagueRound(v);
  return (
    <main class="screen has-nav table-screen">
      <TopBar v={v} title={v.league?.name ?? 'טבלה'} sub={`${v.league?.country ?? ''} · ${played > 0 ? `מחזור ${played} מתוך ${total}` : `לפני מחזור 1 מתוך ${total}`}`} />
      <div class="seg table-toggle" role="group" aria-label="תצוגת הטבלה">
        <button type="button" aria-pressed={!full} onClick={() => setFull(false)}>מקוצר</button>
        <button type="button" aria-pressed={full} onClick={() => setFull(true)}>מלא</button>
      </div>
      <div class="paper table-paper">
        <LeagueTable v={v} full={full} />
      </div>
      <div class="legend">
        {(zones.champion ?? 0) > 0 && <span><i class="lgd z-champ" /> אליפות</span>}
        {zones.promote > 0 && <span><i class="lgd z-promo" /> עלייה</span>}
        {zones.relegate > 0 && <span><i class="lgd z-releg" /> ירידה</span>}
        <span><i class="lgd me" /> הקבוצה שלך</span>
        <span class="muted-wall">הקש על שורה לפרטים</span>
      </div>
    </main>
  );
}
