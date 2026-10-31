import { view } from '../../app/store';
import type { View } from '../../core/types';
import { vx } from '../viewExtras';
import { TopBar } from '../components/TopBar';
import { Crest } from '../components/Crest';

export function LeagueTable({ v, compact }: { v: View; compact?: boolean }) {
  const zones = vx(v).leagueZones ?? { promote: 0, relegate: 2, champion: 1 };
  const n = v.table.length;
  const rows = compact ? v.table.slice(0, 8) : v.table;
  return (
    <table class={`ltable ${compact ? 'compact' : ''}`}>
      <thead>
        <tr>
          <th class="c-pos">#</th>
          <th class="c-club">קבוצה</th>
          <th>מש׳</th>
          {!compact && <th>נ-ת-ה</th>}
          <th>הפרש</th>
          <th class="c-pts">נק׳</th>
          {!compact && <th class="c-form">כושר</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const pos = i + 1;
          const zone = pos <= (zones.champion ?? 0) ? 'z-champ' : pos <= zones.promote ? 'z-promo' : pos > n - zones.relegate ? 'z-releg' : '';
          const me = r.clubId === v.club?.id;
          const gd = r.gf - r.ga;
          return (
            <tr key={r.clubId} class={`${zone} ${me ? 'me' : ''}`}>
              <td class="c-pos num">{pos}</td>
              <td class="c-club">
                <div class="club-cell">
                  <Crest spec={r.crest} colors={r.colors} name={r.name} short={r.short} size={22} />
                  <span>{compact ? r.short : r.name}</span>
                </div>
              </td>
              <td class="num">{r.p}</td>
              {!compact && (
                <td class="num c-wdl">
                  {r.w}-{r.d}-{r.l}
                </td>
              )}
              <td class="num">{gd > 0 ? `+${gd}` : gd}</td>
              <td class="c-pts num">{r.pts}</td>
              {!compact && (
                <td class="c-form">
                  {r.form.slice(-5).map((f, j) => (
                    <i key={j} class={`fd fd-${f}`} />
                  ))}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function TableScreen() {
  const v = view.value!;
  const zones = vx(v).leagueZones ?? { promote: 0, relegate: 2, champion: 1 };
  return (
    <main class="screen has-nav table-screen">
      <TopBar v={v} title={v.league?.name ?? 'טבלה'} sub={`${v.league?.country ?? ''} · מחזור ${v.season.week + 1} מתוך ${v.season.totalWeeks}`} />
      <div class="paper table-paper">
        <LeagueTable v={v} />
      </div>
      <div class="legend">
        {(zones.champion ?? 0) > 0 && <span><i class="lgd z-champ" /> אליפות</span>}
        {zones.promote > 0 && <span><i class="lgd z-promo" /> עלייה</span>}
        {zones.relegate > 0 && <span><i class="lgd z-releg" /> ירידה</span>}
        <span><i class="lgd me" /> הקבוצה שלך</span>
      </div>
    </main>
  );
}
