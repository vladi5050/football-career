import { useState } from 'preact/hooks';
import { act, busy, navigate, view } from '../../app/store';
import { ATTR_HE, weekLabel } from '../i18n';
import { Crest } from '../components/Crest';
import { TapedCard } from '../components/TapedCard';
import { CountUp } from '../components/CountUp';
import { ProgressNearGoal, Bar } from '../components/Bars';
import { RatingStamp } from '../components/Rating';
import { Confetti } from '../components/Confetti';
import { Modal } from '../components/Modal';
import { clubLookup, contractExpired, renewalBlocked } from '../viewExtras';
import { SkipCard } from '../components/SkipSummary';

const clubFor = clubLookup;

export function WeekEndScreen() {
  const v = view.value!;
  const rep = v.lastWeekReport;
  const offseason = v.phase === 'offseason';
  const live = v.live;
  // Youth (U19) matches don't produce a senior result: build the card from the live match instead.
  const youth = !rep?.result && !!live?.youth && live.finished !== false;
  const res = rep?.result ?? (youth && live ? { home: live.fixture.home, away: live.fixture.away, hg: live.fixture.hg, ag: live.fixture.ag } : null);
  const home = res ? clubFor(v, res.home) : null;
  const away = res ? clubFor(v, res.away) : null;
  const userHome = res ? res.home === v.club?.id : true;
  const diff = res ? (userHome ? res.hg - res.ag : res.ag - res.hg) : 0;
  const rating = rep?.userRating ?? null;
  const expired = offseason && contractExpired(v);
  const offers = v.career.offers;
  const [askNext, setAskNext] = useState(false);
  const blocked = renewalBlocked(v);
  const skip = v.skip && v.skip.at !== 'plan' ? v.skip : null;
  // UX-03: rows that would read "+0.0" are noise
  const gains = (rep?.gains ?? []).filter((g) => Math.round((g.after - g.before) * 10) >= 1);
  const nextSeason = () => {
    if (expired) setAskNext(true);
    else void act({ type: 'finishWeek' });
  };

  return (
    <main class={`screen has-actions weekend-screen ${offseason ? 'has-nav' : ''}`}>
      {rep?.headline && (
        <div class="newspaper rise">
          <div class="np-mast">
            <span>הבועט</span>
            <span class="np-ed">{weekLabel(v)} · מהדורת מוצ״ש</span>
          </div>
          <h1 class="np-headline">{rep.headline}</h1>
        </div>
      )}

      {skip && <SkipCard skip={skip} />}

      {res && home && away && (
        <TapedCard tape="left" class={`result-card ${youth ? 'is-youth' : ''}`}>
          {youth && <span class="chip chip-blue u19-chip">U19 · משחק נוער</span>}
          <div class="rc-row">
            <div class="rc-team">
              <Crest spec={home.crest} colors={home.colors} name={home.name} short={home.short} size={46} />
              <span>{home.short}{youth && <small class="youth-suffix"> נוער</small>}</span>
            </div>
            <div class="rc-score display num">
              {/* LTR digits under an RTL row: home sits on the right, so its goals go on the right too */}
              {res.ag}-{res.hg}
            </div>
            <div class="rc-team">
              <Crest spec={away.crest} colors={away.colors} name={away.name} short={away.short} size={46} />
              <span>{away.short}{youth && <small class="youth-suffix"> נוער</small>}</span>
            </div>
            {rating != null && (
              <div class="rc-stamp">
                <RatingStamp value={rating} />
              </div>
            )}
          </div>
          <div class="rc-line">
            <span class={`chip ${diff > 0 ? 'chip-green' : diff < 0 ? 'chip-red' : 'chip-ink'}`}>{diff > 0 ? 'ניצחון' : diff < 0 ? 'הפסד' : 'תיקו'}{youth ? ' בנוער' : ''}</span>
            {rep && rep.userGoals > 0 && <span class="chip chip-orange">{rep.userGoals === 1 ? 'שער' : `${rep.userGoals} שערים`}</span>}
            {rep && rep.userAssists > 0 && <span class="chip chip-blue">{rep.userAssists === 1 ? 'בישול' : `${rep.userAssists} בישולים`}</span>}
          </div>
        </TapedCard>
      )}

      {gains.length > 0 && (
        <section class="paper gains">
          <h2 class="paper-title">מה השתפר</h2>
          {gains.map((g, i) => {
            const crossed = Math.floor(g.after) > Math.floor(g.before);
            return (
              <div key={g.key} class={`gain-row ${crossed ? 'crossed' : ''}`}>
                <span class="gain-name">{ATTR_HE[g.key]}</span>
                <Bar value={(g.after % 1) * 100} max={100} color={crossed ? undefined : 'blue'} />
                <span class="gain-val display">
                  <CountUp from={Math.floor(g.before)} to={Math.floor(g.after)} delay={400 + i * 250} />
                </span>
                <span class="gain-delta num">+{(g.after - g.before).toFixed(1)}</span>
              </div>
            );
          })}
          {rep?.trainingWhy && <p class="training-why">{rep.trainingWhy}</p>}
        </section>
      )}

      {rep && gains.length === 0 && (
        <p class="gains-note">
          {rep.gainsNote ?? 'השבוע בלי שינוי שרואים במספרים. העבודה מצטברת.'}
          {rep.trainingWhy && <span class="training-why-inline">{rep.trainingWhy}</span>}
        </p>
      )}

      {rep && rep.autoEvents && rep.autoEvents.length > 0 && (
        <section class="paper slim auto-events" aria-label="החלטות שהתקבלו בשבוע מהיר">
          <h3 class="auto-events-title">בשבוע המהיר החלטנו בשבילך</h3>
          <ul>
            {rep.autoEvents.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>
      )}

      {rep && rep.nearGoals.length > 0 && (
        <section class="near-list">
          {rep.nearGoals.slice(0, 2).map((n) => (
            <div key={n.text} class="paper slim">
              {/* Fill is exactly progress/target; the engine keeps both in the same unit. */}
              <ProgressNearGoal text={n.text} progress={n.progress} target={n.target} />
            </div>
          ))}
        </section>
      )}

      {offseason && (
        <section class="paper summer-card" aria-labelledby="summer-title">
          <h2 class="paper-title" id="summer-title">החלטות הקיץ</h2>
          {v.player.contract && (
            <p class={`summer-contract ${expired ? 'expired' : ''}`}>
              {expired ? <b>החוזה שלך נגמר.</b> : <b>החוזה שלך בתוקף עד סוף עונה {v.player.contract.endSeason}.</b>}{' '}
              {expired ? 'אפשר לבקש חידוש, לבחור הצעה, או לתת למועדון להחליט.' : 'אפשר לבדוק הצעות לפני שהעונה מתחילה.'}
            </p>
          )}
          <div class="summer-actions">
            <button class="btn btn-ink" type="button" disabled={busy.value} onClick={() => navigate('agent')}>
              {offers.length ? `הצעות על השולחן (${offers.length})` : 'לסוכן'}
            </button>
            {v.club && (
              <button class={`btn ${expired && !blocked ? 'btn-primary' : ''}`} type="button" disabled={busy.value || blocked} onClick={() => act({ type: 'requestRenewal' })}>
                לבקש חידוש ב{v.club.name}
              </button>
            )}
          </div>
          {blocked && <p class="summer-note">השיחות על חידוש התפוצצו. בחלון הזה {v.club?.name} לא יחזרו לשולחן.</p>}
        </section>
      )}

      {rep && rep.meanwhile.length > 0 && (
        <section>
          <h2 class="section-title">בינתיים בליגה</h2>
          <ul class="meanwhile">
            {rep.meanwhile.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      {rep && rep.openLoops.length > 0 && (
        <TapedCard tape="center" tilt="r" class="loops">
          <h2 class="paper-title">מה מחכה לך</h2>
          <ol>
            {rep.openLoops.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ol>
        </TapedCard>
      )}

      {!rep && <div class="paper empty">השבוע נגמר.</div>}

      {rep && rep.userGoals > 0 && <Confetti seed={v.absWeek + 3} />}

      <div class="action-bar">
        <button class="btn btn-primary" type="button" disabled={busy.value} onClick={() => (offseason ? nextSeason() : act({ type: 'finishWeek' }))}>
          {offseason ? 'לעונה הבאה' : 'לשבוע הבא'}
        </button>
      </div>

      <Modal
        open={askNext}
        title="לצאת לעונה בלי חוזה חדש?"
        onClose={() => setAskNext(false)}
        actions={
          <>
            <button class="btn" type="button" onClick={() => { setAskNext(false); navigate('agent'); }}>
              לבדוק הצעות
            </button>
            <button class="btn btn-primary" type="button" onClick={() => { setAskNext(false); void act({ type: 'finishWeek' }); }}>
              המועדון יחליט
            </button>
          </>
        }
      >
        <p>החוזה שלך נגמר ולא חתמת על כלום. אם תמשיך, המועדון יחליט בשבילך: חידוש קצר, או מעבר למי שהציע.</p>
      </Modal>
    </main>
  );
}
