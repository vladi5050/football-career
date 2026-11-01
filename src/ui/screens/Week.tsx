import { useEffect, useRef, useState } from 'preact/hooks';
import type { PlanSlot, View, WeekPlan } from '../../core/types';
import { act, busy, view } from '../../app/store';
import { ATTR_HE, DAYS, OTHER_SLOTS, POS_KEYS, SLOT_INFO, firstName, nearestAttrGoal, trainingSlots, type SlotInfo } from '../i18n';
import { TopBar } from '../components/TopBar';
import { Magnet } from '../components/Magnet';
import { SlotGlyph, IconBolt } from '../components/Icons';
import { Crest } from '../components/Crest';
import { Bar, ProgressNearGoal } from '../components/Bars';

type Plan = (PlanSlot | null)[];

const REHAB: SlotInfo = { label: 'שיקום', short: 'שיקום', color: 'green', glyph: 'rehab', hint: '+כושר', cost: 4 };
function weeksHe(n: number): string {
  return n === 1 ? 'עוד שבוע אחד' : `עוד ${n} שבועות`;
}

/**
 * The coach's marker note: reacts to the week (injury, fatigue, last result, playing time, the opponent, the table,
 * the coach's mood with you, near goals, contract). Several phrasings per situation, rotated by week, so it never sits still.
 */
