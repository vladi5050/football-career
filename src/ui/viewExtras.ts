// Optional View fields (R&D additions). Some are already in types.ts, some are being added in parallel;
// reading them through this module keeps the UI compiling and degrading gracefully either way.
import type { ClubView, Negotiation, PersonView, View } from '../core/types';

export interface PrematchInfo {
  lineup: 'starter' | 'bench' | 'youth' | 'out';
  reason: string;
  subMinute?: number | null;
}

export interface ViewExtras {
  teammates?: PersonView[];
  people?: Record<number, PersonView>;
  leagueZones?: { promote: number; relegate: number; champion?: number };
  settings?: { autoMoments: boolean; seasonSpeed?: 'full' | 'balanced' | 'key' };
  /** Every club in career.history (core round 3). */
  careerClubs?: Record<number, ClubView>;
  careerStory?: { turningPoint?: string; keyPerson?: string };
  /** Line-up decided when the engine enters `prematch`. */
  prematch?: PrematchInfo | null;
}
export type ViewX = Omit<View, keyof ViewExtras> & ViewExtras;
export const vx = (v: View): ViewX => v as unknown as ViewX;

/** True once the club has made its last offer: only sign or walk away remain. */
export function negotiationFinal(n: Negotiation): boolean {
  const f = (n as Negotiation & { final?: boolean }).final;
  const last = n.log[n.log.length - 1] ?? '';
  if (f === true || /מסכימים/.test(last)) return true; // last offer made, or the club already agreed: nothing left to ask
  if (typeof f === 'boolean') return f;
  return n.round > 3 || /אחרונה|מסכימים/.test(last);
}

/** Contract has run out (offseason decision required). */
export function contractExpired(v: View): boolean {
  const c = v.player.contract;
  return !c || c.endSeason <= v.season.number;
}

/** A ClubView for any club id the View knows about (career clubs, current, offers, league table). */
export function clubLookup(v: View, id: number): ClubView | null {
  const cc = vx(v).careerClubs?.[id];
  if (cc) return cc;
  if (v.club?.id === id) return v.club;
  if (v.offerClubs[id]) return v.offerClubs[id]!;
  if (v.nextFixture?.opp.id === id) return v.nextFixture.opp;
  const r = v.table.find((t) => t.clubId === id);
  return r ? { id, name: r.name, short: r.short, colors: r.colors, crest: r.crest, city: '', reputation: 50, leagueName: '', country: '', stadium: '' } : null;
}

/** Renewal is blocked after talks collapsed this window. */
export function renewalBlocked(v: View): boolean {
  const until = (v.career as { renewalBlockedUntil?: number | null }).renewalBlockedUntil;
  if (typeof until === 'number') return v.absWeek < until;
  const n = v.career.negotiation;
  return !!n && n.status === 'walked_away' && n.offerId == null && n.clubId === v.club?.id;
}
