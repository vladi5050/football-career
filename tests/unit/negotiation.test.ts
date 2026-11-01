import { describe, expect, it } from 'vitest';
import { fixtureContent } from './_content';
import { apply, newGame } from '../../src/core/game';
import { makeRng } from '../../src/core/rng';
import { agentRange, ceilingFor, negotiateRound, openNegotiation, acceptCurrent } from '../../src/core/negotiation';
import { spawnOffer } from '../../src/core/transfers';
import { userClub, userPlayer } from '../../src/core/helpers';
import type { AgentArchetype, World } from '../../src/core/types';

const content = fixtureContent();
const fresh = (seed = 31): World => {
  const w = newGame({ type: 'newCareer', seed, pos: 'ST', firstName: 'א', lastName: 'ב' }, content);
  const u = userPlayer(w);
  u.age = 22;
  for (const k of Object.keys(u.attr) as (keyof typeof u.attr)[]) u.attr[k] = 62;
  u.contract!.endSeason = 1;
  return w;
};

function withAgent(w: World, a: AgentArchetype): void {
  w.people[w.career.agentId].archetype = a;
}

describe('negotiation', () => {
  it('agent range width depends on archetype', () => {
    const widths: Record<string, number> = {};
    for (const a of ['mentor', 'shark', 'uncle'] as AgentArchetype[]) {
      const w = fresh();
      withAgent(w, a);
      const rng = makeRng(w.rngState);
      let sum = 0, centreBias = 0;
      for (let i = 0; i < 200; i++) {
        const [lo, hi] = agentRange(w, rng, 10000);
        sum += (hi - lo) / ((hi + lo) / 2);
        centreBias += (hi + lo) / 2 / 10000;
      }
      widths[a] = sum / 200;
      if (a === 'shark') expect(centreBias / 200).toBeGreaterThan(1.03);
    }
    expect(widths.mentor).toBeCloseTo(0.2, 1);
    expect(widths.shark).toBeCloseTo(0.4, 1);
    expect(widths.uncle).toBeCloseTo(0.6, 1);
  });

  it('role and release clause shift the ceiling', () => {
    const base = ceilingFor(10000, 'rotation', 'starter', null, 1_000_000, 3);
    expect(ceilingFor(10000, 'starter', 'starter', null, 1_000_000, 3)).toBeLessThan(base);
    expect(ceilingFor(10000, 'rotation', 'starter', 2_000_000, 1_000_000, 3)).toBeGreaterThan(base);
    expect(ceilingFor(10000, 'rotation', 'starter', 500_000, 1_000_000, 3)).toBeGreaterThan(ceilingFor(10000, 'rotation', 'starter', 2_000_000, 1_000_000, 3));
  });

  it('a modest demand is accepted and signing updates the contract', () => {
    const w = fresh();
    const rng = makeRng(w.rngState);
    const neg = openNegotiation(w, content, rng, userClub(w)!.id, null, 'plan');
    expect(typeof neg).not.toBe('string');
    const n = w.career.negotiation!;
    const reply = negotiateRound(w, content, rng, { wage: Math.round(n.hiddenCeiling * 0.5), role: n.currentOffer.role, years: 3, releaseClause: null });
    expect(reply).toContain('מסכימים');
    expect(acceptCurrent(w, content).length).toBe(1);
    expect(w.career.negotiation!.status).toBe('signed');
    expect(userPlayer(w).contract!.endSeason).toBeGreaterThanOrEqual(w.season.number + 2);
  });

  it('greedy demands burn patience, the club walks away after 3 rounds and remembers', () => {
    const w = fresh();
    const rng = makeRng(w.rngState);
    const clubId = userClub(w)!.id;
    openNegotiation(w, content, rng, clubId, null, 'plan');
    const n = w.career.negotiation!;
    const demand = { wage: n.hiddenCeiling * 3, role: 'star' as const, years: 3, releaseClause: null };
    negotiateRound(w, content, rng, demand);
    if (w.career.negotiation!.status === 'open') { expect(n.round).toBe(2); expect(n.patience).toBeLessThan(100); negotiateRound(w, content, rng, demand); }
    if (w.career.negotiation!.status === 'open') negotiateRound(w, content, rng, demand);
    expect(w.career.negotiation!.status).toBe('walked_away');
    const chair = w.people[w.clubs[clubId].chairmanId];
    expect(chair.relations[userPlayer(w).id].memories.some((m) => m.tag === 'walked_away')).toBe(true);
    // and refuses to sit down again soon
    expect(typeof openNegotiation(w, content, rng, clubId, null, 'plan')).toBe('string');
  });

  it('counter offers move toward the ceiling and never exceed the demand', () => {
    const w = fresh();
    const rng = makeRng(w.rngState);
    openNegotiation(w, content, rng, userClub(w)!.id, null, 'plan');
    const n = w.career.negotiation!;
    const start = n.currentOffer.wage;
    const demand = { wage: Math.round(n.hiddenCeiling * 1.05), role: n.currentOffer.role, years: 3, releaseClause: null };
    negotiateRound(w, content, rng, demand);
    if (n.status === 'open') {
      expect(n.currentOffer.wage).toBeGreaterThanOrEqual(start);
      expect(n.currentOffer.wage).toBeLessThanOrEqual(demand.wage);
    }
  });

  it('transfer offer -> negotiate -> accept moves the player', () => {
    const w = fresh(44);
    w.phase = 'plan';
    const rng = makeRng(w.rngState);
    const offer = spawnOffer(w, content, rng, 'any');
    expect(offer).toBeTruthy();
    expect(offer!.viaAgentNote.length).toBeGreaterThan(5);
    apply(w, { type: 'respondOffer', offerId: offer!.id, action: 'negotiate' }, content);
    expect(w.phase).toBe('negotiation');
    apply(w, { type: 'acceptNegotiation' }, content);
    expect(w.phase).toBe('plan');
    const u = userPlayer(w);
    expect(u.clubId).toBe(offer!.fromClubId);
    expect(w.clubs[offer!.fromClubId].squad).toContain(u.id);
    expect(u.contract!.clubId).toBe(offer!.fromClubId);
  });
});
