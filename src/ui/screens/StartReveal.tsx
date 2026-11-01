import { useEffect, useState } from 'preact/hooks';
import { navigate, reducedMotion, setUiSetting, view } from '../../app/store';
import { POS_HE, START_KIND_HE } from '../i18n';
import { Crest } from '../components/Crest';
import { ShirtOnHook, patternFor } from '../components/Shirt';
import { TapedCard } from '../components/TapedCard';

/** "The scout saw you" scene: reveals where the engine started the career. */
export function StartRevealScreen() {
  const v = view.value!;
  const [stage, setStage] = useState(reducedMotion.value ? 3 : 0);
  useEffect(() => {
    if (stage >= 3) return;
    const t = setTimeout(() => setStage((s) => s + 1), stage === 0 ? 1100 : 900);
    return () => clearTimeout(t);
  }, [stage]);
  const kind = START_KIND_HE[v.career.startKind];
  const club = v.club;
  const done = () => {
    setUiSetting('seenReveal', true);
    navigate('week', { replace: true });
  };
  return (
    <main class="screen reveal-screen has-actions" onClick={() => stage < 3 && setStage(3)}>
      <div class="reveal-sky" aria-hidden="true">
        <span class="floodlight l" />
        <span class="floodlight r" />
      </div>
      <p class="reveal-line typewriter">ערב חמישי. מגרש שכונתי. בן 15.</p>
      {stage >= 1 && <p class="reveal-line strong rise">הסקאוט ראה אותך משחק.</p>}

      {stage >= 2 && club && (
        <div class="reveal-card-wrap">
          <TapedCard tape="both" class="reveal-card flip-in">
            <span class="label">התחלת הקריירה</span>
            <div class="reveal-kind display">{kind.title}</div>
            <div class="reveal-club">
              <Crest spec={club.crest} colors={club.colors} name={club.name} short={club.short} size={76} />
              <div>
                <div class="reveal-club-name">{club.name}</div>
                <div class="muted">
                  {club.leagueName} · {club.country}
                </div>
              </div>
            </div>
            <p class="reveal-text">{kind.line}</p>
          </TapedCard>
        </div>
      )}

      {stage >= 3 && club && (
        <div class="reveal-shirt rise">
          <ShirtOnHook name={v.player.name.split(' ').slice(-1)[0] ?? ''} number={v.player.shirt} colors={club.colors} pattern={patternFor(club.crest[1])} width={132} swing />
          <div class="reveal-tag">
            <b>{v.player.name}</b>
            <span>{POS_HE[v.player.pos]} · מספר {v.player.shirt}</span>
          </div>
        </div>
      )}

      <div class="action-bar">
        <button class="btn btn-primary" type="button" onClick={(e) => { e.stopPropagation(); done(); }}>
          {stage >= 3 ? 'לחדר ההלבשה' : 'דלג'}
        </button>
      </div>
    </main>
  );
}
