// Generates tests/fixtures/content.large.leagues.json: a synthetic world pyramid (~65 leagues, ~1,150 clubs) with
// regional groups (Israel tiers 3-4), a 3-group level (Serie C), closed leagues (MLS, USL) and many top flights.
// Run: node tests/fixtures/genLarge.mjs
import { writeFileSync } from 'node:fs';

let n = 0;
const COLORS = [['#C8102E', '#FFFFFF'], ['#00843D', '#FFFFFF'], ['#FFD100', '#002B7F'], ['#1D428A', '#FFFFFF'], ['#000000', '#FFFFFF'], ['#6CABDD', '#1C2C5B']];
const club = (cc, i, rep, region, city) => {
  n++;
  return { name: `${cc} מועדון ${n}`, short: `${cc}${i}`, city: city ?? `עיר ${cc}-${i % 9}`, colors: COLORS[n % COLORS.length], reputation: rep, stadium: `אצטדיון ${n}`, ...(region ? { region } : {}) };
};
const leagues = [];
function L(key, cc, country, tier, size, strength, o = {}) {
  const top = o.repTop ?? strength + 10, bottom = o.repBottom ?? strength - 15;
  const clubs = Array.from({ length: size }, (_, i) => club(cc, i, Math.round(top - ((top - bottom) * i) / Math.max(1, size - 1)), o.region, o.cityOf?.(i)));
  leagues.push({
    key, name: o.name ?? `${country} ${tier}${o.region ? ` ${o.region}` : ''}`, countryCode: cc, country, tier,
    promotesTo: o.up ?? null, relegatesTo: o.down ?? null, promoteSpots: o.ps ?? 0, relegateSpots: o.rs ?? 0,
    strength, wageFactor: o.wf ?? Math.max(0.2, strength / 55), simLevel: o.sim ?? 'result', clubs, ...(o.region ? { region: o.region } : {}),
  });
}
// Israel: 1, 2, 3 (north/south), 4 (four regional groups)
L('il1', 'IL', 'ישראל', 1, 14, 52, { down: 'il2', rs: 2, sim: 'full', name: 'ליגת העל' });
L('il2', 'IL', 'ישראל', 2, 16, 42, { up: 'il1', ps: 2, down: ['il3n', 'il3s'], rs: 2, sim: 'medium', name: 'הליגה הלאומית' });
for (const [k, region] of [['il3n', 'צפון'], ['il3s', 'דרום']]) {
  const kids = region === 'צפון' ? ['il4a', 'il4b'] : ['il4c', 'il4d'];
  L(k, 'IL', 'ישראל', 3, 16, 32, { up: 'il2', ps: 1, down: kids, rs: 2, region, name: `ליגה א' ${region}`, cityOf: (i) => `${region} ${i % 5}` });
}
for (const [k, region, upk] of [['il4a', 'צפון', 'il3n'], ['il4b', 'צפון', 'il3n'], ['il4c', 'דרום', 'il3s'], ['il4d', 'דרום', 'il3s']]) {
  L(k, 'IL', 'ישראל', 4, 14, 24, { up: upk, ps: 1, region, name: `ליגה ב' ${region} ${k.slice(-1)}`, cityOf: (i) => `${region} ${i % 5}` });
}
// England 1-4
L('en1', 'EN', 'אנגליה', 1, 20, 85, { down: 'en2', rs: 3, sim: 'medium' });
L('en2', 'EN', 'אנגליה', 2, 24, 72, { up: 'en1', ps: 3, down: 'en3', rs: 3 });
L('en3', 'EN', 'אנגליה', 3, 24, 62, { up: 'en2', ps: 3, down: 'en4', rs: 4 });
L('en4', 'EN', 'אנגליה', 4, 24, 55, { up: 'en3', ps: 4, down: 'en5', rs: 2 });
L('en5', 'EN', 'אנגליה', 5, 24, 48, { up: 'en4', ps: 2 });
// Italy 1-3 with Serie C in three groups (3 winners + best runner-up go up)
L('it1', 'IT', 'איטליה', 1, 20, 80, { down: 'it2', rs: 3, sim: 'medium' });
L('it2', 'IT', 'איטליה', 2, 20, 66, { up: 'it1', ps: 3, down: ['itca', 'itcb', 'itcc'], rs: 4 });
for (const g of ['itca', 'itcb', 'itcc']) L(g, 'IT', 'איטליה', 3, 20, 56, { up: 'it2', ps: 1, region: g.slice(-1).toUpperCase() });
// Spain, Germany, France
L('es1', 'ES', 'ספרד', 1, 20, 83, { down: 'es2', rs: 3, sim: 'medium' });
L('es2', 'ES', 'ספרד', 2, 22, 68, { up: 'es1', ps: 3, down: ['es3a', 'es3b'], rs: 4 });
for (const g of ['es3a', 'es3b']) L(g, 'ES', 'ספרד', 3, 20, 57, { up: 'es2', ps: 2, region: g.slice(-1) });
L('de1', 'DE', 'גרמניה', 1, 18, 81, { down: 'de2', rs: 2, sim: 'medium' });
L('de2', 'DE', 'גרמניה', 2, 18, 68, { up: 'de1', ps: 2, down: 'de3', rs: 3 });
L('de3', 'DE', 'גרמניה', 3, 20, 58, { up: 'de2', ps: 3 });
L('fr1', 'FR', 'צרפת', 1, 18, 76, { down: 'fr2', rs: 2, sim: 'medium' });
L('fr2', 'FR', 'צרפת', 2, 20, 64, { up: 'fr1', ps: 2, down: 'fr3', rs: 3 });
L('fr3', 'FR', 'צרפת', 3, 18, 55, { up: 'fr2', ps: 3 });
// Mid Europe, two tiers
for (const [cc, he, s1, n1, n2] of [['NL', 'הולנד', 66, 18, 20], ['BE', 'בלגיה', 64, 16, 16], ['PT', 'פורטוגל', 67, 18, 18], ['TR', 'טורקיה', 63, 19, 20], ['GR', 'יוון', 55, 14, 16], ['PL', 'פולין', 56, 18, 18], ['AT', 'אוסטריה', 58, 12, 16], ['CH', 'שווייץ', 58, 12, 10], ['DK', 'דנמרק', 57, 12, 12], ['SE', 'שוודיה', 54, 16, 16], ['SC', 'סקוטלנד', 55, 12, 10]]) {
  const k = cc.toLowerCase();
  L(`${k}1`, cc, he, 1, n1, s1, { down: `${k}2`, rs: 2 });
  L(`${k}2`, cc, he, 2, n2, s1 - 12, { up: `${k}1`, ps: 2 });
}
// single top flights
for (const [cc, he, s, sz] of [['NO', 'נורווגיה', 53, 16], ['CY', 'קפריסין', 48, 14], ['CZ', 'צ׳כיה', 54, 16], ['HU', 'הונגריה', 48, 12], ['RS', 'סרביה', 50, 16], ['BG', 'בולגריה', 46, 16], ['UA', 'אוקראינה', 52, 16], ['KR', 'קוריאה', 55, 12], ['AU', 'אוסטרליה', 50, 12], ['CL', 'צ׳ילה', 52, 16], ['CO', 'קולומביה', 54, 20], ['RO', 'רומניה', 50, 16], ['HR', 'קרואטיה', 52, 10], ['SA', 'ערב הסעודית', 60, 18], ['BR', 'ברזיל', 66, 20], ['AR', 'ארגנטינה', 62, 26], ['JP', 'יפן', 58, 20], ['MX', 'מקסיקו', 60, 18]]) {
  L(`${cc.toLowerCase()}1`, cc, he, 1, sz, s);
}
// USA: closed leagues
L('us1', 'US', 'ארצות הברית', 1, 29, 60, { name: 'MLS' });
L('us2', 'US', 'ארצות הברית', 2, 24, 45, { name: 'USL' });
L('us3', 'US', 'ארצות הברית', 3, 16, 36, { name: 'USL ליג 1' });
writeFileSync(new URL('./content.large.leagues.json', import.meta.url), JSON.stringify(leagues));
console.log(`${leagues.length} leagues, ${leagues.reduce((s, l) => s + l.clubs.length, 0)} clubs`);