function coachNote(v: View): string {
  const p = v.player;
  const pick = (lines: string[]) => lines[(v.absWeek * 7 + p.id) % lines.length]!;
  const rep = v.lastWeekReport;
  const myId = v.club?.id;
  const res = rep?.result && myId != null ? (rep.result.home === myId ? rep.result.hg - rep.result.ag : rep.result.ag - rep.result.hg) : null;
  const rank = v.table.findIndex((r) => r.clubId === myId) + 1;
  const n = v.table.length;
  const opp = v.nextFixture?.opp;
  const oppRank = opp ? v.table.findIndex((r) => r.clubId === opp.id) + 1 : 0;
  const oppName = opp?.name ?? 'היריבה';
  const rel = v.coach?.relation ?? 0;
  const role = p.contract?.role;
  const apps = p.stats.apps;
  const week = v.season.week;
  const goal = nearestAttrGoal(v);

  if (p.injury) return pick([`קודם כל להחלים. ${p.injury.weeksLeft > 1 ? `עוד ${p.injury.weeksLeft} שבועות` : 'עוד שבוע'} ואתה איתנו`, 'אל תמהר לחזור. פציעה שנייה זה גרוע יותר', 'שיקום כל יום. אני רוצה אותך חזק כשתחזור']);
  if (p.fitness < 45) return pick(['אתה גמור. תנוח השבוע, זו פקודה', 'הרגליים שלך כבדות. יום מנוחה לפני השבת', 'אני רואה שאתה עייף. פחות חדר כושר השבוע']);
  if (v.nextFixture?.derby) return pick([`דרבי מול ${oppName}. אף אחד לא נח על זה`, 'דרבי בשבת. רגליים טריות וראש קר', `שבוע של דרבי. מול ${oppName} לא מפסידים`]);
  if (rep && rep.userRating != null && rep.userRating >= 8) return pick([`${rep.userRating.toFixed(1)} בשבת. ככה ממשיכים`, 'משחק גדול. עכשיו להוכיח שזה לא חד-פעמי', 'כולם מדברים עליך. אל תתחיל להאמין להם']);
  if (rep && rep.userRating != null && rep.userRating > 0 && rep.userRating < 5.5) return pick(['שבת חלשה. השבוע מתקנים באימונים', 'זה לא היה אתה בשבת. ראש למעלה ולעבודה', `${rep.userRating.toFixed(1)} זה לא מספיק. אני מצפה ליותר`]);
  if (res != null && res < 0 && rank > 0 && rank > n - 3) return pick(['אנחנו בתחתית. כל נקודה שווה זהב', 'עוד הפסד ואנחנו בבעיה. מכאן יוצאים ביחד', `מול ${oppName} חייבים לקחת משהו`]);
  if (res != null && res < 0) return pick(['הפסדנו. לא מתבכיינים, מתקנים', 'הפסד כואב. השבוע עובדים כפול', `שוכחים את השבת. ${oppName} זה המשחק הבא`]);
  if (rank === 1 && week > 4) return pick(['אנחנו בפסגה. עכשיו כולם רוצים לנצח אותנו', 'מקום ראשון לא שווה כלום עכשיו. ממשיכים', `גם מול ${oppName} משחקים כמו מוליכה`]);
  if (role === 'backup' || role === 'prospect' || (week > 6 && apps < week / 4)) return pick([`אתה רוצה דקות? תראה לי ב${goal ? ATTR_HE[goal.key] : 'אימונים'}`, 'הדלת להרכב פתוחה. תעבוד ותדפוק עליה', 'אני רואה אותך באימונים. עוד קצת ואתה בפנים']);
  if (rel < -25) return pick(['אני לא מרוצה ממך. תוכיח לי שטעיתי', 'היחס שלך לא מקובל עליי. תתחיל לעבוד', 'יש לך הרבה מה להוכיח לי']);
  if (p.morale < 35) return pick(['ראש למעלה. כולם עוברים תקופות כאלה', 'אני עדיין מאמין בך. תאמין גם אתה', 'בוא נדבר אחרי האימון. משהו מטריד אותך']);
  if (opp && oppRank > 0 && rank > 0 && oppRank < rank - 4) return pick([`${oppName} חזקים מאיתנו. משמעת וסבלנות`, `מול ${oppName} צריך לרוץ פי שניים`, `אף אחד לא נותן לנו סיכוי מול ${oppName}. מצוין`]);
  if (opp && oppRank > 0 && rank > 0 && oppRank > rank + 4) return pick([`${oppName} מתחתינו. אסור לזלזל`, `משחק שחייבים לנצח. מול ${oppName} לוקחים שלוש`, 'משחקים כאלה מפסידים כשבאים שאננים']);
  if (p.form >= 4) return pick(['ככה ממשיכים. אל תשתנה', 'אתה בכושר שיא. תשמור על זה', 'רואים עליך את הביטחון. עוד שבוע כזה']);
  if (p.contract && p.contract.endSeason <= v.season.number && week > v.season.totalWeeks - 10) return pick(['החוזה שלך נגמר בקיץ. עכשיו זה הזמן להרשים', 'ההנהלה מסתכלת עליך. סוף עונה חזק וזה בכיס']);
  if (goal && goal.target - goal.value <= 1.5) return pick([`עוד קצת ב${ATTR_HE[goal.key]} ואתה ב-${goal.target}`, `${ATTR_HE[goal.key]}: אתה כמעט שם. אימון אחד ועוד אחד`]);
  if (week <= 2) return pick(['עונה חדשה, דף חדש. תראה לי מה יש לך', 'פתיחת עונה. כל אחד מתחיל מאפס']);
  const k = POS_KEYS[p.pos][(v.absWeek) % POS_KEYS[p.pos].length]!;
  return pick([`תעבוד על ה${ATTR_HE[k]}. ככה נכנסים להרכב`, `השבוע אני רוצה לראות ${ATTR_HE[k]} באימונים`, `${oppName} בשבת. תגיע מוכן`]);
}

