// Test helpers: fixture content (always), real content (when src/content exists), big synthetic world.
import fixture from '../fixtures/content.min.json';
import type { Content, LeagueSeed } from '../../src/core/content';
import { normalizeContent } from '../../src/core/contentLoad';

export function fixtureContent(): Content {
  return normalizeContent(JSON.parse(JSON.stringify(fixture)));
}

/** src/content/*.json if all five files exist, else null. */
export async function realContent(): Promise<Content | null> {
  const modName = 'node:fs';
  const fs = (await import(/* @vite-ignore */ modName)) as { existsSync(p: string): boolean; readFileSync(p: string, e: string): string };
  const base = new URL('../../src/content/', import.meta.url).pathname;
  const parts: Record<string, unknown> = {};
  for (const k of ['leagues', 'names', 'wages', 'themes', 'events']) {
    const p = `${base}${k}.json`;
    if (!fs.existsSync(p)) return null;
    parts[k] = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return normalizeContent(parts as never);
}

/** ~400 clubs: 20 leagues x 20 clubs, cloned from the fixture with unique names. */
export function bigContent(leagues = 20, clubsPer = 20): Content {
  const c = fixtureContent();
  const tpl = c.leagues;
  const out: LeagueSeed[] = [];
  const countries = ['IL', 'IL', 'IL', 'BE', 'NL', 'PT'];
  for (let i = 0; i < leagues; i++) {
    const t = tpl[i % tpl.length];
    const cc = countries[i % countries.length];
    const key = `L${i}`;
    out.push({
      ...t, key, name: `ליגה ${i}`, countryCode: cc, tier: cc === 'IL' ? (i % 3) + 1 : 1, strength: 35 + (i * 7) % 45,
      promotesTo: null, relegatesTo: null, promoteSpots: 0, relegateSpots: 0,
      clubs: Array.from({ length: clubsPer }, (_, k) => ({ ...t.clubs[k % t.clubs.length], name: `מועדון ${i}-${k}`, rival: undefined })),
    });
  }
  // link IL tiers pairwise for promotion
  return { ...c, leagues: out };
}
