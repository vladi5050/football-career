import { describe, expect, it } from 'vitest';
import { fixtureContent } from './_content';
import { newGame } from '../../src/core/game';
import { makeRng } from '../../src/core/rng';
import {
  applyEffects, autoOptionId, becauseLine, compileEvents, parseEffect, resolveEvent, rollWeekEvents, selectPerson, syncFlags, templateById,
} from '../../src/core/events';
import { relationOf, userPlayer, userClub } from '../../src/core/helpers';
import type { Footballer } from '../../src/core/types';

const content = fixtureContent();
compileEvents(content);
const fresh = (seed = 11) => newGame({ type: 'newCareer', seed, pos: 'W', firstName: 'דני', lastName: 'כהן' }, content);

describe('effects', () => {
  it('parses the closed list', () => {
    expect(parseEffect('rel(coach) += 8')).toEqual({ k: 'rel', role: 'coach', d: 8 });
    expect(parseEffect('rel(coach) -= 15')).toEqual({ k: 'rel', role: 'coach', d: -15 });
    expect(parseEffect('morale -= 3')).toEqual({ k: 'stat', key: 'morale', d: -3 });
    expect(parseEffect('flag(party) = 2')).toEqual({ k: 'flag', name: 'party', d: 2, set: true });
    expect(parseEffect('memory(coach, apologised, 10)')).toEqual({ k: 'memory', role: 'coach', tag: 'apologised', weight: 10 });
    expect(parseEffect('promise(coach, 4, minutes)')).toEqual({ k: 'promise', role: 'coach', weeks: 4, tag: 'minutes' });
    expect(parseEffect('goal(goals, 5, חמישה שערים עד ינואר)')).toEqual({ k: 'goal', kind: 'goals', target: 5, text: 'חמישה שערים עד ינואר' });
    expect(parseEffect('news(הכותרת, עם פסיק)')).toEqual({ k: 'news', text: 'הכותרת, עם פסיק' });
    expect(parseEffect('squadRole(starter)')).toEqual({ k: 'squadRole', role: 'starter' });
    expect(parseEffect('offer(abroad)')).toEqual({ k: 'offer', kind: 'abroad' });
    expect(parseEffect('bogus(1)').k).toBe('unknown');
  });

  it('applies effects to the world', () => {
    const w = fresh();
    const rng = makeRng(w.rngState);
    const u = userPlayer(w);
    const coachId = userClub(w)!.managerId;
    const relBefore = relationOf(w.people[coachId], u.id);
    const money = w.career.money;
    const pass = u.attr.passing;
    const effects = ['rel(coach) += 8', 'money += 3000', 'attr(passing) += 2', 'flag(party) += 1', 'flag(party) += 1', 'memory(coach, apologised, 10)',
      'squadRole(starter)', 'promise(coach, 4, minutes)', 'news(כותרת על {first})', 'goal(custom, 3, מטרה)', 'history(test_tag)', 'bogus(1)'].map(parseEffect);
    applyEffects(w, content, effects, {}, rng, 'טקסט');
    expect(relationOf(w.people[coachId], u.id)).toBeCloseTo(relBefore + 8 + 3, 5);
    expect(w.people[coachId].relations[u.id].memories.some((m) => m.tag === 'apologised')).toBe(true);
    expect(w.career.money).toBe(money + 3000);
    expect(u.attr.passing).toBeCloseTo(pass + 2, 5);
    expect(w.history.flags.party).toBe(2);
    expect(u.contract!.role).toBe('starter');
    expect(w.career.promises.length).toBe(1);
    expect(w.news[0].headline).toBe('כותרת על דני');
    expect(w.career.goals.some((g) => g.text === 'מטרה')).toBe(true);
    expect(w.history.entries.some((e) => e.tag === 'test_tag')).toBe(true);
    applyEffects(w, content, [parseEffect('injury(3)')], {}, rng, '');
    expect(u.injury?.weeksLeft).toBe(3);
  });

  it('flags with engine meaning are mapped', () => {
    const w = fresh();
    w.history.flags.captain = 1;
    w.history.flags.want_renewal = 1;
    w.career.nationalCaps = 4;
    const out = syncFlags(w);
    expect(w.career.captain).toBe(true);
    expect(out.openRenewal).toBe(true);
    expect(w.history.flags.want_renewal).toBe(0);
    expect(w.history.flags.national_caps).toBe(4);
  });
});

