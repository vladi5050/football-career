// Root component: chooses the screen from (view.phase, hash route). Phase-driven screens take over full screen.
import { useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { busy, matchOutro, navDirection, reducedMotion, screen, uiSettings, view, type Route } from '../app/store';
import { BottomNav } from './components/BottomNav';
import { Toasts } from './components/Toast';
import { SidePanel } from './screens/SidePanel';
import { TitleScreen } from './screens/Title';
import { NewCareerScreen } from './screens/NewCareer';
import { StartRevealScreen } from './screens/StartReveal';
import { WeekScreen } from './screens/Week';
import { EventScreen } from './screens/Event';
import { PreMatchScreen } from './screens/PreMatch';
import { MatchScreen } from './screens/Match';
import { WeekEndScreen } from './screens/WeekEnd';
import { TableScreen } from './screens/Table';
import { ClubScreen } from './screens/Club';
import { AgentScreen } from './screens/Agent';
import { ContractScreen } from './screens/Contract';
import { NewsScreen } from './screens/News';
import { GoalsScreen } from './screens/Goals';
import { CareerEndScreen } from './screens/CareerEnd';
import { TeamEditorScreen } from './screens/TeamEditor';
import { SettingsScreen } from './screens/Settings';
import { MoreScreen } from './screens/More';

export type ScreenId = Route | 'event' | 'prematch' | 'match' | 'weekend' | 'negotiation' | 'retired';

const OFFSEASON_ROUTES: Route[] = ['table', 'club', 'agent', 'more', 'news', 'goals', 'end'];

/** Pure routing rule (exported for docs/tests). */
export function resolveScreen(phase: string | null, route: Route, outro: boolean, seenReveal: boolean): ScreenId {
  if (phase == null) return route === 'new' || route === 'editor' || route === 'settings' ? route : 'title';
  if (route === 'title') return 'title';
  if (route === 'new' && phase === 'retired') return 'new';
  if (route === 'editor' || route === 'settings') {
    if (phase === 'plan' || (phase === 'offseason' && route === 'settings')) return route;
  }
  if (outro) return 'match';
  switch (phase) {
    case 'event': return 'event';
    case 'prematch': return 'prematch';
    case 'match': return 'match';
    case 'postmatch':
    case 'weekend': return 'weekend';
    // Summer: the tabs stay open so offers, agent and renewal are reachable before the new season.
    case 'offseason': return OFFSEASON_ROUTES.includes(route) ? route : 'weekend';
    case 'negotiation': return 'negotiation';
    case 'retired': return 'retired';
  }
  if (route === 'reveal') return seenReveal ? 'week' : 'reveal';
  if (route === 'new') return 'week';
  return route;
}

const TABBED: ScreenId[] = ['week', 'table', 'club', 'agent', 'more', 'news', 'goals', 'end'];

export function App() {
  const v = view.value;
  const id = resolveScreen(v?.phase ?? null, screen.value, matchOutro.value, uiSettings.value.seenReveal);

  useEffect(() => {
    document.documentElement.classList.toggle('rm', reducedMotion.value);
  }, [reducedMotion.value]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);

  let el: JSX.Element;
  switch (id) {
    case 'title': el = <TitleScreen />; break;
    case 'new': el = <NewCareerScreen />; break;
    case 'reveal': el = <StartRevealScreen />; break;
    case 'week': el = <WeekScreen />; break;
    case 'event': el = <EventScreen />; break;
    case 'prematch': el = <PreMatchScreen />; break;
    case 'match': el = <MatchScreen />; break;
    case 'weekend': el = <WeekEndScreen />; break;
    case 'table': el = <TableScreen />; break;
    case 'club': el = <ClubScreen />; break;
    case 'agent': el = <AgentScreen />; break;
    case 'negotiation': el = <ContractScreen />; break;
    case 'news': el = <NewsScreen />; break;
    case 'goals': el = <GoalsScreen />; break;
    case 'retired':
    case 'end': el = <CareerEndScreen />; break;
    case 'editor': el = <TeamEditorScreen />; break;
    case 'settings': el = <SettingsScreen />; break;
    case 'more': el = <MoreScreen />; break;
    default: el = <WeekScreen />;
  }
  const summer = v?.phase === 'offseason';
  const tabbed = !!v && ((v.phase === 'plan' && TABBED.includes(id)) || (summer && (id === 'weekend' || id === 'settings' || TABBED.includes(id))));
  const side = tabbed && !summer && id !== 'table' && id !== 'news';
  const takeover = ['event', 'prematch', 'match', 'negotiation', 'retired'].includes(id) || (id === 'weekend' && !summer);
  return (
    <div class={`shell-row ${side ? 'has-side' : ''}`}>
      <div class={`shell ${tabbed ? 'with-nav' : ''}`} aria-busy={busy.value}>
        <div key={id} class={`screen-host screen-anim ${takeover ? 'takeover' : navDirection.value === 'back' ? 'back' : ''}`}>
          {el}
        </div>
        {tabbed && <BottomNav />}
      </div>
      {side && <SidePanel />}
      <Toasts />
    </div>
  );
}
