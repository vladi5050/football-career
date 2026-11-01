import { navigate, screen, view, type Route } from '../../app/store';
import { IconAgent, IconClub, IconMore, IconTable, IconWeek } from './Icons';

const TABS: { route: Route; label: string; Icon: typeof IconWeek; also?: Route[] }[] = [
  { route: 'week', label: 'שבוע', Icon: IconWeek },
  { route: 'table', label: 'טבלה', Icon: IconTable },
  { route: 'club', label: 'מועדון', Icon: IconClub },
  { route: 'agent', label: 'סוכן', Icon: IconAgent },
  { route: 'more', label: 'עוד', Icon: IconMore, also: ['news', 'goals', 'settings', 'editor', 'end'] },
];

export function BottomNav() {
  const cur = screen.value;
  const offers = view.value?.career.offers.length ?? 0;
  return (
    <nav class="bottom-nav" aria-label="ניווט ראשי">
      {TABS.map(({ route, label, Icon, also }) => {
        const active = cur === route || (also?.includes(cur) ?? false) || (route === 'week' && (cur === 'title' || cur === 'reveal' || cur === 'new'));
        return (
          <button key={route} type="button" aria-current={active ? 'page' : undefined} onClick={() => navigate(route)}>
            <Icon />
            <span>{route === 'week' && view.value?.phase === 'offseason' ? 'קיץ' : label}</span>
            {route === 'agent' && offers > 0 && <span class="badge num">{offers}</span>}
          </button>
        );
      })}
    </nav>
  );
}
