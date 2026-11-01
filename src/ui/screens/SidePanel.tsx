// Desktop (>=1024px) second column: table + news next to the main column.
import { view } from '../../app/store';
import { LeagueTable } from './Table';
import { NewsList } from './News';

export function SidePanel() {
  const v = view.value;
  if (!v) return null;
  return (
    <aside class="side-panel" aria-label="טבלה וחדשות">
      <h2 class="section-title">{v.league?.name ?? 'טבלה'}</h2>
      <div class="paper table-paper">
        <LeagueTable v={v} compact />
      </div>
      <h2 class="section-title">כותרות</h2>
      <div class="newspaper">
        <NewsList items={v.news} limit={4} />
      </div>
    </aside>
  );
}
