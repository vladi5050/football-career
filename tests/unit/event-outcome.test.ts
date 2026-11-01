// Story answers report what they caused (Vladi: "after the answer there is no feedback").
import { describe, expect, it } from 'vitest';
import { realContent } from './_content';
import { apply, buildView, newGame } from '../../src/core/game';
import { makeRng, seedState } from '../../src/core/rng';
import { forceEvent } from '../../src/core/events';

describe('story answer outcome', () => {
  it('every option of many templates yields an outcome; most show at least one line', async () => {
    const content = await realContent();
    if (!content) return;
    let total = 0, withLines = 0;
    for (const t of content.events.slice(0, 80)) {
      for (const o of t.options) {
        const w = newGame({ type: 'newCareer', seed: 11, pos: 'W', firstName: 'א', lastName: 'ב' }, content);
        w.phase = 'event';
        const ev = forceEvent(w, content, t.id, makeRng(seedState(5)));
        if (!ev) continue;
        const r = apply(w, { type: 'resolveEvent', uid: ev.uid, optionId: o.id }, content);
        const out = buildView(r.world).eventOutcome;
        expect(out, `${t.id}.${o.id}`).toBeTruthy();
        expect(out!.choice.length).toBeGreaterThan(0);
        total++;
        if (out!.lines.length) withLines++;
      }
    }
    expect(total).toBeGreaterThan(50);
    expect(withLines / total).toBeGreaterThan(0.85);
  });

  it('the outcome lasts one command only', async () => {
    const content = await realContent();
    if (!content) return;
    const w = newGame({ type: 'newCareer', seed: 12, pos: 'CM', firstName: 'א', lastName: 'ב' }, content);
    w.phase = 'event';
    const t = content.events[0];
    const ev = forceEvent(w, content, t.id, makeRng(seedState(1)))!;
    apply(w, { type: 'resolveEvent', uid: ev.uid, optionId: t.options[0].id }, content);
    expect(buildView(w).eventOutcome).toBeTruthy();
    apply(w, { type: 'setAutoMoments', value: true } as never, content);
    expect(buildView(w).eventOutcome).toBeNull();
  });
});
