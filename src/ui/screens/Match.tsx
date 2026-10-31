import { useEffect, useRef, useState } from 'preact/hooks';
import type { LiveMatch, MomentKind, MomentResult, MomentSpec } from '../../core/types';
import { act, busy, matchOutro, reducedMotion, uiSettings, view } from '../../app/store';
import { Crest } from '../components/Crest';
import { Confetti } from '../components/Confetti';
import { IconFF, IconPlay } from '../components/Icons';
import { FallbackMoment } from '../components/FallbackMoment';

export const MOMENT_HE: Record<MomentKind, string> = {
  shot: 'בעיטה', one_on_one: 'אחד על אחד מול השוער', header: 'נגיחה', dribble: 'דריבל מול המגן', through_ball: 'מסירת עומק',
  long_shot: 'בעיטה מרחוק', interception: 'חטיפה', tackle: 'תיקול', block: 'חסימה', clearance: 'הרחקה', save: 'הצלה',
  rush_out: 'יציאה מהשער', penalty: 'פנדל', free_kick: 'בעיטה חופשית', cross: 'הגבהה לרחבה',
};

type PlayMoment = (host: HTMLElement, spec: MomentSpec, opts: { reducedMotion?: boolean; asKeeper?: boolean; colors?: { user: [string, string]; opp: [string, string] } }) => Promise<MomentResult>;
// Guarded lazy import: the build works even if src/match is missing. Pixi loads only on first moment.
const matchModules = import.meta.glob('../../match/index.{ts,tsx}');
async function loadPlayMoment(): Promise<PlayMoment | null> {
  const loader = Object.values(matchModules)[0];
  if (!loader) return null;
  try {
    const mod = (await loader()) as { playMoment?: PlayMoment };
    return mod.playMoment ?? null;
  } catch (e) {
    console.warn('match module failed to load', e);
    return null;
  }
}

