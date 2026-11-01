// Desktop (>= 1100px) second column next to the tab screens: next match, mini table, near goals, headlines.
// Hidden below 1100px by CSS; the .shell-row.has-side class stays the hook for layout and the e2e suite.
import { navigate, view } from '../../app/store';
import { Crest } from '../components/Crest';
import { ProgressNearGoal } from '../components/Bars';
import { nearestAttrGoal } from '../i18n';
import { LeagueTable, leagueRound } from './Table';
import { NewsList } from './News';

export function SidePanel() {
  const v = view.value;
  if (!v) return null;
  const fx = v.nextFixture;
  const club = v.club;
  const ng = nearestAttrGoal(v);
  const goals = (v.lastWeekReport?.nearGoals ?? []).slice(0, 2);
  const { played, total } = leagueRound(v);
  return (
    <aside class="side-panel" aria-label="המשחק הבא, טבלה וחדשות">
      {fx && club && (
        <section class="paper side-fixture" aria-label="המשחק הבא">
          <span class="label">המשחק הבא · {fx.home ? 'בית' : 'חוץ'}</span>
          <div class="sf-teams">
            <div class="sf-team">
              <Crest spec={club.crest} colors={club.colors} name={club.name} short={club.short} size={44} />
              <span>{club.name}</span>
            </div>
            <span class="sf-vs display">נגד</span>
            <div class="sf-team">
              <Crest spec={fx.opp.crest} colors={fx.opp.colors} name={fx.opp.name} short={fx.opp.short} size={44} />
              <span>{fx.opp.name}</span>
            </div>
          </div>
          {fx.derby && <span class="chip chip-red">דרבי</span>}
        </section>
      )}

      {v.table.length > 0 && (
        <section class="side-block">
          <h2 class="section-title side-title">
            <span>{v.league?.name ?? 'טבלה'}</span>
            <small>{played > 0 ? `מחזור ${played}/${total}` : ''}</small>
          </h2>
          <div class="paper table-paper">
            <LeagueTable v={v} compact />
          </div>
          <button type="button" class="btn btn-ghost btn-sm side-more" onClick={() => navigate('table')}>
            לטבלה המלאה
          </button>
        </section>
      )}

      {(goals.length > 0 || ng) && (
        <section class="paper side-goals" aria-label="קרוב למטרה">
          <span class="label">קרוב למטרה</span>
          {goals.length > 0
            ? goals.map((g) => <ProgressNearGoal key={g.text} text={g.text} progress={g.progress} target={g.target} />)
            : ng && <ProgressNearGoal text={ng.text} progress={ng.value} target={ng.target} />}
        </section>
      )}

      {v.news.length > 0 && (
        <section class="side-block">
          <h2 class="section-title">כותרות</h2>
          <div class="newspaper">
            <NewsList items={v.news} limit={3} />
          </div>
        </section>
      )}
    </aside>
  );
}