export function WeekScreen() {
  const v = view.value!;
  const inj = v.player.injury;
  const rehabSlot = trainingSlots(v.player.pos)[0]!;
  // Injured: training days become rehab (the engine turns train_* into +fitness); no gym.
  const infoOf = (s: PlanSlot): SlotInfo => (inj && s.startsWith('train_') ? REHAB : SLOT_INFO[s]);
  const [plan, setPlan] = useState<Plan>(() => {
    const p: Plan = v.career.lastPlan ? [...v.career.lastPlan] : [null, null, null];
    return inj ? (p.map((x) => (x == null ? x : x.startsWith('train_') ? rehabSlot : x === 'extra_gym' ? 'rest' : x)) as Plan) : p;
  });
  const [selected, setSelected] = useState<PlanSlot | null>(null);
  const [snapAt, setSnapAt] = useState<{ i: number; k: number } | null>(null);
  const [drag, setDrag] = useState<{ slot: PlanSlot; x: number; y: number; from: number | null; over: number | null } | null>(null);
  const suppressClick = useRef(false);
  const dragRef = useRef<{ slot: PlanSlot; sx: number; sy: number; from: number | null; started: boolean; id: number } | null>(null);

  const place = (i: number, slot: PlanSlot | null) => {
    setPlan((p) => {
      const n = [...p];
      n[i] = slot;
      return n;
    });
    if (slot) setSnapAt({ i, k: Date.now() });
    navigator.vibrate?.(12);
  };

  // ---------------------------------------------------------------- pointer drag (works for touch + mouse)
  useEffect(() => {
    const slotAt = (x: number, y: number): number | null => {
      const el = document.elementFromPoint(x, y)?.closest('[data-slot]') as HTMLElement | null;
      return el ? Number(el.dataset.slot) : null;
    };
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.id) return;
      if (!d.started && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      d.started = true;
      e.preventDefault();
      setDrag({ slot: d.slot, x: e.clientX, y: e.clientY, from: d.from, over: slotAt(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.id) return;
      dragRef.current = null;
      if (d.started) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 60);
        const target = slotAt(e.clientX, e.clientY);
        if (target != null) {
          if (d.from != null && d.from !== target) {
            setPlan((p) => {
              const n = [...p];
              n[d.from!] = p[target] ?? null;
              n[target] = d.slot;
              return n;
            });
            setSnapAt({ i: target, k: Date.now() });
          } else if (d.from == null) place(target, d.slot);
        } else if (d.from != null) place(d.from, null);
        setSelected(null);
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const startDrag = (e: PointerEvent, slot: PlanSlot, from: number | null) => {
    dragRef.current = { slot, sx: e.clientX, sy: e.clientY, from, started: false, id: e.pointerId };
  };

  const tapTray = (slot: PlanSlot) => {
    if (suppressClick.current) return;
    // tap-to-place: fill the first empty day, otherwise select for a later tap on a day
    const empty = plan.findIndex((p) => p == null);
    if (selected === slot) return setSelected(null);
    if (empty >= 0 && selected == null) return place(empty, slot);
    setSelected(slot);
  };
  const tapDay = (i: number) => {
    if (suppressClick.current) return;
    if (selected) {
      place(i, selected);
      setSelected(null);
    } else if (plan[i]) place(i, null);
  };

  const full = plan.every((p) => p != null);
  const projected = Math.max(0, Math.min(100, v.player.fitness + plan.reduce((s, p) => s + (p ? infoOf(p).cost : 0), 0)));
  const ng = nearestAttrGoal(v);
  const fx = v.nextFixture;
  const coach = v.coach;
  const missing = plan.filter((p) => p == null).length;

  const closeWeek = () => full && act({ type: 'setPlan', plan: plan as WeekPlan });
  const quick = () => act({ type: 'quickWeek' });

  return (
    <main class="screen has-nav has-actions week-screen">
      <TopBar v={v} title={v.club?.name ?? 'השבוע'} />

      {inj && (
        <div class="injury-banner" role="status">
          <span class="ib-cross" aria-hidden="true">+</span>
          <div>
            <b>פצוע: {weeksHe(inj.weeksLeft)}</b>
            <span>{inj.kind}. האימונים הופכים לשיקום, ובשבת אתה ביציע.</span>
          </div>
        </div>
      )}

      <div class="board-wrap">
        <div class="board week-board">
          <div class="wb-head">
            <span class="board-title">תוכנית השבוע</span>
            <span class="wb-hint">{selected ? `הקש על יום כדי לשים "${infoOf(selected).short}"` : 'גרור מגנט ליום, או הקש עליו'}</span>
          </div>
          <div class="days">
            {DAYS.map((d, i) => {
              const s = plan[i];
              const info = s ? infoOf(s) : null;
              const over = drag?.over === i;
              return (
                <button
                  key={d}
                  type="button"
                  class={`day ${s ? 'filled' : ''} ${over ? 'over' : ''} ${selected && !over ? 'target' : ''}`}
                  data-slot={i}
                  onClick={() => tapDay(i)}
                  aria-label={`${d}: ${info ? info.label : 'ריק'}`}
                >
                  <span class="day-name">{d}</span>
                  <span class="day-drop">
                    {info && s ? (
                      <span class="day-mag" onPointerDown={(e) => startDrag(e as unknown as PointerEvent, s, i)} style={{ opacity: drag?.from === i ? 0.25 : 1 }}>
                        <Magnet key={snapAt?.i === i ? snapAt.k : 0} color={info.color} size={46} snap={snapAt?.i === i}>
                          <SlotGlyph glyph={info.glyph} />
                        </Magnet>
                      </span>
                    ) : (
                      <span class="day-plus" aria-hidden="true">+</span>
                    )}
                  </span>
                  <span class="day-label">{info ? info.short : 'ריק'}</span>
                  {info && <span class={`day-hint ${info.cost < 0 ? 'neg' : 'pos'}`}>{info.hint}</span>}
                </button>
              );
            })}
          </div>

          {fx && v.club && (
            <div class="sat-card">
              <span class="sat-day">שבת</span>
              <div class="sat-teams">
                <div class="sat-team">
                  <Crest spec={v.club.crest} colors={v.club.colors} name={v.club.name} short={v.club.short} size={34} />
                  <span>{v.club.short}</span>
                </div>
                <span class="sat-vs">{fx.home ? 'בית' : 'חוץ'}</span>
                <div class="sat-team">
                  <Crest spec={fx.opp.crest} colors={fx.opp.colors} name={fx.opp.name} short={fx.opp.short} size={34} />
                  <span>{fx.opp.short}</span>
                </div>
              </div>
              {fx.derby && <span class="chip chip-red">דרבי</span>}
            </div>
          )}

          {coach && (
            <p class="coach-note hand marker-red">
              {coachNote(v)}
              <span class="sig">המאמן, {firstName(coach.name)}</span>
            </p>
          )}
        </div>
        <div class="board-tray" aria-hidden="true">
          <span class="marker m-red" />
          <span class="marker m-blue" />
        </div>
      </div>

      <section class="tray" aria-label="מגנטים">
        <div class="tray-scroll">
          {(inj
            ? [rehabSlot, ...OTHER_SLOTS.filter((x) => x !== 'extra_gym')]
            : [...trainingSlots(v.player.pos).slice(0, 4), ...OTHER_SLOTS, ...trainingSlots(v.player.pos).slice(4)]
          ).map((s) => {
            const info = infoOf(s);
            return (
              <button
                key={s}
                type="button"
                class={`tray-item ${selected === s ? 'sel' : ''}`}
                onPointerDown={(e) => startDrag(e as unknown as PointerEvent, s, null)}
                onClick={() => tapTray(s)}
                aria-pressed={selected === s}
              >
                <Magnet color={info.color} size={44} lifted={selected === s}>
                  <SlotGlyph glyph={info.glyph} />
                </Magnet>
                <span>{info.short}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section class="week-status paper">
        <div class="meter-row">
          <span class={`meter-label ${inj ? 'marker-red' : ''}`}>{inj ? 'כושר · פצוע' : 'כושר'}</span>
          <Bar value={v.player.fitness} color={inj || v.player.fitness < 50 ? 'red' : 'green'} />
          <span class="meter-val num">{Math.round(v.player.fitness)}</span>
          <span class="meter-label muted">צפי לשבת</span>
          <Bar value={projected} color={projected < 50 ? 'red' : 'blue'} />
          <span class="meter-val num">{Math.round(projected)}</span>
        </div>
        {ng && !inj && <ProgressNearGoal text={ng.text} progress={ng.value} target={ng.target} />}
      </section>

      <div class="action-bar">
        <button class="btn btn-ink" type="button" onClick={quick} disabled={busy.value}>
          <IconBolt size={20} /> שבוע מהיר
        </button>
        <button class="btn btn-primary grow2" type="button" onClick={closeWeek} disabled={!full || busy.value}>
          {full ? 'סגור את השבוע' : `עוד ${missing} מגנט${missing > 1 ? 'ים' : ''}`}
        </button>
      </div>

      {drag && (
        <div class="drag-ghost" style={{ left: `${drag.x}px`, top: `${drag.y}px` }} aria-hidden="true">
          <Magnet color={infoOf(drag.slot).color} size={52} lifted>
            <SlotGlyph glyph={infoOf(drag.slot).glyph} />
          </Magnet>
        </div>
      )}
    </main>
  );
}
