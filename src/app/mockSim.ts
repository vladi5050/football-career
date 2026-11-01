// A believable fake simulation so every screen renders without the real engine.
// It implements the same SimApi as the worker. Numbers are hand-tuned, not balanced.
import type {
  ActiveEvent, ApplyResult, AttrKey, Attributes, ClubView, Command, CrestSpec, LiveMatch, MatchHighlight, MomentKind,
  MomentSpec, PersonView, PlanSlot, Position, SquadRole, TableRow, View, WeekReport,
} from '../core/types';
import type { NewCareerCmd, SimApi } from './store';
import type { ViewExtras } from '../ui/viewExtras';

type MView = View & ViewExtras;

interface ClubSeed { name: string; short: string; city: string; colors: [string, string]; rep: number; stadium: string }
const IL_CLUBS: ClubSeed[] = [
  { name: 'מכבי הכרמל', short: 'מכב״כ', city: 'חיפה', colors: ['#0B7A3B', '#FFFFFF'], rep: 78, stadium: 'אצטדיון הכרמל' },
  { name: 'הפועל נמל', short: 'הפ״נ', city: 'אשדוד', colors: ['#C8102E', '#FFFFFF'], rep: 64, stadium: 'מגרש הנמל' },
  { name: 'בית״ר הגליל', short: 'בית״ר', city: 'טבריה', colors: ['#F2C230', '#1B1B1B'], rep: 70, stadium: 'אצטדיון הכנרת' },
  { name: 'הפועל הכרמל', short: 'הפ״כ', city: 'חיפה', colors: ['#D7263D', '#1B2A4A'], rep: 66, stadium: 'קרית אליעזר' },
  { name: 'מכבי השרון', short: 'מכ״ש', city: 'נתניה', colors: ['#F28C28', '#1B2A4A'], rep: 61, stadium: 'אצטדיון השרון' },
  { name: 'עירוני הנגב', short: 'ע.נגב', city: 'באר שבע', colors: ['#B3122E', '#F7F7F2'], rep: 68, stadium: 'אצטדיון המדבר' },
  { name: 'הפועל העמק', short: 'הפ״ע', city: 'עפולה', colors: ['#E03A3E', '#2F9E57'], rep: 52, stadium: 'מגרש העמק' },
  { name: 'בני הגבעה', short: 'בני ג׳', city: 'גבעתיים', colors: ['#5B2C83', '#F7F7F2'], rep: 50, stadium: 'מגרש הגבעה' },
  { name: 'הכוח יפו', short: 'הכוח', city: 'יפו', colors: ['#1E4FD8', '#F2C230'], rep: 55, stadium: 'אצטדיון החוף' },
  { name: 'אליצור השפלה', short: 'אליצור', city: 'רחובות', colors: ['#2E8BC0', '#FFFFFF'], rep: 47, stadium: 'מגרש הפרדסים' },
  { name: 'מ.ס. הירדן', short: 'מ.ס.י', city: 'בית שאן', colors: ['#0E6E6E', '#F2C230'], rep: 44, stadium: 'מגרש הירדן' },
  { name: 'עירוני הדרום', short: 'ע.דרום', city: 'אילת', colors: ['#00A6A6', '#1B2A4A'], rep: 46, stadium: 'אצטדיון המפרץ' },
];
const FOREIGN: (ClubSeed & { league: string; country: string })[] = [
  { name: 'ק.ס. ולדרן', short: 'KSV', city: 'גנט', colors: ['#1E4FD8', '#FFFFFF'], rep: 72, stadium: 'פארק ולדרן', league: 'הליגה הבלגית', country: 'בלגיה' },
  { name: 'אתלטיקו מרסה', short: 'ATM', city: 'פורטו', colors: ['#1B1B1B', '#F2C230'], rep: 69, stadium: 'אסטדיו דה מרסה', league: 'הליגה הפורטוגלית', country: 'פורטוגל' },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function crestFor(name: string): CrestSpec {
  const h = hash(name);
  return [h % 6, (h >>> 3) % 10, (h >>> 7) % 14, (h >>> 11) % 11];
}
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const POS_KEY: Record<Position, AttrKey[]> = {
  GK: ['gk', 'passing'], CB: ['defending', 'heading'], FB: ['defending', 'stamina'], DM: ['defending', 'passing'],
  CM: ['passing', 'vision'], AM: ['vision', 'dribbling'], W: ['pace', 'dribbling'], ST: ['finishing', 'pace'],
};
const MOMENTS_BY_POS: Record<Position, MomentKind[]> = {
  GK: ['save', 'rush_out', 'penalty'], CB: ['tackle', 'header', 'clearance'], FB: ['tackle', 'cross', 'interception'],
  DM: ['interception', 'through_ball', 'long_shot'], CM: ['through_ball', 'long_shot', 'shot'], AM: ['through_ball', 'shot', 'free_kick'],
  W: ['dribble', 'cross', 'shot'], ST: ['one_on_one', 'header', 'shot'],
};
const SCORING: MomentKind[] = ['shot', 'one_on_one', 'header', 'long_shot', 'penalty', 'free_kick'];

interface MockState { view: MView; rnd: number; userClubIdx: number }

export function createMockSim(): SimApi {
  let st: MockState | null = null;
  let r = rng(1);

  const clubView = (i: number): ClubView => {
    const c = IL_CLUBS[i]!;
    return { id: 100 + i, name: c.name, short: c.short, city: c.city, colors: c.colors, crest: crestFor(c.name), reputation: c.rep, leagueName: 'ליגת הנוער העל', country: 'ישראל', stadium: c.stadium };
  };
  const foreignView = (i: number): ClubView => {
    const c = FOREIGN[i]!;
    return { id: 200 + i, name: c.name, short: c.short, city: c.city, colors: c.colors, crest: crestFor(c.name), reputation: c.rep, leagueName: c.league, country: c.country, stadium: c.stadium };
  };

  function makeTable(userIdx: number, played: number): MView['table'] {
    const rows = IL_CLUBS.map((c, i) => {
      const str = c.rep + (i === userIdx ? 6 : 0);
      const p = played;
      const w = Math.max(0, Math.round((p * (str - 30)) / 70 + (r() - 0.5) * 2));
      const d = Math.max(0, Math.min(p - w, Math.round(p * 0.25 + (r() - 0.5) * 2)));
      const l = Math.max(0, p - w - d);
      const gf = w * 2 + d + Math.round(r() * 3);
      const ga = l * 2 + d + Math.round(r() * 2);
      const form = Array.from({ length: Math.min(5, p) }, () => (r() < w / Math.max(1, p) ? 'W' : r() < 0.5 ? 'D' : 'L'));
      const row: TableRow = { clubId: 100 + i, p, w, d, l, gf, ga, pts: w * 3 + d, form };
      return { ...row, name: c.name, short: c.short, colors: c.colors, crest: crestFor(c.name) };
    });
    rows.sort((a, b) => b.pts - a.pts || b.gf - b.ga - (a.gf - a.ga));
    return rows;
  }

  function newView(cmd: NewCareerCmd): MView {
    const seed = cmd.seed ?? Math.floor(Math.random() * 1e9);
    r = rng(seed);
    const startKinds = ['israel', 'foreign_academy', 'raised_abroad'] as const;
    const startKind = startKinds[seed % 3]!;
    const userIdx = 4; // מכבי השרון
    const keys = POS_KEY[cmd.pos];
    const base = (k: AttrKey) => (k === 'gk' ? (cmd.pos === 'GK' ? 47 : 8) : 34 + Math.floor(r() * 10)) + (keys.includes(k) ? 9 : 0) + r();
    const attr: Attributes = {
      finishing: base('finishing'), passing: base('passing'), dribbling: base('dribbling'), pace: base('pace'),
      stamina: base('stamina'), defending: base('defending'), heading: base('heading'), vision: base('vision'), gk: base('gk'),
    };
    attr[keys[1]!] = 49.62; // makes "עוד 1 ל..." visible right away
    const club = clubView(userIdx);
    const coach: PersonView = { id: 11, name: 'אבי רוזנטל', role: 'coach', traits: ['prefers_youth', 'hot_tempered', 'tactician'], relation: 12, age: 52, clubId: club.id };
    const agent: PersonView = { id: 12, name: 'מיכל אורן', role: 'agent', traits: ['mentor', 'calm', 'loyal'], relation: 20, age: 41, clubId: null };
    const teammates: PersonView[] = [
      { id: 21, name: 'יונתן אלמוג', role: 'player', traits: ['loyal', 'party_animal'], relation: 34, age: 16, clubId: club.id },
      { id: 22, name: 'עומר בן חיים', role: 'player', traits: ['jealous', 'ambitious'], relation: -18, age: 17, clubId: club.id },
      { id: 23, name: 'דניאל קורן', role: 'player', traits: ['mentor', 'calm'], relation: 22, age: 18, clubId: club.id },
      { id: 24, name: 'אמיר חדאד', role: 'player', traits: ['gossip'], relation: 5, age: 16, clubId: club.id },
    ];
    const opp = clubView(0);
    const v: MView = {
      phase: 'plan',
      seed,
      absWeek: 0,
      season: { number: 1, year: 2026, week: 0, totalWeeks: 22, themes: ['relegation_fight', 'new_owner'] },
      player: {
        id: 1, name: `${cmd.firstName} ${cmd.lastName}`.trim(), age: typeof location !== 'undefined' && /[?&]veteran/.test(location.search) ? 31 : 15, pos: cmd.pos, attr, overall: 46, potentialRange: [68, 82],
        form: 2, fitness: 86, morale: 72, injury: typeof location !== 'undefined' && /[?&]injured/.test(location.search) ? { kind: 'קרע בשריר הירך', weeksLeft: 4 } : null,
        contract: { clubId: club.id, monthlyWage: 2500, endSeason: 2, role: 'prospect', releaseClause: null, bonuses: [{ kind: 'goal', amount: 300 }] },
        stats: { apps: 0, goals: 0, assists: 0, ratingSum: 0, cleanSheets: 0 },
        careerStats: { apps: 0, goals: 0, assists: 0, ratingSum: 0, cleanSheets: 0 },
        shirt: cmd.shirt ?? 17,
      },
      club,
      league: { id: 1, name: 'ליגת הנוער העל', country: 'ישראל' },
      table: makeTable(userIdx, 0),
      nextFixture: { opp, home: true, week: 0, derby: false },
      agent,
      coach,
      rival: { id: 31, name: 'אלון שושן', role: 'player', traits: ['ambitious', 'hot_tempered'], relation: -25, age: 15, clubId: 100, clubName: 'מכבי הכרמל', goals: 0, overall: 48 },
      career: {
        money: 4200, fame: 3,
        goals: [
          { id: 'g1', text: 'להיכנס להרכב הפותח', kind: 'apps', target: 3, progress: 1, reward: '+5 אמון מאמן', done: false, createdWeek: 0 },
          { id: 'g2', text: 'להגיע ל-50 ב' + (attrHe(keys[1]!)), kind: 'attr', target: 50, progress: 49.62, reward: 'מהלך מיוחד חדש', done: false, createdWeek: 0 },
          { id: 'g3', text: '5 שערים העונה', kind: 'goals', target: 5, progress: 0, reward: '+3 פרסום', done: false, createdWeek: 0 },
          { id: 'g4', text: 'חוזה מקצועני ראשון', kind: 'transfer', target: 1, progress: 0, reward: 'משכורת מלאה', done: false, createdWeek: 0 },
          { id: 'g5', text: 'לנצח את אלון שושן בדרבי', kind: 'custom', target: 1, progress: 1, reward: '+10 מוניטין', done: true, createdWeek: 0 },
        ],
        specialties: [], life: { stage: 'youth', armyStatus: 'none', home: 'parents', partner: null, kids: 0 },
        lastPlan: null, startKind, trophies: [], history: [], nationalCaps: 0, nationalGoals: 0, captain: false,
        offers: [
          { id: 501, fromClubId: 200, fee: 350000, wage: 9000, role: 'prospect', years: 3, expiresWeek: 4, viaAgentNote: 'הבלגים ראו אותך בטורניר. זה לא מחר, אבל תחשוב על זה.' },
          { id: 502, fromClubId: 102, fee: 0, wage: 4000, role: 'rotation', years: 2, expiresWeek: 3, viaAgentNote: 'בית״ר מבטיחים דקות. הכסף קטן, הבמה גדולה.' },
        ],
        negotiation: null, retired: false, seasonsPlayed: 0,
      },
      inbox: [],
      news: [
        { week: 0, absWeek: 0, headline: 'עונת הנוער נפתחת: מכבי הכרמל הפייבוריטית', body: 'שבעה שחקנים מהסגל עלו לנבחרת הנוער בקיץ.', kind: 'league' },
        { week: 0, absWeek: 0, headline: 'מכבי השרון מצרפת כישרון צעיר מהשכונה', kind: 'career' },
        { week: 0, absWeek: 0, headline: 'אלון שושן: "באתי להיות הכנף הכי טוב בארץ"', body: 'היריב שלך כבר מדבר בכותרות.', kind: 'rival' },
      ],
      live: null,
      lastWeekReport: null,
      offerClubs: { 200: foreignView(0), 201: foreignView(1), 102: clubView(2) },
      teammates,
      leagueZones: { promote: 0, relegate: 2, champion: 1 },
      people: { 11: coach, 12: agent, 21: teammates[0]!, 22: teammates[1]! },
    };
    return v;
  }

  function attrHe(k: AttrKey): string {
    return ({ finishing: 'סיומת', passing: 'מסירה', dribbling: 'דריבל', pace: 'מהירות', stamina: 'סיבולת', defending: 'הגנה', heading: 'משחק ראש', vision: 'ראיית משחק', gk: 'שוערות' } as const)[k];
  }

  function mkEvent(v: MView, n: number): ActiveEvent {
    const coach = v.coach!;
    if (n % 2 === 0) {
      return {
        uid: 900 + n, templateId: 'coach_extra_session', category: 'team', week: v.season.week,
        title: 'המאמן מחכה בחדר',
        body: `${coach.name} סוגר את הדלת. "ראיתי אותך באימון. יש לך רגליים, אבל אתה משחק לבד. ביום חמישי אני רוצה אותך באימון נוסף עם הקשרים. מה אתה אומר?"`,
        because: 'כי בשבוע שעבר בחרת לנוח במקום אימון הקבוצה',
        cast: { coach: coach.id },
        options: [
          { id: 'yes', text: 'אני שם. בשבע בבוקר', hint: 'אמון המאמן עולה, הכושר יורד' },
          { id: 'ask', text: '"אפשר לדבר על הדקות שלי?"', hint: 'הוא יעריך את הישירות. או שלא' },
          { id: 'no', text: 'יש לי מבחן בבית ספר', hint: 'מנוחה, אבל המאמן יזכור' },
        ],
      };
    }
    return {
      uid: 900 + n, templateId: 'rival_challenge', category: 'rival', week: v.season.week,
      title: 'אלון שושן מתקשר',
      body: 'הטלפון מצלצל בעשר בלילה. "שמעתי שאתה פותח בשבת. תהנה מזה, כי בשבוע הבא אני מגיע לשחק נגדך."',
      because: 'כי בשבוע 2 עקפת אותו בכותרת של העיתון המקומי',
      cast: { rival: v.rival!.id },
      options: [
        { id: 'smile', text: 'לחייך ולנתק', hint: 'שקט נפשי' },
        { id: 'trash', text: '"נתראה על הדשא, אחי"', hint: 'פרסום עולה, היריבות מתחממת' },
      ],
    };
  }

  function startLive(v: MView): LiveMatch {
    const kinds = MOMENTS_BY_POS[v.player.pos];
    const minutes = [23, 61, 84];
    const opp = v.nextFixture!.opp;
    const moments: MomentSpec[] = minutes.map((m, i) => ({
      id: 700 + i, kind: kinds[i % kinds.length]!, minute: m, difficulty: 0.35 + i * 0.12,
      attackerSkill: Math.floor(v.player.attr[POS_KEY[v.player.pos][0]!]), opponentId: 40 + i,
      opponentName: ['רועי גבאי', 'שי מזרחי', 'אלון שושן'][i]!,
      context: { lateClose: m > 80, hostileCrowd: !v.nextFixture!.home, rivalInvolved: i === 2, rain: false, derby: v.nextFixture!.derby },
      scoreBefore: [0, 0], stakes: '',
    }));
    const live: LiveMatch = {
      fixture: { week: v.season.week, home: v.nextFixture!.home ? v.club!.id : opp.id, away: v.nextFixture!.home ? opp.id : v.club!.id, played: false, hg: 0, ag: 0 },
      leagueId: 1, userClubId: v.club!.id, oppClubId: opp.id, isHome: v.nextFixture!.home, segment: 0, score: [0, 0], moments,
      pendingMomentIndex: 0, highlights: [], userRating: 6.4, userMinutes: 90, userGoals: 0, userAssists: 0,
      weather: v.absWeek % 3 === 1 ? 'rain' : 'clear', started: v.absWeek % 4 !== 3, derby: v.nextFixture!.derby,
    };
    fillUntil(v, live, 0, minutes[0]!);
    return live;
  }

  function userIdx(live: LiveMatch): 0 | 1 { return live.isHome ? 0 : 1; }

  function fillUntil(v: MView, live: LiveMatch, from: number, to: number): void {
    const opp = v.nextFixture!.opp;
    const script: MatchHighlight[] = [
      { minute: 9, kind: 'chance', text: `${opp.short} מאיימים מקרן, הכדור עובר מעל המשקוף` },
      { minute: 17, kind: 'card', text: 'כרטיס צהוב לבלם של ' + opp.short },
      { minute: 34, kind: 'goal', text: `שער! ${opp.name} עולה ליתרון בבעיטה מחוץ לרחבה` },
      { minute: 45, kind: 'chance', text: 'מחצית. המאמן צועק על הקו האחורי' },
      { minute: 52, kind: 'save', text: 'השוער שלנו מציל במקרה בתוך השער' },
      { minute: 70, kind: 'goal', text: `שער! ${v.club!.short} משווה: נגיחה של דניאל קורן מקרן` },
      { minute: 77, kind: 'sub', text: 'חילוף אצלם: הקשר העייף יוצא' },
      { minute: 89, kind: 'chance', text: 'לחץ אחרון, הכדור נחסם על הקו' },
    ];
    for (const h of script) {
      if (h.minute > from && h.minute <= to) {
        live.highlights.push(h);
        if (h.kind === 'goal') {
          const mine = h.text.includes(v.club!.short);
          const i = mine ? userIdx(live) : 1 - userIdx(live);
          live.score[i]! += 1;
        }
      }
    }
    live.segment = Math.min(18, Math.floor(to / 5));
  }

  function finishMatch(v: MView): void {
    const live = v.live!;
    fillUntil(v, live, live.moments[live.moments.length - 1]?.minute ?? 0, 90);
    live.segment = 18;
    live.fixture.played = true;
    [live.fixture.hg, live.fixture.ag] = live.score;
    const keys = POS_KEY[v.player.pos];
    const plan = v.career.lastPlan ?? ['train_' + keys[0], 'rest', 'train_' + keys[1]];
    const gains = keys.map((k, i) => {
      const before = v.player.attr[k];
      const after = before + (i === 1 ? 0.9 : 1.6) * (plan.filter((p) => p === 'train_' + k).length || 0.6);
      v.player.attr[k] = after;
      return { key: k, before, after };
    });
    gains.push({ key: 'stamina', before: v.player.attr.stamina, after: v.player.attr.stamina + 0.6 });
    v.player.attr.stamina += 0.6;
    v.player.stats.apps += 1;
    v.player.stats.goals += live.userGoals;
    v.player.stats.ratingSum += live.userRating;
    const won = live.score[userIdx(live)]! > live.score[1 - userIdx(live)]!;
    const opp = v.nextFixture!.opp;
    const report: WeekReport = {
      absWeek: v.absWeek, seasonWeek: v.season.week,
      result: { home: live.fixture.home, away: live.fixture.away, hg: live.score[0], ag: live.score[1] },
      userRating: Math.round(live.userRating * 10) / 10, userGoals: live.userGoals, userAssists: live.userAssists, gains,
      headline: live.userGoals > 0
        ? `${v.player.name.split(' ')[0]} בן ה-15 שובר את ${opp.name}`
        : won ? `${v.club!.name} מנצחת. ${v.player.name.split(' ')[1] ?? ''} מסמן את הדרך` : `${opp.name} יוצאת עם נקודות. רגע חסר בסיום`,
      meanwhile: [
        'בית״ר הגליל פיטרה את המאמן אחרי שלושה הפסדים רצופים',
        'אלון שושן כבש צמד והוא מלך השערים של הליגה (4)',
        'עירוני הנגב החתימה בלם מהנבחרת הצעירה',
      ],
      openLoops: [
        'בשבת הבאה: דרבי השרון מול הכוח יפו, והקהל כבר מתחמם',
        'מיכל אורן: "יש עניין מבלגיה. אל תדבר עם אף אחד לפני שאני מתקשרת"',
        'המאמן ביקש לראות אותך ביום שלישי',
      ],
      nearGoals: [
        ((a: number) => { const t = Math.floor(a / 5) * 5 + 5; return { text: `עוד ${Math.max(1, Math.ceil(t - a))} ל${attrHe(keys[1]!)} ${t}`, progress: a, target: t }; })(v.player.attr[keys[1]!]),
        { text: 'עוד 2 הופעות בהרכב לפרס המאמן', progress: 1, target: 3 },
      ],
      notable: live.userGoals > 0,
    };
    v.lastWeekReport = report;
    v.phase = report.notable ? 'weekend' : 'postmatch';
    v.player.fitness = Math.max(30, v.player.fitness - 24);
    v.news = [{ week: v.season.week, absWeek: v.absWeek, headline: report.headline!, kind: 'match' as const }, ...v.news].slice(0, 30);
  }

  function resolveMoment(v: MView, ok: boolean, quality: number): void {
    const live = v.live!;
    const m = live.moments[live.pendingMomentIndex];
    if (!m) return;
    const name = v.player.name.split(' ')[0];
    let text = '';
    if (ok && SCORING.includes(m.kind)) {
      live.score[userIdx(live)]! += 1;
      live.userGoals += 1;
      text = `שער! ${name} לא מפספס. ${v.club!.short} חוגגים`;
      live.highlights.push({ minute: m.minute, kind: 'goal', text });
    } else if (ok) {
      text = m.kind === 'dribble' ? `${name} עובר את ${m.opponentName} ומרים לרחבה` : m.kind === 'cross' ? `הגבהה מדויקת של ${name}, נגיחה לידי השוער` : `${name} מנצח את הדו-קרב מול ${m.opponentName}`;
      live.highlights.push({ minute: m.minute, kind: 'moment', text });
    } else {
      text = `${name} מאבד את הכדור מול ${m.opponentName}`;
      live.highlights.push({ minute: m.minute, kind: 'moment', text });
    }
    live.userRating = Math.min(9.6, Math.max(4.5, live.userRating + (ok ? 0.5 + quality * 0.6 : -0.3)));
    live.pendingMomentIndex += 1;
    const next = live.moments[live.pendingMomentIndex];
    if (next) {
      fillUntil(v, live, m.minute, next.minute);
      next.scoreBefore = live.isHome ? [live.score[0], live.score[1]] : [live.score[1], live.score[0]];
      next.stakes = `דקה ${next.minute}, ${next.scoreBefore[0]}-${next.scoreBefore[1]}`;
    }
  }

  function ensureStakes(live: LiveMatch): void {
    const m = live.moments[live.pendingMomentIndex];
    if (m && !m.stakes) {
      m.scoreBefore = live.isHome ? [live.score[0], live.score[1]] : [live.score[1], live.score[0]];
      m.stakes = `דקה ${m.minute}, ${m.scoreBefore[0]}-${m.scoreBefore[1]}`;
    }
  }

  function nextWeek(v: MView): void {
    v.absWeek += 1;
    v.season.week += 1;
    v.phase = 'plan';
    v.live = null;
    v.lastWeekReport = null;
    v.table = makeTable(st!.userClubIdx, v.season.week);
    const oppIdx = (v.season.week * 5 + 1) % IL_CLUBS.length;
    const idx = oppIdx === st!.userClubIdx ? 8 : oppIdx;
    v.nextFixture = { opp: clubView(idx), home: v.season.week % 2 === 0, week: v.season.week, derby: idx === 8 };
    v.player.fitness = Math.min(100, v.player.fitness + 10);
  }

  const res = (toast?: string[]): ApplyResult => ({ view: structuredClone(st!.view), saveDue: true, toast });

  function apply(cmd: Command): ApplyResult {
    if (!st) throw new Error('no career');
    const v = st.view;
    switch (cmd.type) {
      case 'setPlan': {
        v.career.lastPlan = cmd.plan;
        const rests = cmd.plan.filter((p) => p === 'rest').length;
        v.player.fitness = Math.max(20, Math.min(100, v.player.fitness + rests * 12 - (3 - rests) * 6));
        st.rnd += 1;
        if (st.rnd % 2 === 1) {
          v.inbox = [mkEvent(v, st.rnd)];
          v.phase = 'event';
        } else v.phase = 'prematch';
        return res();
      }
      case 'quickWeek': {
        if (!v.career.lastPlan) v.career.lastPlan = defaultPlan(v.player.pos);
        v.inbox = [];
        v.phase = 'prematch';
        return res(['שבוע מהיר: אותה תוכנית כמו בשבוע שעבר']);
      }
      case 'resolveEvent': {
        v.inbox = v.inbox.filter((e) => e.uid !== cmd.uid);
        if (v.coach && cmd.optionId === 'yes') v.coach.relation += 6;
        if (v.inbox.length === 0) v.phase = 'prematch';
        return res(cmd.optionId === 'yes' ? ['אמון המאמן +6'] : undefined);
      }
      case 'startMatch': {
        v.live = startLive(v);
        ensureStakes(v.live);
        v.phase = 'match';
        return res();
      }
      case 'momentResult': {
        if (!v.live) return res();
        resolveMoment(v, cmd.result.skipped ? r() < 0.45 : cmd.result.success, cmd.result.quality);
        ensureStakes(v.live);
        if (v.live.pendingMomentIndex >= v.live.moments.length) finishMatch(v);
        return res();
      }
      case 'simRestOfMatch': {
        if (!v.live) return res();
        while (v.live.pendingMomentIndex < v.live.moments.length) resolveMoment(v, r() < 0.4, 0.5);
        finishMatch(v);
        return res();
      }
      case 'finishWeek': {
        nextWeek(v);
        return res();
      }
      case 'respondOffer': {
        const offer = v.career.offers.find((o) => o.id === cmd.offerId);
        if (!offer) return res();
        if (cmd.action === 'reject') {
          v.career.offers = v.career.offers.filter((o) => o.id !== cmd.offerId);
          return res(['ההצעה נדחתה']);
        }
        v.career.negotiation = {
          clubId: offer.fromClubId, offerId: offer.id, round: 1, patience: 82, hiddenCeiling: Math.round(offer.wage * 1.32),
          agentRange: [Math.round(offer.wage * 1.08 / 100) * 100, Math.round(offer.wage * 1.42 / 100) * 100],
          currentOffer: { wage: offer.wage, role: offer.role, years: offer.years, releaseClause: null },
          log: [`המנהל: "אנחנו מאמינים בך, אבל עדיין מוקדם. ${fmt(offer.wage)} לחודש, ${offer.years} שנים."`],
          status: 'open',
        };
        v.phase = 'negotiation';
        return res();
      }
      case 'requestRenewal': {
        const c = v.player.contract!;
        v.career.negotiation = {
          clubId: c.clubId, offerId: null, round: 1, patience: 70, hiddenCeiling: c.monthlyWage * 2,
          agentRange: [Math.round(c.monthlyWage * 1.4), Math.round(c.monthlyWage * 2.1)],
          currentOffer: { wage: Math.round(c.monthlyWage * 1.25), role: c.role, years: 2, releaseClause: null },
          log: ['המנהל: "אתה רוצה חוזה חדש? הראית משהו, אבל רק משהו."'], status: 'open',
        };
        v.phase = 'negotiation';
        return res();
      }
      case 'negotiate': {
        const n = v.career.negotiation;
        if (!n) return res();
        const over = cmd.demand.wage / n.hiddenCeiling;
        const roleCost: Record<SquadRole, number> = { star: 30, starter: 14, rotation: 4, prospect: 0, backup: -4 };
        n.patience = Math.max(0, n.patience - Math.round(14 + Math.max(0, over - 0.9) * 90 + roleCost[cmd.demand.role] / 2 + (cmd.demand.releaseClause ? 6 : 0)));
        n.log.push(`אתה: ${fmt(cmd.demand.wage)} לחודש, ${roleHe(cmd.demand.role)}, ${cmd.demand.years} שנים${cmd.demand.releaseClause ? ', עם סעיף שחרור' : ''}`);
        if (n.patience <= 0) {
          n.status = 'walked_away';
          n.log.push('המנהל קם מהשולחן: "תודה, נמשיך הלאה."');
          v.career.negotiation = null;
          v.phase = 'plan';
          return res(['המועדון סגר את הדלת']);
        }
        const meet = Math.round(Math.min(cmd.demand.wage, (n.currentOffer.wage + Math.min(cmd.demand.wage, n.hiddenCeiling)) / 2) / 100) * 100;
        n.currentOffer = { wage: meet, role: roleCost[cmd.demand.role] > 14 ? 'starter' : cmd.demand.role, years: cmd.demand.years, releaseClause: cmd.demand.releaseClause };
        n.round += 1;
        n.log.push(n.round > 3 ? `המנהל: "זו ההצעה האחרונה: ${fmt(meet)}. לקחת או לעזוב."` : n.patience < 40 ? `המנהל מתופף על השולחן. "${fmt(meet)}. ואני כבר מתחיל להתעייף."` : `המנהל: "אפשר להגיע ל-${fmt(meet)}. זה רציני מבחינתנו."`);
        return res();
      }
      case 'acceptNegotiation': {
        const n = v.career.negotiation;
        if (n && v.player.contract) {
          v.player.contract = { ...v.player.contract, monthlyWage: n.currentOffer.wage, role: n.currentOffer.role, releaseClause: n.currentOffer.releaseClause, endSeason: v.season.number + n.currentOffer.years };
          if (n.offerId) v.career.offers = v.career.offers.filter((o) => o.id !== n.offerId);
        }
        v.career.negotiation = null;
        v.phase = 'plan';
        return res(['חתמת! החוזה החדש נכנס לתוקף']);
      }
      case 'walkAway': {
        v.career.negotiation = null;
        v.phase = 'plan';
        return res(['קמת מהשולחן']);
      }
      case 'retire': {
        v.phase = 'retired';
        v.career.retired = true;
        v.career.retirementReason = 'פרש בגיל 34 אחרי 19 עונות';
        v.player.age = 34;
        v.player.careerStats = { apps: 512, goals: 143, assists: 121, ratingSum: 512 * 7.1, cleanSheets: 0 };
        v.career.trophies = ['אליפות ישראל 2033', 'עלייה ליגה עם קלאב נקסט 2030', 'גביע המדינה 2031', 'אליפות בלגיה 2036', 'מלך השערים 2034', 'עלייה ליגה עם קלאב נקסט 2033'];
        v.career.nationalCaps = 46;
        v.career.nationalGoals = 12;
        v.career.history = [
          { season: 1, year: 2026, clubId: 104, leagueId: 1, apps: 18, goals: 4, assists: 3, avgRating: 6.8, position: 3 },
          { season: 6, year: 2031, clubId: 102, leagueId: 2, apps: 33, goals: 14, assists: 9, avgRating: 7.3, position: 2 },
          { season: 9, year: 2034, clubId: 200, leagueId: 3, apps: 36, goals: 19, assists: 11, avgRating: 7.6, position: 1 },
          { season: 14, year: 2039, clubId: 201, leagueId: 4, apps: 29, goals: 8, assists: 10, avgRating: 7.0, position: 4 },
          { season: 19, year: 2044, clubId: 104, leagueId: 1, apps: 21, goals: 1, assists: 4, avgRating: 6.9, position: 6 },
        ];
        // core round 3 shapes: every career club + the two story lines
        Object.assign(v, {
          careerClubs: { 104: clubView(4), 102: clubView(2), 200: foreignView(0), 201: foreignView(1) },
          careerStory: { turningPoint: 'לסרב לבלגים בגיל 17 ולהישאר עוד עונה בבית', keyPerson: 'אבי רוזנטל, המאמן הראשון' },
        });
        return res();
      }
      case 'setAutoMoments':
        return res();
      case 'newCareer':
        return res();
    }
  }

  return {
    async newCareer(cmd) {
      await delay(250);
      st = { view: newView(cmd), rnd: 0, userClubIdx: 4 };
      return res();
    },
    async apply(cmd) {
      await delay(cmd.type === 'quickWeek' ? 220 : 60);
      return apply(cmd);
    },
    async load(json) {
      const parsed = JSON.parse(json) as { mock?: MockState };
      if (!parsed.mock?.view) throw new Error('קובץ שמירה לא תקין');
      st = parsed.mock;
      r = rng(st.view.seed + st.view.absWeek);
      return { view: structuredClone(st.view), saveDue: false };
    },
    async exportSave() {
      return JSON.stringify({ format: 'football-career-save', version: 1, mock: st });
    },
  };
}

function defaultPlan(pos: Position): [PlanSlot, PlanSlot, PlanSlot] {
  const k = POS_KEY[pos];
  return [`train_${k[0]}` as PlanSlot, 'rest', `train_${k[1]}` as PlanSlot];
}
function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function fmt(n: number) {
  return `₪${n.toLocaleString('he-IL')}`;
}
function roleHe(r: SquadRole) {
  return ({ star: 'כוכב', starter: 'הרכב', rotation: 'רוטציה', prospect: 'כישרון', backup: 'מחליף' } as const)[r];
}