export function MatchScreen() {
  const v = view.value!;
  const lastLive = useRef<LiveMatch | null>(null);
  if (v.live) lastLive.current = v.live;
  const live = v.live ?? lastLive.current;
  const inMatch = v.phase === 'match';
  const pending = inMatch && live ? live.moments[live.pendingMomentIndex] ?? null : null;
  const target = pending ? pending.minute : 90;

  const [clock, setClock] = useState(0);
  const [fast, setFast] = useState(false);
  const [playing, setPlaying] = useState<null | 'pixi' | 'fallback'>(null);
  const [goalFlash, setGoalFlash] = useState(0);
  const fallbackDone = useRef<((r: MomentResult) => void) | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const autoSent = useRef<number>(-1);
  const restSent = useRef(false);
  const simAfter = useRef(false);
  const goals = useRef(live?.userGoals ?? 0);
  const shownScore = useRef<[number, number]>([0, 0]);

  // tick the broadcast clock toward the next stop
  useEffect(() => {
    if (clock >= target || playing) return;
    if (reducedMotion.value) {
      setClock(target);
      return;
    }
    const t = setTimeout(() => setClock((c) => Math.min(target, c + (fast ? 3 : 1))), fast ? 30 : 85);
    return () => clearTimeout(t);
  }, [clock, target, playing, fast]);

  // celebrate a user goal
  useEffect(() => {
    if (!live) return;
    if (live.userGoals > goals.current) {
      goals.current = live.userGoals;
      setGoalFlash(Date.now());
      navigator.vibrate?.([30, 40, 60]);
    }
  }, [live?.userGoals]);

  // auto-moments setting: resolve without playing
  useEffect(() => {
    if (pending && clock >= pending.minute && uiSettings.value.autoMoments && autoSent.current !== pending.id && !busy.value) {
      autoSent.current = pending.id;
      void act({ type: 'momentResult', result: { momentId: pending.id, success: false, quality: 0.5, skipped: true } });
    }
  }, [pending?.id, clock]);

  // the engine may wait for us to finish the match after the last moment
  useEffect(() => {
    if (inMatch && !pending && clock >= 90 && !restSent.current) {
      restSent.current = true;
      void act({ type: 'simRestOfMatch' });
    }
  }, [inMatch, pending, clock]);

  if (!live) return <main class="screen" />;

  const club = v.club!;
  const opp = v.nextFixture?.opp;
  const homeIsUser = live.isHome;
  const home = homeIsUser ? club : opp;
  const away = homeIsUser ? opp : club;
  const visibleHl = live.highlights.filter((h) => h.minute <= clock);
  const goalsAll = live.highlights.filter((h) => h.kind === 'goal').length;
  const goalsSeen = visibleHl.filter((h) => h.kind === 'goal').length;
  if (goalsSeen >= goalsAll) shownScore.current = [live.score[0], live.score[1]];
  const finalScore = !inMatch && v.lastWeekReport?.result ? ([v.lastWeekReport.result.hg, v.lastWeekReport.result.ag] as [number, number]) : null;
  const score = clock >= 90 && finalScore ? finalScore : shownScore.current;
  const fullTime = !inMatch && clock >= 90;
  const atMoment = !!pending && clock >= pending.minute && !playing && !uiSettings.value.autoMoments;

  const sendResult = (result: MomentResult) => act({ type: 'momentResult', result });

  const play = async () => {
    if (!pending || !hostRef.current) return;
    const spec = pending;
    const fn = await loadPlayMoment();
    let result: MomentResult;
    if (fn) {
      setPlaying('pixi');
      try {
        const colors = v.club && opp ? { user: v.club.colors, opp: opp.colors } : undefined;
        result = await fn(hostRef.current, spec, { reducedMotion: reducedMotion.value, asKeeper: v.player.pos === 'GK', colors });
      } catch (e) {
        console.error(e);
        result = { momentId: spec.id, success: false, quality: 0.5, skipped: true };
      }
    } else {
      setPlaying('fallback');
      result = await new Promise<MomentResult>((res) => (fallbackDone.current = res));
    }
    setPlaying(null);
    await sendResult(result);
    if (simAfter.current) {
      simAfter.current = false;
      await act({ type: 'simRestOfMatch' });
    }
  };
  const skipMoment = () => pending && sendResult({ momentId: pending.id, success: false, quality: 0.5, skipped: true });
  const simRest = async () => {
    setFast(true);
    if (playing) {
      // ask the moment player to bail out; play() then finishes the match
      simAfter.current = true;
      restSent.current = true;
      if (playing === 'fallback') fallbackDone.current?.({ momentId: pending?.id ?? 0, success: false, quality: 0.5, skipped: true });
      else hostRef.current?.dispatchEvent(new Event('moment-skip'));
      return;
    }
    restSent.current = true;
    await act({ type: 'simRestOfMatch' });
  };

  return (
    <main class="screen match-screen has-actions">
      <div class="scorebug" role="status" aria-live="polite">
        <span class="sb-live">{fullTime ? 'סיום' : <><i class="live-dot" /> שידור</>}</span>
        <div class="sb-main">
          <div class="sb-team">
            {home && <Crest spec={home.crest} colors={home.colors} name={home.name} short={home.short} size={24} />}
            <span>{home?.short}</span>
          </div>
          <span class="sb-score num">
            {score[0]}
            <i>-</i>
            {score[1]}
          </span>
          <div class="sb-team">
            <span>{away?.short}</span>
            {away && <Crest spec={away.crest} colors={away.colors} name={away.name} short={away.short} size={24} />}
          </div>
        </div>
        <span class="sb-clock num">{fullTime ? '90' : clock}'</span>
      </div>

      <div class="pitch">
        <div class="pitch-markings" aria-hidden="true" />
        <div id="moment-host" ref={hostRef} class={playing === 'pixi' ? 'active' : ''}>
          {playing === 'fallback' && pending && <FallbackMoment spec={pending} onDone={(r) => fallbackDone.current?.(r)} />}
        </div>

        {!playing && !atMoment && !fullTime && (
          <div class="pitch-ticker" key={visibleHl.length}>
            {visibleHl.length ? visibleHl[visibleHl.length - 1]!.text : live.started ? 'שריקת פתיחה. אתה על הדשא.' : 'אתה על הספסל. מחכה להזדמנות.'}
          </div>
        )}

        {atMoment && pending && (
          <div class="moment-card rise">
            <span class="mc-kicker">רגע מפתח</span>
            <div class="mc-title display">{MOMENT_HE[pending.kind]}</div>
            <div class="mc-stakes">{pending.stakes || `דקה ${pending.minute}`}</div>
            <div class="mc-opp">מולך: {pending.opponentName}</div>
            <div class="chips" style={{ justifyContent: 'center' }}>
              {pending.context.derby && <span class="chip chip-red">דרבי</span>}
              {pending.context.rain && <span class="chip chip-blue">גשם</span>}
              {pending.context.hostileCrowd && <span class="chip chip-yellow">קהל עוין</span>}
              {pending.context.lateClose && <span class="chip chip-orange">סיום צמוד</span>}
              {pending.context.rivalInvolved && <span class="chip chip-paper">היריב שלך</span>}
            </div>
            <div class="mc-actions">
              <button class="btn btn-primary" type="button" onClick={play} disabled={busy.value}>
                <IconPlay size={20} /> שחק את הרגע
              </button>
              <button class="btn btn-ghost btn-sm" type="button" onClick={skipMoment} disabled={busy.value}>
                סמלץ
              </button>
            </div>
          </div>
        )}

        {fullTime && (
          <div class="moment-card ft-card rise">
            <span class="mc-kicker">שריקת סיום</span>
            <div class="mc-title display num">
              {score[0]}-{score[1]}
            </div>
            <div class="mc-stakes">
              {(() => {
                const mine = homeIsUser ? score[0] - score[1] : score[1] - score[0];
                return mine > 0 ? 'ניצחון!' : mine === 0 ? 'תיקו' : 'הפסד';
              })()}
            </div>
          </div>
        )}
        {goalFlash > 0 && (
          <div class="goal-flash display" key={goalFlash} aria-hidden="true">
            גול!
          </div>
        )}
      </div>
      {goalFlash > 0 && <Confetti key={goalFlash} seed={goalFlash % 97} />}

      <section class="feed" aria-label="אירועי המשחק">
        {[...visibleHl].reverse().map((h, i) => (
          <div key={`${h.minute}-${i}`} class={`feed-row k-${h.kind}`}>
            <span class="feed-min num">{h.minute}'</span>
            <span class="feed-text">{h.text}</span>
          </div>
        ))}
        {visibleHl.length === 0 && <div class="feed-row muted-wall">המשחק מתחיל...</div>}
      </section>

      <div class="action-bar">
        {fullTime ? (
          <button class="btn btn-primary" type="button" onClick={() => (matchOutro.value = false)}>
            לסיכום השבוע
          </button>
        ) : (
          <button class="btn btn-ink" type="button" onClick={simRest} disabled={(busy.value && !playing) || !inMatch}>
            <IconFF size={20} /> סמלץ את המשחק
          </button>
        )}
      </div>
    </main>
  );
}
