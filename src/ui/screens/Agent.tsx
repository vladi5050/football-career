import { act, busy, view } from '../../app/store';
import type { PersonView, SquadRole } from '../../core/types';
import { ROLE_HE, TRAIT_HE, money, moneyShort, relationWord } from '../i18n';
import { TopBar } from '../components/TopBar';
import { Crest } from '../components/Crest';
import { TapedCard } from '../components/TapedCard';
import { Avatar } from '../components/Avatar';
import { RelationMeter } from '../components/Bars';

export function agentArchetype(a: PersonView): { name: string; line: string; width: string } {
  if (a.traits.includes('greedy') || a.traits.includes('ambitious')) return { name: 'הכריש', line: 'קשרים במועדונים גדולים, עמלה גבוהה. דוחף למעברים.', width: '±20%' };
  if (a.traits.includes('mentor') || a.traits.includes('calm')) return { name: 'המנטור', line: 'חושב על הדקות שלך לפני הכסף. הצעות צנועות, עצות טובות.', width: '±10%' };
  return { name: 'הדוד', line: 'כמעט בלי עמלה, נאמן לגמרי. מעט קשרים.', width: '±30%' };
}
const ROLE_ORDER: SquadRole[] = ['backup', 'prospect', 'rotation', 'starter', 'star'];

export function AgentScreen() {
  const v = view.value!;
  const a = v.agent;
  const arch = agentArchetype(a);
  const offers = v.career.offers;
  return (
    <main class="screen has-nav agent-screen">
      <TopBar v={v} title="הסוכן" />

      <TapedCard tape="both" class="agent-card">
        <div class="agent-top">
          <Avatar name={a.name} role="agent" size="lg" />
          <div class="ag-main">
            <div class="h3">{a.name}</div>
            <span class="chip chip-ink">{arch.name}</span>
          </div>
        </div>
        <p class="ag-line">{arch.line}</p>
        <div class="chips">
          {a.traits.map((t) => (
            <span key={t} class="chip chip-paper">{TRAIT_HE[t]}</span>
          ))}
        </div>
        <div class="ag-rel">
          <span class="label">האמון ביניכם</span>
          <RelationMeter value={a.relation} />
          <span class="muted">{relationWord(a.relation)}</span>
        </div>
      </TapedCard>

      <h2 class="section-title">
        הצעות על השולחן <small>{offers.length ? `${offers.length} פתוחות` : ''}</small>
      </h2>
      {offers.length === 0 && (
        <div class="paper empty">אין כרגע הצעות. משחקים טובים מביאים טלפונים.</div>
      )}
      {offers.map((o) => {
        const c = v.offerClubs[o.fromClubId];
        const weeksLeft = Math.max(0, o.expiresWeek - v.absWeek);
        const better = v.player.contract ? o.wage > v.player.contract.monthlyWage : true;
        return (
          <div key={o.id} class="paper offer">
            <div class="offer-top">
              {c && <Crest spec={c.crest} colors={c.colors} name={c.name} short={c.short} size={48} />}
              <div class="of-main">
                <div class="of-club">{c?.name ?? 'מועדון'}</div>
                <div class="muted">{c ? `${c.leagueName} · ${c.country}` : ''}</div>
              </div>
              <span class={`chip ${weeksLeft <= 1 ? 'chip-red' : 'chip-ink'}`}>{weeksLeft <= 0 ? 'פג היום' : `עוד ${weeksLeft} שב׳`}</span>
            </div>
            <div class="offer-terms">
              <div><span class="label">שכר</span><b class={`num ${better ? 'up' : ''}`}>{money(o.wage)}</b></div>
              <div><span class="label">תפקיד</span><b>{ROLE_HE[o.role]}</b></div>
              <div><span class="label">שנים</span><b class="num">{o.years}</b></div>
              <div><span class="label">דמי העברה</span><b class="num">{o.fee ? moneyShort(o.fee) : 'חופשי'}</b></div>
            </div>
            <p class="offer-note">
              <Avatar name={a.name} role="agent" size="sm" />
              <span>"{o.viaAgentNote}"</span>
            </p>
            <div class="offer-actions">
              <button class="btn btn-sm" type="button" disabled={busy.value} onClick={() => act({ type: 'respondOffer', offerId: o.id, action: 'reject' })}>
                לדחות
              </button>
              <button class="btn btn-primary btn-sm grow2" type="button" disabled={busy.value} onClick={() => act({ type: 'respondOffer', offerId: o.id, action: 'negotiate' })}>
                לשבת למשא ומתן
              </button>
            </div>
          </div>
        );
      })}

      {v.player.contract && (
        <div class="paper renew">
          <div>
            <b>החוזה הנוכחי</b>
            <div class="muted">
              {money(v.player.contract.monthlyWage)} · {ROLE_HE[v.player.contract.role]} · עד עונה {v.player.contract.endSeason}
            </div>
          </div>
          <button class="btn btn-sm btn-ink" type="button" disabled={busy.value || ROLE_ORDER.indexOf(v.player.contract.role) < 0} onClick={() => act({ type: 'requestRenewal' })}>
            לבקש חוזה חדש
          </button>
        </div>
      )}
    </main>
  );
}
