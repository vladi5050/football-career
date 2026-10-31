import { useState } from 'preact/hooks';
import { act, busy, view } from '../../app/store';
import type { ClubView, SquadRole } from '../../core/types';
import { ROLE_HE, money } from '../i18n';
import { Crest } from '../components/Crest';
import { TapedCard } from '../components/TapedCard';
import { PatienceBar } from '../components/Bars';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { agentArchetype } from './Agent';
import { negotiationFinal } from '../viewExtras';

const ROLES: SquadRole[] = ['backup', 'prospect', 'rotation', 'starter', 'star'];

export function ContractScreen() {
  const v = view.value!;
  const n = v.career.negotiation;
  const [wage, setWage] = useState(() => (n ? Math.round(((n.agentRange[0] + n.agentRange[1]) / 2) / 100) * 100 : 0));
  const [role, setRole] = useState<SquadRole>(n?.currentOffer.role ?? 'rotation');
  const [years, setYears] = useState(n?.currentOffer.years ?? 2);
  const [clause, setClause] = useState(n?.currentOffer.releaseClause != null);
  const [confirmWalk, setConfirmWalk] = useState(false);
  if (!n) return <main class="screen" />;

  const club: ClubView | null = v.offerClubs[n.clubId] ?? (v.club?.id === n.clubId ? v.club : null);
  const min = Math.round((n.currentOffer.wage * 0.8) / 100) * 100;
  const max = Math.round((n.agentRange[1] * 1.45) / 100) * 100;
  const frac = (x: number) => Math.min(1, Math.max(0, (x - min) / (max - min)));
  const pct = (x: number) => frac(x) * 100;
  const final = negotiationFinal(n);
  const agreed = /מסכימים/.test(n.log[n.log.length - 1] ?? '');
  // The band sits on the thumb's travel (track minus thumb width), so the knob fits inside it.
  const THUMB = 34;
  const b0 = frac(n.agentRange[0]);
  const b1 = frac(n.agentRange[1]);
  const clauseAmount = Math.round((wage * 160) / 50000) * 50000;
  const arch = agentArchetype(v.agent);

  return (
    <main class="screen has-actions contract-screen">
      <div class="neg-head">
        {club && <Crest spec={club.crest} colors={club.colors} name={club.name} short={club.short} size={52} />}
        <div class="nh-main">
          <h1 class="tb-title">{club?.name ?? 'משא ומתן'}</h1>
          <div class="tb-sub">{n.offerId == null ? 'חידוש חוזה' : 'הצעת מעבר'} · משא ומתן</div>
        </div>
        <div class={`rounds ${final ? 'is-final' : ''}`} aria-label={final ? 'הצעה אחרונה' : `סבב ${Math.min(n.round, 3)} מתוך 3`}>
          {[1, 2, 3].map((r) => (
            <i key={r} class={r < n.round || (final && r <= n.round) ? 'done' : r === n.round ? 'cur' : ''} />
          ))}
          <span>{agreed ? 'יש הסכמה' : final ? 'הצעה אחרונה' : `סבב ${Math.min(n.round, 3)}/3`}</span>
        </div>
      </div>

      <TapedCard tape="right" class="offer-now">
        <span class="label">ההצעה על השולחן</span>
        <div class="on-row">
          <b class="display num on-wage">{money(n.currentOffer.wage)}</b>
          <span class="muted">לחודש</span>
        </div>
        <div class="chips">
          <span class="chip chip-ink">{ROLE_HE[n.currentOffer.role]}</span>
          <span class="chip chip-ink">{n.currentOffer.years} שנים</span>
          <span class="chip chip-ink">{n.currentOffer.releaseClause ? `סעיף שחרור ${money(n.currentOffer.releaseClause)}` : 'בלי סעיף שחרור'}</span>
        </div>
        <PatienceBar value={n.patience} />
      </TapedCard>

      <div class="agent-advice">
        <Avatar name={v.agent.name} role="agent" size="sm" />
        <p>
          <b>{v.agent.name}:</b> "לדעתי הם יגיעו איפשהו <mark>בין {money(n.agentRange[0])} ל-{money(n.agentRange[1])}</mark>. מעבר לזה זה הימור."
          <span class="muted"> ({arch.name}, טווח {arch.width})</span>
        </p>
      </div>

      {final ? (
        <div class="final-banner" role="status">
          <b>{agreed ? 'יש הסכמה' : 'הצעה אחרונה'}</b>
          <span>{agreed ? 'הם קיבלו את הדרישה שלך. נשאר רק לחתום.' : 'אין עוד סבבים. אפשר לחתום על ההצעה או לקום מהשולחן.'}</span>
        </div>
      ) : (
      <section class="paper demand">
        <h2 class="paper-title">הדרישה שלך</h2>
        <div class="wage-out">
          <b class="display num">{money(wage)}</b>
          <span class="muted">לחודש</span>
        </div>
        <div class="slider-wrap">
          <div
            class="agent-band"
            style={{ left: `calc((100% - ${THUMB}px) * ${b0})`, width: `calc((100% - ${THUMB}px) * ${b1 - b0} + ${THUMB}px)` }}
            aria-hidden="true"
          >
            <span>טווח הסוכן</span>
          </div>
          <input
            class="slider"
            type="range"
            min={min}
            max={max}
            step={100}
            value={wage}
            disabled={final}
            style={{ '--fill': `${pct(wage)}%` }}
            aria-label="שכר חודשי"
            onInput={(e) => setWage(Number((e.target as HTMLInputElement).value))}
          />
          <div class="slider-ends">
            <span><small>פחות</small> <b class="num">{money(min)}</b></span>
            <span><small>יותר</small> <b class="num">{money(max)}</b></span>
          </div>
        </div>

        <span class="label">תפקיד בסגל</span>
        <div class="seg" role="group" aria-label="תפקיד">
          {ROLES.map((r) => (
            <button key={r} type="button" aria-pressed={role === r} disabled={final} onClick={() => setRole(r)}>
              {ROLE_HE[r]}
            </button>
          ))}
        </div>

        <div class="demand-row">
          <div>
            <span class="label">שנים</span>
            <div class="stepper">
              <button type="button" aria-label="פחות" disabled={final} onClick={() => setYears((y) => Math.max(1, y - 1))}>−</button>
              <output class="num">{years}</output>
              <button type="button" aria-label="יותר" disabled={final} onClick={() => setYears((y) => Math.min(5, y + 1))}>+</button>
            </div>
          </div>
          <button type="button" class="toggle clause-toggle" role="switch" aria-checked={clause} disabled={final} onClick={() => setClause((c) => !c)}>
            <span class="tg-text">
              <b>סעיף שחרור</b>
              <small class="num">{clause ? money(clauseAmount) : 'חופש לעבור מוקדם'}</small>
            </span>
            <span class="switch" />
          </button>
        </div>
      </section>
      )}

      <section class="neg-log" aria-label="יומן המשא ומתן">
        {n.log.map((l, i) => {
          const mine = /^(אתה|דרשת|ביקשת|קמת)/.test(l);
          return (
            <div key={i} class={`bubble ${mine ? 'mine' : ''}`}>
              <span class="b-who">{mine ? 'אתה' : club?.short ?? club?.name ?? 'המועדון'}</span>
              {l.replace(/^(אתה|המנהל):\s*/, '')}
            </div>
          );
        })}
      </section>

      <div class="action-bar neg-actions">
        <button class="btn btn-danger btn-sm" type="button" disabled={busy.value} onClick={() => setConfirmWalk(true)}>
          לקום
        </button>
        {!final && (
          <button
            class="btn btn-ink"
            type="button"
            disabled={busy.value}
            onClick={() => act({ type: 'negotiate', demand: { wage, role, years, releaseClause: clause ? clauseAmount : null } })}
          >
            לבקש
          </button>
        )}
        <button class="btn btn-primary grow2 btn-col" type="button" disabled={busy.value} onClick={() => act({ type: 'acceptNegotiation' })}>
          לחתום
          <span class="sub num">{money(n.currentOffer.wage)}</span>
        </button>
      </div>

      <Modal
        open={confirmWalk}
        title="לקום מהשולחן?"
        onClose={() => setConfirmWalk(false)}
        actions={
          <>
            <button class="btn" type="button" onClick={() => setConfirmWalk(false)}>להישאר</button>
            <button class="btn btn-danger" type="button" onClick={() => { setConfirmWalk(false); void act({ type: 'walkAway' }); }}>לקום וללכת</button>
          </>
        }
      >
        <p>ההצעה תרד מהשולחן. ייתכן שהם לא יחזרו.</p>
      </Modal>
    </main>
  );
}
