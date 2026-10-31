import type { PersonView, View } from '../../core/types';
import { act, busy, view } from '../../app/store';
import { vx } from '../viewExtras';
import { TRAIT_HE, relationWord, weekLabel } from '../i18n';
import { TapedCard } from '../components/TapedCard';
import { Avatar } from '../components/Avatar';
import { RelationMeter } from '../components/Bars';

const CATEGORY_HE: Record<string, string> = {
  minutes: 'דקות משחק', money: 'כסף', injury: 'פציעה', transfer: 'העברות', family: 'משפחה', media: 'תקשורת', rival: 'יריבות',
  team: 'הקבוצה', discipline: 'משמעת', pressure: 'לחץ', agent: 'הסוכן', army: 'צבא', fans: 'אוהדים', national: 'נבחרת', life: 'חיים',
};
const ROLE_NAME_HE: Record<string, string> = {
  coach: 'המאמן', agent: 'הסוכן', rival: 'היריב', teammate: 'חבר לקבוצה', mate: 'חבר לקבוצה', captain: 'הקפטן', youngster: 'הצעיר בסגל',
  veteran: 'הוותיק', journalist: 'עיתונאי', chairman: 'יו״ר', father: 'אבא', mother: 'אמא', friend: 'חבר', opp_coach: 'מאמן היריבה',
};

function castPerson(v: View, id: number): PersonView | null {
  const x = vx(v);
  if (x.people?.[id]) return x.people[id]!;
  if (v.coach?.id === id) return v.coach;
  if (v.agent.id === id) return v.agent;
  if (v.rival?.id === id) return v.rival;
  return x.teammates?.find((t) => t.id === id) ?? null;
}

export function EventScreen() {
  const v = view.value!;
  const ev = v.inbox[0];
  if (!ev) return <main class="screen" />;
  const [roleKey, personId] = Object.entries(ev.cast)[0] ?? [];
  const person = personId != null ? castPerson(v, personId) : null;
  const left = v.inbox.length;

  return (
    <main class="screen event-screen">
      <div class="event-top">
        <span class="chip chip-paper">{CATEGORY_HE[ev.category] ?? ev.category}</span>
        <span class="wall-label">{weekLabel(v)}</span>
        {left > 1 && <span class="chip">עוד {left - 1} אחרי זה</span>}
      </div>

      <TapedCard tape="both" tilt="l" class="event-card rise">
        {person && (
          <div class="event-who">
            <Avatar name={person.name} role={person.role} rival={roleKey === 'rival'} />
            <div class="ew-main">
              <div class="ew-name">{person.name}</div>
              <div class="ew-role muted">
                {ROLE_NAME_HE[roleKey ?? ''] ?? ''}
                {person.traits.length > 0 && ` · ${person.traits.slice(0, 2).map((t) => TRAIT_HE[t]).join(', ')}`}
              </div>
              <div class="ew-rel">
                <RelationMeter value={person.relation} />
                <span class="ew-relword">{relationWord(person.relation)}</span>
              </div>
            </div>
          </div>
        )}
        <h1 class="event-title display">{ev.title}</h1>
        {ev.because && (
          <p class="because">
            <mark>{ev.because}</mark>
          </p>
        )}
        <p class="event-body">{ev.body}</p>
      </TapedCard>

      <div class="event-options" role="group" aria-label="מה אתה עושה?">
        {ev.options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            class="btn btn-block option-btn rise"
            style={{ '--delay': `${120 + i * 70}ms` }}
            disabled={busy.value}
            onClick={() => act({ type: 'resolveEvent', uid: ev.uid, optionId: o.id })}
          >
            <span class="opt-text">{o.text}</span>
            {o.hint && <span class="sr-only">. </span>}
            {o.hint && <span class="opt-hint">{o.hint}</span>}
          </button>
        ))}
      </div>
    </main>
  );
}
