// Shape of the JSON content bundle (src/content/*.json). Loaded by the worker / tests and passed into core.
export interface ClubSeed { name: string; short: string; city: string; colors: [string, string]; reputation: number; stadium: string; rival?: string; crestCharge?: number }
export interface LeagueSeed {
  key: string; name: string; countryCode: string; country: string; tier: number;
  promotesTo: string | null; relegatesTo: string | null; promoteSpots: number; relegateSpots: number;
  strength: number; wageFactor: number; simLevel: 'full' | 'medium' | 'result'; clubs: ClubSeed[];
}
export interface NamePool { first: string[]; last: string[] }
export type WageBands = Record<string, Record<string, { u19: [number, number]; u23: [number, number]; prime: [number, number]; vet: [number, number] }>>;
export interface Theme { id: string; name: string; desc: string; categoryBoost: Record<string, number> }
export interface EventVariant { title: string; body: string }
export interface EventOption { id: string; text: string; hint?: string; effects: string[]; chain?: { after: number; event: string }[]; /** R&D addition: preferred option for automatic (quick week) resolution. */ default?: boolean }
export interface EventTemplate {
  id: string; category: string; weight: number; cooldown?: number; once?: boolean;
  when?: string[]; cast?: Record<string, string>; because?: string;
  variants: EventVariant[]; options: EventOption[]; chainOnly?: boolean;
}
export interface Content {
  leagues: LeagueSeed[];
  names: Record<string, NamePool>;
  wages: WageBands;
  themes: Theme[];
  events: EventTemplate[];
}
