import { view } from '../../app/store';
import type { PersonView } from '../../core/types';
import { vx } from '../viewExtras';
import { POS_HE, ROLE_HE, TRAIT_HE, avgRating, money, relationWord } from '../i18n';
import { TopBar } from '../components/TopBar';
import { Crest } from '../components/Crest';
import { ShirtOnHook, patternFor } from '../components/Shirt';
import { TapedCard } from '../components/TapedCard';
import { AttrList } from '../components/AttrList';
import { Avatar } from '../components/Avatar';
import { RelationMeter } from '../components/Bars';

function PersonRow({ p, rival, tag }: { p: PersonView; rival?: boolean; tag?: string }) {
  return (
    <div class="list-row person-row">
      <Avatar name={p.name} role={p.role} size="sm" rival={rival} />
      <div class="lr-main">
        <div class="lr-title">
          {tag && <span class="pr-tag">{tag}</span>}
          {p.name}
        </div>
        <div class="lr-sub">{p.traits.slice(0, 2).map((t) => TRAIT_HE[t]).join(' · ')}</div>
      </div>
      <div class="pr-rel">
        <RelationMeter value={p.relation} />
        <span>{relationWord(p.relation)}</span>
      </div>
    </div>
  );
}

export function ClubScreen() {
  const v = view.value!;
  const club = v.club;
  const p = v.player;
  const c = p.contract;
  const mates = vx(v).teammates ?? [];
  // At a glance: coach, closest teammate, the one who has a problem with you. The rest fold away.
  const byRel = [...mates].sort((a, b) => b.relation - a.relation);
  const friend = byRel[0] && byRel[0].relation > 0 ? byRel[0] : null;
  const foeCand = byRel[byRel.length - 1];
  const foe = foeCand && foeCand !== friend && foeCand.relation < 0 ? foeCand : null;
  const rest = mates.filter((m) => m !== friend && m !== foe);
  return (
    <main class="screen has-nav club-screen">
      <TopBar v={v} title="המועדון" />

      {club && (
        <div class="club-hero">
          <Crest spec={club.crest} colors={club.colors} name={club.name} short={club.short} size={86} />
          <div class="ch-main">
            <h2 class="h2">{club.name}</h2>
            <div class="muted-wall">
              {club.city} · {club.stadium}
            </div>
            <div class="chips" style={{ marginTop: 8 }}>
              <span class="chip chip-orange">{ROLE_HE[c?.role ?? 'prospect']}</span>
              <span class="chip">{POS_HE[p.pos]}</span>
              <span class="chip">גיל {p.age}</span>
              {p.injury && <span class="chip chip-red">פצוע · {p.injury.weeksLeft === 1 ? 'עוד שבוע' : `עוד ${p.injury.weeksLeft} שבועות`}</span>}
            </div>
          </div>
          <div class="ch-shirt" aria-hidden="true">
            <ShirtOnHook name={p.name.split(' ').slice(-1)[0] ?? ''} number={p.shirt} colors={club.colors} pattern={patternFor(club.crest[1])} width={78} />
          </div>
        </div>
      )}

      <TapedCard tape="right" class="me-card">
        <div class="me-top">
          <div class="me-ovr">
            <span class="display num">{p.overall}</span>
            <span class="label">יכולת</span>
          </div>
          <div class="me-stats">
            <div><b class="num">{p.stats.apps}</b><span>הופעות</span></div>
            <div><b class="num">{p.stats.goals}</b><span>שערים</span></div>
            <div><b class="num">{p.stats.assists}</b><span>בישולים</span></div>
            <div><b class="num">{avgRating(p.stats) || '-'}</b><span>ממוצע</span></div>
          </div>
        </div>
        {p.injury && (
          <div class="injury-banner on-paper" role="status">
            <span class="ib-cross" aria-hidden="true">+</span>
            <div>
              <b>{p.injury.kind}</b>
              <span>{p.injury.weeksLeft === 1 ? 'עוד שבוע אחד לחזרה' : `עוד ${p.injury.weeksLeft} שבועות לחזרה`} · כושר {Math.round(p.fitness)}</span>
            </div>
          </div>
        )}
        <div class="me-pot muted">
          פוטנציאל לפי הסקאוטים: <b class="num">{p.potentialRange[0]}-{p.potentialRange[1]}</b>
        </div>
        <AttrList attr={p.attr} pos={p.pos} />
        {c && (
          <div class="contract-strip">
            <div><span class="label">שכר</span><b class="num">{money(c.monthlyWage)}</b></div>
            <div><span class="label">עד עונה</span><b class="num">{c.endSeason}</b></div>
            <div><span class="label">סעיף שחרור</span><b class="num">{c.releaseClause ? money(c.releaseClause) : 'אין'}</b></div>
          </div>
        )}
      </TapedCard>

      <h2 class="section-title">אנשים</h2>
      <div class="paper people">
        {v.coach && <PersonRow p={v.coach} tag="המאמן" />}
        {friend && <PersonRow p={friend} tag="הכי קרוב אליך" />}
        {foe && <PersonRow p={foe} tag="יש ביניכם מתח" />}
        {rest.length > 0 && (
          <details class="squad-more">
            <summary>
              כל הסגל <span class="num">({rest.length})</span>
            </summary>
            {rest.map((m) => (
              <PersonRow key={m.id} p={m} />
            ))}
          </details>
        )}
      </div>

      {v.rival && (
        <>
          <h2 class="section-title">היריב</h2>
          <TapedCard tape="left" tilt="l" class="rival-card">
            <div class="rival-top">
              <Avatar name={v.rival.name} role="player" rival size="lg" />
              <div>
                <div class="h3">{v.rival.name}</div>
                <div class="muted">{v.rival.clubName}</div>
              </div>
              <span class="stamp-rect">יריב</span>
            </div>
            <div class="vs-grid">
              <span class="vs-label">יכולת</span>
              <b class="num me">{p.overall}</b>
              <b class="num them">{v.rival.overall}</b>
              <span class="vs-label">שערים העונה</span>
              <b class="num me">{p.stats.goals}</b>
              <b class="num them">{v.rival.goals}</b>
            </div>
            <div class="vs-legend"><span class="me">אתה</span><span class="them">{v.rival.name.split(' ')[0]}</span></div>
          </TapedCard>
        </>
      )}
    </main>
  );
}