describe('event engine', () => {
  it('selectors resolve', () => {
    const w = fresh();
    for (const s of ['coach', 'agent', 'rival', 'teammate', 'captain', 'youngster', 'veteran', 'journalist', 'chairman', 'father', 'mother', 'friend', 'opp_coach']) {
      expect(selectPerson(w, s, makeRng(w.rngState), new Set()), s).not.toBeNull();
    }
  });

  it('anti-repetition, cooldown, silence and max 2 per week over a long run', () => {
    const w = fresh(5);
    const rng = makeRng(w.rngState);
    const seenAt: Record<string, number[]> = {};
    const texts = new Set<string>();
    let silent = 0;
    const weeks = 150;
    for (let i = 0; i < weeks; i++) {
      const evs = rollWeekEvents(w, content, rng);
      expect(evs.length).toBeLessThanOrEqual(2);
      if (!evs.length) silent++;
      for (const ev of evs) {
        const key = `${ev.templateId}|${ev.title}|${ev.body}`;
        expect(texts.has(key), `repeated text ${key}`).toBe(false);
        texts.add(key);
        (seenAt[ev.templateId] ??= []).push(w.absWeek);
        expect(ev.templateId).not.toBe('broken_condition');
        resolveEvent(w, content, ev.uid, autoOptionId(content, ev), rng);
      }
      w.absWeek++;
    }
    for (const [id, weeksSeen] of Object.entries(seenAt)) {
      const t = templateById(content, id)!;
      expect(weeksSeen.length).toBeLessThanOrEqual(t.variants.length);
      if (t.chainOnly) continue;
      for (let i = 1; i < weeksSeen.length; i++) expect(weeksSeen[i] - weeksSeen[i - 1]).toBeGreaterThanOrEqual(t.cooldown ?? 12);
    }
    expect(silent / weeks).toBeGreaterThan(0.15);
  });

  it('chains fire after N weeks with a because line from history', () => {
    const w = fresh(9);
    const rng = makeRng(w.rngState);
    w.history.flags.party = 1;
    w.history.entries.push({ week: w.absWeek, tag: 'party', text: 'יצאת למסיבה' });
    w.absWeek += 3;
    w.season.startAbsWeek = 0;
    const t = templateById(content, 'coach_bench_after_party')!;
    expect(t).toBeTruthy();
    // force it
    let ev = null;
    for (let i = 0; i < 40 && !ev; i++) {
      w.history.lastSeen = {};
      w.history.usedVariants = {};
      w.history.recentCategories = [];
      w.inbox = [];
      const evs = rollWeekEvents(w, content, rng);
      ev = evs.find((e) => e.templateId === 'coach_bench_after_party') ?? null;
    }
    expect(ev).toBeTruthy();
    expect(ev!.because).toMatch(/^כי בשבוע 1 /);
    expect(ev!.body).not.toMatch(/\{coach\}|\{mate\}/);
    resolveEvent(w, content, ev!.uid, 'apologise', rng);
    expect(w.pending.some((p) => p.templateId === 'coach_checks_promise' && p.atWeek === w.absWeek + 2)).toBe(true);
    w.inbox = [];
    w.absWeek += 2;
    const evs = rollWeekEvents(w, content, rng);
    const chain = evs.find((e) => e.templateId === 'coach_checks_promise');
    expect(chain).toBeTruthy();
    expect(chain!.cast.coach).toBe(ev!.cast.coach);
    expect(chain!.because).toMatch(/^כי בשבוע/);
  });

  it('becauseLine ignores entries from this very week', () => {
    const w = fresh();
    w.history.entries.push({ week: w.absWeek, tag: 'x', text: 'עכשיו' });
    expect(becauseLine(w, 'x')).toBeNull();
  });

  it('quick week picks the option with the smallest relationship loss', () => {
    const t = templateById(content, 'coach_bench_after_party')!;
    const ev = { uid: 1, templateId: t.id, title: '', body: '', because: null, cast: {}, options: t.options.map((o) => ({ id: o.id, text: o.text })), week: 0, category: t.category };
    expect(autoOptionId(content, ev)).toBe('apologise');
    const fam = templateById(content, 'family_dinner')!;
    expect(autoOptionId(content, { ...ev, templateId: fam.id })).toBe('go_home');
    const withDefault = { ...content, events: content.events.map((e) => (e.id === fam.id ? { ...e, options: e.options.map((o, i) => ({ ...o, default: i === 1 })) } : e)) };
    compileEvents(withDefault);
    expect(autoOptionId(withDefault, { ...ev, templateId: fam.id })).toBe('busy');
  });

  it('promises are checked when due', async () => {
    const { checkPromises } = await import('../../src/core/events');
    const w = fresh();
    const rng = makeRng(w.rngState);
    applyEffects(w, content, [parseEffect('promise(coach, 2, minutes)')], {}, rng, '');
    w.absWeek += 2;
    const lines = checkPromises(w);
    expect(lines.length).toBe(1);
    expect(w.career.promises[0].kept).toBe(false);
    const u = userPlayer(w) as Footballer;
    expect(u.morale).toBeLessThan(80);
  });
});
