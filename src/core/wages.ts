// Wage bands from wages.json (monthly NIS), with a fallback derived from league wageFactor.
import type { Content } from './content';
import type { League } from './types';
import { clamp } from './helpers';

type Band = [number, number];

export function ageGroup(age: number): 'u19' | 'u23' | 'prime' | 'vet' {
  if (age < 19) return 'u19';
  if (age < 23) return 'u23';
  if (age < 31) return 'prime';
  return 'vet';
}

const FALLBACK: Record<string, Band> = { u19: [6000, 12000], u23: [15000, 45000], prime: [30000, 120000], vet: [20000, 70000] };

export function wageBand(content: Content, lg: League, age: number): Band {
  const g = ageGroup(age);
  const country = content.wages?.[lg.countryCode];
  const tierBands = country?.[String(lg.tier)] ?? (country ? country[Object.keys(country).sort().pop()!] : undefined);
  const band = tierBands?.[g];
  if (band && band.length === 2) return [band[0], band[1]];
  const fb = FALLBACK[g];
  const f = lg.wageFactor || 1;
  return [Math.round(fb[0] * f), Math.round(fb[1] * f)];
}

/** quality 0..1 = position inside the band (0 = bottom). Values >1 go above the band. */
export function wageFor(content: Content, lg: League, age: number, quality: number): number {
  const [lo, hi] = wageBand(content, lg, age);
  const q = clamp(quality, -0.3, 1.6);
  return Math.max(2000, Math.round(lo + (hi - lo) * q));
}
