import { describe, expect, it } from 'vitest';
import { fixtureContent, realContent } from './_content';
import { apply, newGame } from '../../src/core/game';
import { deserialize, serialize } from '../../src/core/save';
import { autoOptionId } from '../../src/core/events';
import type { Content } from '../../src/core/content';
import type { World } from '../../src/core/types';

function play(w: World, content: Content, seasons: number): World {
  let g = 0;
  while (w.season.number <= seasons && !w.career.retired && g++ < 20000) {
    const ph = w.phase;
    if (ph === 'plan') w = apply(w, { type: 'quickWeek' }, content).world;
    else if (ph === 'event') w = apply(w, { type: 'resolveEvent', uid: w.inbox[0].uid, optionId: autoOptionId(content, w.inbox[0]) }, content).world;
    else if (ph === 'prematch') w = apply(w, { type: 'startMatch' }, content).world;
    else if (ph === 'match') w = apply(w, { type: 'simRestOfMatch' }, content).world;
    else if (ph === 'negotiation') w = apply(w, { type: 'acceptNegotiation' }, content).world;
    else w = apply(w, { type: 'finishWeek' }, content).world;
  }
  return w;
}
const strip = (s: string): string => s.replace(/"savedAt":\d+/, '');

describe('save format', () => {
  it('round-trips exactly and continuing from a load equals continuing in memory', () => {
    const content = fixtureContent();
    const w = play(newGame({ type: 'newCareer', seed: 8, pos: 'CM', firstName: 'א', lastName: 'ב' }, content), content, 1);
    const json = serialize(w);
    const loaded = deserialize(json);
    expect(strip(serialize(loaded))).toBe(strip(json));
    const a = play(loaded, content, 3);
    const b = play(w, content, 3);
    expect(strip(serialize(a))).toBe(strip(serialize(b)));
  }, 60_000);

  it('reads a v1 (plain objects) save', () => {
    const content = fixtureContent();
    const w = newGame({ type: 'newCareer', seed: 9, pos: 'ST', firstName: 'א', lastName: 'ב' }, content);
    const v1 = JSON.stringify({ format: 'football-career-save', version: 1, savedAt: 0, world: { ...w, version: 1 } });
    const back = deserialize(v1);
    expect(Object.keys(back.people).length).toBe(Object.keys(w.people).length);
    expect(back.version).toBe(2);
  });

  it('real content: save stays under 1.5MB after several seasons', async () => {
    const content = await realContent();
    if (!content) return;
    const w = play(newGame({ type: 'newCareer', seed: 3, pos: 'W', firstName: 'א', lastName: 'ב' }, content), content, 4);
    const json = serialize(w);
    expect(new TextEncoder().encode(json).length).toBeLessThan(1.5 * 1024 * 1024);
  }, 120_000);
});
