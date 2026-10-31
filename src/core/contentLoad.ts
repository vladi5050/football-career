// Normalise raw JSON files into a Content bundle. Tolerates wrapped or bare arrays.
import type { Content, EventTemplate, LeagueSeed, NamePool, Theme, WageBands } from './content';

export interface RawContent {
  leagues: unknown;
  names: unknown;
  wages: unknown;
  themes: unknown;
  events: unknown;
}

function arr<T>(v: unknown, key: string): T[] {
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>)[key])) return (v as Record<string, T[]>)[key];
  if (v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>).default)) return (v as Record<string, T[]>).default;
  return [];
}

function obj<T>(v: unknown): T {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('default' in o && Object.keys(o).length === 1) return o.default as T;
    return o as T;
  }
  return {} as T;
}

export function normalizeContent(raw: RawContent): Content {
  return {
    leagues: arr<LeagueSeed>(raw.leagues, 'leagues'),
    names: obj<Record<string, NamePool>>(raw.names),
    wages: obj<WageBands>(raw.wages),
    themes: arr<Theme>(raw.themes, 'themes'),
    events: arr<EventTemplate>(raw.events, 'events'),
  };
}
