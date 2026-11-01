// Real-league generator. Usage: node real.mjs out.json data1.txt data2.txt ...
// Header: @key|name|cc|country|tier|promotesTo(comma list or -)|relegatesTo(comma list or -)|promoteSpots|relegateSpots|strength|wageFactor|sim|repHi-repLo|region(optional)
// Club:   name|city|colors|rep|rival|stadium|short   (all but name/city optional)
// colors: tokens joined by '-', e.g. r-w, or hex '#123456-#FFFFFF'
import fs from 'fs';
const C = {
  r: '#C8102E', w: '#FFFFFF', k: '#000000', b: '#034694', n: '#0A1F44', s: '#6CABDD', y: '#FDE100', g: '#00843D',
  m: '#7A263A', o: '#F47920', p: '#5B2C83', gr: '#8A8D8F', gd: '#C9A13B', t: '#00A19C', rb: '#1B458F', mr: '#800000',
  pk: '#F4A6C9', dg: '#004225', lb: '#4FA3E0', cr: '#F2E6C8', br: '#6B3E26', lg: '#7CC242', dr: '#8B0000', v: '#7F3F98',
  az: '#0067B1', am: '#FFB81C', cy: '#00B5E2',
};
const PAIRS = ['r-w', 'b-w', 'y-k', 'g-w', 'p-w', 'k-w', 'o-k', 't-w', 'm-s', 'k-r', 'w-n', 'g-y', 'pk-k', 'rb-y', 'br-am', 'r-k', 'dg-w', 'w-r', 'n-r', 'lb-w', 'mr-w', 'v-y', 'az-w', 'gr-k'];
const LIMIT = /^(מכבי|הפועל|בית״ר|עירוני|בני|מ\.ס\.|אף\.סי\.|ס\.ק\.|א\.ס\.|ספורטינג|אתלטיק|ריאל|אולימפיק|סטאד|ק\.ס\.ק\.|ק\.ו\.|אינטר|אף\.קיי\.|אי\.אף\.קיי\.|הכח|אחי|ס\.צ\.|ו\.ף\.ל\.|פ\.צ\.|1\.|אס\.אס\.|אס\.אס\.סי\.|יו\.אס\.|ק\.ר\.ק\.|ר\.ק\.|דפורטיבו|אה\.צ\.)\s+/;
const col = (t) => (t.startsWith('#') ? t : C[t] ?? (() => { throw new Error('colour token ' + t); })());
function tweak(hex, n) {
  const v = parseInt(hex.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, x + (x > 128 ? -9 : 9) * n)));
  return '#' + ch.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}
function shortOf(name) {
  if (name.length <= 10) return name;
  let s = name;
  for (let i = 0; i < 2; i++) s = s.replace(LIMIT, '');
  if (s.length <= 10) return s;
  return s.split(' ')[0].slice(0, 10);
}
const out = [];
const [, , outFile, ...files] = process.argv;
let shift = 0;
for (const f of files) {
  let cur = null;
  for (const raw of fs.readFileSync(f, 'utf8').split('\n')) {
    const ln = raw.trim();
    if (!ln || ln.startsWith('#')) continue;
    if (ln.startsWith('@')) {
      const [key, name, cc, country, tier, up, down, ps, rs, strength, wf, sim, rep, region] = ln.slice(1).split('|');
      const list = (x) => (x === '-' ? null : x.includes(',') ? x.split(',') : x);
      const [hi, lo] = rep.split('-').map(Number);
      cur = { key, name, countryCode: cc, country, tier: +tier, promotesTo: list(up), relegatesTo: list(down), promoteSpots: +ps, relegateSpots: +rs,
        ...(region ? { region } : {}), strength: +strength, wageFactor: +wf, simLevel: sim, clubs: [], _hi: hi, _lo: lo, _pairs: new Set() };
      out.push(cur);
      shift += 5;
      continue;
    }
    const [name, city, colors, rep, rival, stadium, short] = ln.split('|');
    const i = cur.clubs.length;
    let pair = (colors || PAIRS[(i * 7 + shift) % PAIRS.length]).split('-').map(col);
    let n = 0;
    let p2 = pair;
    while (cur._pairs.has(p2.join('/')) || p2[0] === p2[1]) { n++; p2 = [tweak(pair[0], n), pair[1]]; }
    cur._pairs.add(p2.join('/'));
    const c = { name, short: short || shortOf(name), city, colors: p2, reputation: rep ? +rep : 0, stadium: stadium || `אצטדיון ${city}` };
    if (rival) c.rival = rival;
    if (cur.region) c.region = cur.region;
    cur.clubs.push(c);
  }
}
for (const l of out) {
  const k = l.clubs.length;
  l.clubs.forEach((c, i) => { if (!c.reputation) c.reputation = Math.round(l._hi - ((l._hi - l._lo) * i) / Math.max(1, k - 1)); });
  delete l._hi; delete l._lo; delete l._pairs;
}
fs.writeFileSync(outFile, JSON.stringify({ leagues: out }, null, 1) + '\n');
const per = {};
for (const l of out) { per[l.countryCode] ??= []; per[l.countryCode].push(`${l.key}:${l.clubs.length}`); }
for (const [cc, v] of Object.entries(per)) console.log(cc, v.join(' '));
console.log('leagues', out.length, 'clubs', out.reduce((a, l) => a + l.clubs.length, 0));
