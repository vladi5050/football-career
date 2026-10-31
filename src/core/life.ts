// Life costs: rent, lifestyle, a car, helping the family. Money has somewhere to go.
// Costs follow life state and event flags (party / money_smart change the lifestyle bill).
import type { World } from './types';
import { addNews, clamp, fmtMoney, pushHistory, userPlayer } from './helpers';

/** Monthly living costs in NIS. */
export function monthlyLivingCost(world: World): number {
  const u = userPlayer(world);
  const k = world.career;
  const f = world.history.flags;
  const wage = u.contract?.monthlyWage ?? 0;
  let m = 0;
  if (k.life.home === 'rented') m += clamp(wage * 0.2, 2800, 22000);
  if (u.age >= 18) m += wage * 0.12;
  if (f.car) m += clamp(wage * 0.04, 800, 6000);
  if (f.helping_family) m += clamp(wage * 0.08, 600, 15000);
  if ((f.party ?? 0) > 0) m *= 1.15;
  if ((f.money_smart ?? 0) > 0) m *= 0.85;
  return Math.round(m / 10) * 10;
}

/** This week's share of the living costs (same base as wages: 12 months over the season's weeks). Never below zero money. */
export function weeklyLivingCost(world: World): number {
  const c = Math.round((monthlyLivingCost(world) * 12) / Math.max(20, world.season.totalWeeks));
  return Math.min(c, Math.max(0, world.career.money));
}

/** Life decisions at the start of a season. Returns Hebrew lines (also added to the news). */
export function lifeSeasonStep(world: World): string[] {
  const u = userPlayer(world);
  const k = world.career;
  const f = world.history.flags;
  const wage = u.contract?.monthlyWage ?? 0;
  const lines: string[] = [];
  const say = (line: string, tag: string): void => {
    lines.push(line);
    pushHistory(world, tag, line);
    addNews(world, { kind: 'career', headline: line });
  };
  if (k.life.home === 'parents' && u.age >= 19 && wage >= 9000) {
    k.life.home = 'rented';
    say(`עברת לדירה שכורה. ${fmtMoney(clamp(wage * 0.2, 2800, 22000))} לחודש`, 'moved_out');
  }
  if (!f.car && u.age >= 18 && k.money >= Math.max(30000, wage * 3)) {
    const price = Math.round(clamp(wage * 3, 40000, 600000) / 1000) * 1000;
    k.money -= price;
    f.car = 1;
    say(`קנית רכב ראשון ב-${fmtMoney(price)}`, 'bought_car');
  }
  if (!f.helping_family && u.age >= 20 && wage >= 12000) {
    f.helping_family = 1;
    say('התחלת לעזור להורים כל חודש', 'helping_family');
  }
  if (k.life.home === 'rented' && u.age >= 25 && k.money >= Math.max(1_200_000, wage * 40)) {
    const price = Math.round(clamp(wage * 30, 900_000, 6_000_000) / 10000) * 10000;
    k.money -= price;
    k.life.home = 'own';
    say(`קנית דירה ב-${fmtMoney(price)}`, 'bought_home');
  }
  return lines;
}
