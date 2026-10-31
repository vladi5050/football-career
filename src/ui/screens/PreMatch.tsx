import { act, busy, view } from '../../app/store';
import { ROLE_HE, weekLabel } from '../i18n';
import { Crest } from '../components/Crest';
import { TapedCard } from '../components/TapedCard';
import { Bar } from '../components/Bars';
import { IconCrowd, IconFire, IconRain, IconWhistle } from '../components/Icons';

export function PreMatchScreen() {
  const v = view.value!;
  const fx = v.nextFixture;
  const club = v.club;
  if (!fx || !club) return <main class="screen" />;
  const role = v.player.contract?.role ?? 'prospect';
  const starter = v.live ? v.live.started : role === 'star' || role === 'starter' || v.player.form >= 0;
  const rain = v.live?.weather === 'rain';
  const hostile = !fx.home && (fx.derby || fx.opp.reputation > (club.reputation ?? 50));
  const rivalHere = v.rival && v.rival.clubId === fx.opp.id;
  const home = fx.home ? club : fx.opp;
  const away = fx.home ? fx.opp : club;

  return (
    <main class="screen has-actions prematch-screen">
      <div class="event-top">
        <span class="chip chip-orange">יום משחק</span>
        <span class="wall-label">{weekLabel(v)}</span>
      </div>

      <div class="matchup">
        {[home, away].map((c, i) => (
          <div key={c.id} class={`mu-team ${c.id === club.id ? 'mine' : ''}`}>
            <Crest spec={c.crest} colors={c.colors} name={c.name} short={c.short} size={84} />
            <span class="mu-name">{c.name}</span>
            <span class="mu-tag">{i === 0 ? 'בית' : 'חוץ'}</span>
          </div>
        ))}
        <span class="mu-vs display">נגד</span>
      </div>
      <p class="mu-venue wall-label">{home.stadium} · שבת 19:30</p>

      <div class="chips context-chips">
        {fx.derby && <span class="chip chip-red"><IconFire size={16} /> דרבי</span>}
        {rain && <span class="chip chip-blue"><IconRain size={16} /> גשם</span>}
        {hostile && <span class="chip chip-yellow"><IconCrowd size={16} /> קהל עוין</span>}
        {rivalHere && <span class="chip chip-paper">{v.rival!.name} בצד השני</span>}
        {!fx.derby && !rain && !hostile && !rivalHere && <span class="chip">ערב רגיל. הזדמנות להוכיח</span>}
      </div>

      <TapedCard tape="right" tilt="r" class="lineup-card">
        <div class="lineup-row">
          <div>
            <span class="label">ההרכב של המאמן</span>
            <div class="lineup-status">{starter ? 'פותח בהרכב' : 'על הספסל'}</div>
            <div class="muted">תפקיד בחוזה: {ROLE_HE[role]}</div>
          </div>
          <span class={`stamp-rect ${starter ? 'ok' : ''}`}>{starter ? 'בהרכב' : 'ספסל'}</span>
        </div>
        <p class="hand marker-red coach-line">{starter ? 'אתה פותח. תראה לי מה יש לך' : 'תיכנס בדקה 60. תהיה מוכן'}</p>
        <div class="meter-row">
          <span class="meter-label">כושר</span>
          <Bar value={v.player.fitness} color={v.player.fitness < 50 ? 'red' : 'green'} />
          <span class="meter-val num">{Math.round(v.player.fitness)}</span>
          <span class="meter-label">מורל</span>
          <Bar value={v.player.morale} color="blue" />
          <span class="meter-val num">{Math.round(v.player.morale)}</span>
        </div>
      </TapedCard>

      <div class="action-bar">
        <button class="btn btn-primary" type="button" disabled={busy.value} onClick={() => act({ type: 'startMatch' })}>
          <IconWhistle size={22} /> צא למגרש
        </button>
      </div>
    </main>
  );
}
