// Optional View fields (R&D additions). Some are already in types.ts, some are being added in parallel;
// reading them through this module keeps the UI compiling and degrading gracefully either way.
import type { Negotiation, PersonView, View } from '../core/types';

export interface PrematchInfo {
  lineup: 'starter' | 'bench' | 'youth' | 'out';
  reason: string;
  subMinute?: number | null;
}

export interface ViewExtras {
  teammates?: PersonView[];
  people?: Record<number, PersonView>;
  leagueZones?: { promote: number; relegate: number; champion?: number };
  settings?: { autoMoments: boolean };
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
