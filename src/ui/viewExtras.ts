// Optional View fields the UI can use if the engine provides them (all optional, UI degrades gracefully).
// Requested from the CTO as additions to `View` in src/core/types.ts.
import type { PersonView, View } from '../core/types';

export interface ViewExtras {
  /** Squad mates with their relation to the user (Club screen). */
  teammates?: PersonView[];
  /** Any person referenced by ActiveEvent.cast, keyed by id (Event screen portrait + relation meter). */
  people?: Record<number, PersonView>;
  /** Table zones for the user's league. */
  leagueZones?: { promote: number; relegate: number; champion?: number };
}
export type ViewX = View & ViewExtras;
export const vx = (v: View): ViewX => v as ViewX;
