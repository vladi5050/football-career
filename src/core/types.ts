// ============================================================================
// Core data model. PURE DATA: no classes, no functions, no circular refs.
// The whole World is JSON-serialisable. Cross references are numeric ids.
// Layer rule: src/core imports nothing from ui/, match/, worker/ or the DOM.
// ============================================================================

export type Position = 'GK' | 'CB' | 'FB' | 'DM' | 'CM' | 'AM' | 'W' | 'ST';
export const POSITIONS: Position[] = ['GK', 'CB', 'FB', 'DM', 'CM', 'AM', 'W', 'ST'];

/** 8 outfield abilities 1..99 (fractional, UI shows floor). GK uses `gk`. */
export interface Attributes {
  finishing: number; // סיומת
  passing: number; // מסירה
  dribbling: number; // שליטה בכדור / דריבל
  pace: number; // מהירות
  stamina: number; // סיבולת
  defending: number; // הגנה
  heading: number; // משחק ראש
  vision: number; // ראיית משחק
  gk: number; // שוערות (meaningful only for GK)
}
export type AttrKey = keyof Attributes;

export type Role = 'player' | 'coach' | 'agent' | 'journalist' | 'chairman' | 'family';

export type TraitId =
  | 'hot_tempered' | 'loyal' | 'greedy' | 'grateful' | 'prefers_youth' | 'hates_press'
  | 'calm' | 'ambitious' | 'jealous' | 'mentor' | 'superstitious' | 'tactician'
  | 'party_animal' | 'workaholic' | 'gossip';

export interface Memory { tag: string; week: number; weight: number }
export interface Relation { score: number; memories: Memory[] } // -100..100, <=5 memories

export interface Person {
  id: number;
  name: string;
  role: Role;
  age: number;
  nationality: string; // ISO-ish code: 'IL','BE','NL','PT',...
  traits: TraitId[];
  relations: Record<number, Relation>; // keyed by other person id (mostly the user's player)
  clubId: number | null;
  /** R&D addition: agent archetype (agents only). */
  archetype?: AgentArchetype;
}

/** R&D addition. shark = כריש, mentor = מנטורית, uncle = דוד */
export type AgentArchetype = 'shark' | 'mentor' | 'uncle';

export type SquadRole = 'star' | 'starter' | 'rotation' | 'prospect' | 'backup';

export interface Bonus { kind: 'goal' | 'appearance' | 'title'; amount: number }
export interface Contract {
  clubId: number;
  monthlyWage: number; // NIS / month
  endSeason: number; // season number (1 = first season)
  role: SquadRole;
  releaseClause: number | null;
  bonuses: Bonus[];
}

export interface Injury { kind: string; weeksLeft: number }

export interface SeasonStats { apps: number; goals: number; assists: number; ratingSum: number; cleanSheets: number }

export interface Footballer extends Person {
  role: 'player';
  pos: Position;
  attr: Attributes;
  potential: number; // 1..99 hidden ceiling of overall
  form: number; // -10..10
  fitness: number; // 0..100
  morale: number; // 0..100
  injury: Injury | null;
  contract: Contract | null;
  agentId: number | null;
  stats: SeasonStats;
  careerStats: SeasonStats;
  retired?: boolean;
  /** R&D addition: shirt number (user's player). */
  shirt?: number;
}

export type CrestSpec = [shape: number, division: number, palette: number, charge: number];

export interface Club {
  id: number;
  name: string;
  short: string; // 3-6 letters/short name for tables
  city: string;
  countryCode: string;
  leagueId: number;
  reputation: number; // 1..100
  budget: number; // yearly wage budget, NIS
  colors: [string, string];
  crest: CrestSpec;
  managerId: number;
  chairmanId: number;
  squad: number[]; // footballer ids
  rivalClubId: number | null;
  stadium: string;
  /** R&D addition: squad not generated yet (result-only league). Strength comes from league strength + reputation; materialised on demand. */
  lazy?: boolean;
  /** R&D addition: region/group hint for multi-group lower leagues (from content). */
  region?: string;
  /** R&D addition: reserve (B) team of this club id: never promoted into the parent's league or above. */
  reserveOf?: number;
}

export interface League {
  id: number;
  name: string;
  countryCode: string;
  country: string; // Hebrew country name
  tier: number; // 1 = top
  clubIds: number[];
  promotesTo: number | null;
  relegatesTo: number | null;
  promoteSpots: number;
  relegateSpots: number;
  strength: number; // 1..100 average level
  wageFactor: number; // multiplier vs Israeli Premier League
  simLevel: 'full' | 'medium' | 'result';
  /** R&D addition: content key (e.g. "il1"). */
  key?: string;
  /** R&D addition: all leagues this one promotes into / relegates into (multi-group levels). promotesTo/relegatesTo hold the first. */
  promotesToIds?: number[];
  relegatesToIds?: number[];
  /** R&D addition: region of a regional group (e.g. "צפון"), used to place relegated clubs. */
  region?: string;
}

export interface Fixture {
  week: number; // season week index (0-based)
  home: number;
  away: number;
  played: boolean;
  hg: number;
  ag: number;
  scorers?: { playerId: number; minute: number; clubId: number }[];
}

export interface TableRow { clubId: number; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number; form: string[] }

export interface Season {
  number: number; // 1-based
  year: number; // calendar year the season starts
  week: number; // current week index
  totalWeeks: number;
  fixtures: Record<number, Fixture[]>; // leagueId -> fixtures
  tables: Record<number, TableRow[]>;
  themes: string[]; // season theme ids
  /** R&D addition: absWeek of season week 0. */
  startAbsWeek?: number;
  /** R&D addition: shuffled club order per league; fixtures are a pure function of it (lets the save drop them). */
  orders?: Record<number, number[]>;
  /** R&D addition: small leagues play 3-4 round robins this season (leagues of up to 12 clubs). Older seasons: 2. */
  multiLeg?: boolean;
}

// ---------------------------------------------------------------- the user's career

export type LifeStage = 'youth' | 'army' | 'pro' | 'veteran' | 'retired';
export interface LifeState {
  stage: LifeStage;
  armyStatus: 'none' | 'outstanding_athlete' | 'serving' | 'done' | 'exempt';
  home: 'parents' | 'rented' | 'own';
  partner: string | null;
  kids: number;
}

export interface Goal {
  id: string;
  text: string; // Hebrew
  kind: 'attr' | 'goals' | 'apps' | 'transfer' | 'title' | 'money' | 'fame' | 'national' | 'captain' | 'custom';
  target: number;
  progress: number;
  reward: string;
  done: boolean;
  createdWeek: number;
}

export type PlanSlot = 'train_finishing' | 'train_passing' | 'train_dribbling' | 'train_pace' | 'train_stamina'
  | 'train_defending' | 'train_heading' | 'train_vision' | 'train_gk' | 'rest' | 'team_night' | 'talk_coach'
  | 'extra_gym' | 'media' | 'family';
/** 3 free days (Tue/Wed/Thu); Saturday is match day. */
export type WeekPlan = [PlanSlot, PlanSlot, PlanSlot];

export interface Career {
  playerId: number;
  agentId: number;
  rivalId: number; // a rival footballer id
  money: number;
  fame: number; // 0..100
  goals: Goal[];
  specialties: string[];
  life: LifeState;
  lastPlan: WeekPlan | null;
  startKind: 'israel' | 'foreign_academy' | 'raised_abroad';
  seasonsPlayed: number;
  trophies: string[];
  history: CareerSeasonRecord[];
  nationalCaps: number;
  nationalGoals: number;
  captain: boolean;
  promises: Promise[];
  offers: TransferOffer[];
  negotiation: Negotiation | null;
  retired: boolean;
  retirementReason?: string;
  /** R&D addition: fixed people around the user: father, mother, friend, firstCoach -> person id. */
  circle?: Record<string, number>;
  /** R&D addition: minutes in the last (up to 5) user matches, newest last. */
  recentMinutes?: number[];
  /** R&D addition: ratings in the last (up to 5) matches played, newest last. */
  recentRatings?: number[];
  /** R&D addition: the user's last match summary (for event conditions). */
  lastMatch?: { absWeek: number; result: number; rating: number; started: boolean; minutes: number };
  /** R&D addition: Hebrew start story line ("סקאוט של אקדמיה..."). */
  startStory?: string;
  /** R&D addition: this week's matchday decision, made when the week reaches pre-match (startMatch honours it). */
  prematch?: PrematchDecision | null;
  /** R&D addition: the current week runs as a quick week (goes straight into the match after events). */
  quickFlow?: boolean;
  /** R&D addition: per attribute, [value at one decimal, absWeek it last moved] (near goals rotate out when stalled). */
  attrMoved?: Partial<Record<AttrKey, [number, number, number?, number?]>>;
  /** R&D addition: events quick week answered this week ("title: option"), moved into the week report. */
  autoAnswered?: string[];
  /** R&D addition: renewal talks with the current club are off until this absWeek (after the club walked out). */
  renewalBlockedUntil?: number;
}

/** R&D addition: matchday status of the user, decided before the match. */
export interface PrematchDecision { absWeek: number; lineup: 'starter' | 'bench' | 'youth' | 'out'; subMinute: number | null; reason: string; firstMatch: boolean }

export interface CareerSeasonRecord { season: number; year: number; clubId: number; leagueId: number; apps: number; goals: number; assists: number; avgRating: number; position: number }

export interface Promise { id: string; by: number; text: string; dueWeek: number; kept: boolean | null }

export interface TransferOffer {
  id: number;
  fromClubId: number;
  fee: number;
  wage: number; // proposed monthly wage
  role: SquadRole;
  years: number;
  expiresWeek: number; // absolute week number
  viaAgentNote: string; // Hebrew line from the agent
}

export interface Negotiation {
  clubId: number;
  offerId: number | null; // null = renewal at current club
  round: number; // 1..3
  patience: number; // 0..100
  hiddenCeiling: number; // monthly wage
  agentRange: [number, number];
  currentOffer: { wage: number; role: SquadRole; years: number; releaseClause: number | null };
  log: string[];
  status: 'open' | 'signed' | 'walked_away';
  /** R&D addition: true when currentOffer is the club's last offer (after round 3): only accept or walk away. */
  final?: boolean;
  /** R&D addition: the phase to return to when the negotiation closes. */
  returnPhase?: GamePhase;
}

// ---------------------------------------------------------------- events

export interface ActiveEvent {
  uid: number;
  templateId: string;
  title: string;
  body: string;
  because: string | null; // "כי בשבוע 4..." line
  cast: Record<string, number>; // roleName -> person id
  options: { id: string; text: string; hint?: string }[];
  week: number;
  category: string;
}

export interface ScheduledEvent { templateId: string; atWeek: number; cast: Record<string, number>; flags?: Record<string, number> }

export interface HistoryEntry { week: number; tag: string; templateId?: string; text?: string; cast?: Record<string, number> }

export interface EventHistory {
  entries: HistoryEntry[]; // capped
  lastSeen: Record<string, number>; // templateId -> absolute week
  usedVariants: Record<string, number[]>; // templateId -> used variant indexes
  recentCategories: string[]; // last N categories
  flags: Record<string, number>; // arbitrary counters set by effects
}

// ---------------------------------------------------------------- match

export type MomentKind =
  | 'shot' | 'one_on_one' | 'header' | 'dribble' | 'through_ball' | 'long_shot' | 'interception'
  | 'tackle' | 'block' | 'clearance' | 'save' | 'rush_out' | 'penalty' | 'free_kick' | 'cross';

export interface ContextMods { lateClose: boolean; hostileCrowd: boolean; rivalInvolved: boolean; rain: boolean; derby: boolean }

export interface MomentSpec {
  id: number;
  kind: MomentKind;
  minute: number;
  difficulty: number; // 0..1 (higher = harder)
  attackerSkill: number; // relevant user skill 1..99
  opponentId: number | null; // defender / keeper person id
  opponentName: string;
  context: ContextMods;
  scoreBefore: [number, number]; // [userTeam, opp]
  stakes: string; // Hebrew line e.g. "דקה 88, 1-1"
}

export interface MomentResult { momentId: number; success: boolean; quality: number /* 0..1 */; skipped: boolean }

export interface MatchHighlight { minute: number; text: string; kind: 'goal' | 'chance' | 'card' | 'save' | 'moment' | 'injury' | 'sub' }

export interface LiveMatch {
  fixture: Fixture;
  leagueId: number;
  userClubId: number;
  oppClubId: number;
  isHome: boolean;
  segment: number; // 0..18
  score: [number, number]; // [home, away]
  moments: MomentSpec[];
  pendingMomentIndex: number;
  highlights: MatchHighlight[];
  userRating: number;
  userMinutes: number;
  userGoals: number;
  userAssists: number;
  weather: 'clear' | 'rain' | 'wind';
  started: boolean; // user is in starting XI
  derby: boolean;
  /** R&D addition: minute the user came on as a substitute (null/undefined = started or did not play). */
  subMinute?: number | null;
  /** R&D addition: final whistle reached. */
  finished?: boolean;
  /** R&D addition: youth-team (U19) match. The user was not in the senior matchday squad; result does not touch the league table or senior stats. */
  youth?: boolean;
  /** R&D addition: the user's first career match (exactly 3 moments, a gentle first one, one scoring chance). */
  firstMatch?: boolean;
}

// ---------------------------------------------------------------- the world

export interface World {
  version: number;
  seed: number;
  rngState: [number, number, number, number];
  absWeek: number; // absolute weeks since career start
  season: Season;
  leagues: League[];
  clubs: Club[];
  people: Record<number, Person | Footballer>;
  nextId: number;
  career: Career;
  pending: ScheduledEvent[];
  history: EventHistory;
  inbox: ActiveEvent[]; // unresolved events for this week
  news: NewsItem[]; // newest first, capped
  live: LiveMatch | null;
  phase: GamePhase;
  lastWeekReport: WeekReport | null;
  settings: { autoMoments: boolean };
}

export type GamePhase = 'plan' | 'event' | 'prematch' | 'match' | 'postmatch' | 'weekend' | 'offseason' | 'negotiation' | 'retired';

export interface NewsItem { week: number; absWeek: number; headline: string; body?: string; kind: 'match' | 'transfer' | 'sacking' | 'career' | 'rival' | 'league' | 'event' }

export interface AttrGain { key: AttrKey; before: number; after: number }

export interface WeekReport {
  absWeek: number;
  seasonWeek: number;
  result: { home: number; away: number; hg: number; ag: number } | null;
  userRating: number | null;
  userGoals: number;
  userAssists: number;
  gains: AttrGain[];
  headline: string | null;
  meanwhile: string[]; // "בינתיים בליגה" lines
  openLoops: string[]; // "מה מחכה לך" items
  nearGoals: { text: string; progress: number; target: number }[];
  notable: boolean; // true -> show "world reacts" screen
  /** R&D addition: events quick week answered for the user this week ("title: chosen option"), so they are not invisible. */
  autoEvents?: string[];
  /** R&D addition: Hebrew line shown under "מה השתפר" when no attribute moved by 0.1 or more. */
  gainsNote?: string;
}

// ---------------------------------------------------------------- view snapshot sent to UI

export interface PlayerView {
  id: number; name: string; age: number; pos: Position; attr: Attributes; overall: number;
  potentialRange: [number, number]; form: number; fitness: number; morale: number;
  injury: Injury | null; contract: Contract | null; stats: SeasonStats; careerStats: SeasonStats; shirt: number;
}

export interface ClubView { id: number; name: string; short: string; city: string; colors: [string, string]; crest: CrestSpec; reputation: number; leagueName: string; country: string; stadium: string }

export interface PersonView { id: number; name: string; role: Role; traits: TraitId[]; relation: number; age: number; clubId: number | null; archetype?: AgentArchetype }

export interface View {
  phase: GamePhase;
  seed: number;
  absWeek: number;
  season: { number: number; year: number; week: number; totalWeeks: number; themes: string[] };
  player: PlayerView;
  club: ClubView | null;
  league: { id: number; name: string; country: string } | null;
  table: (TableRow & { name: string; short: string; colors: [string, string]; crest: CrestSpec })[];
  nextFixture: { opp: ClubView; home: boolean; week: number; derby: boolean } | null;
  agent: PersonView;
  coach: PersonView | null;
  rival: (PersonView & { clubName: string; goals: number; overall: number }) | null;
  career: Pick<Career, 'money' | 'fame' | 'goals' | 'specialties' | 'life' | 'lastPlan' | 'startKind' | 'trophies' | 'history' | 'nationalCaps' | 'nationalGoals' | 'captain' | 'offers' | 'negotiation' | 'retired' | 'retirementReason' | 'seasonsPlayed' | 'renewalBlockedUntil'>;
  inbox: ActiveEvent[];
  news: NewsItem[];
  live: LiveMatch | null;
  lastWeekReport: WeekReport | null;
  offerClubs: Record<number, ClubView>;
  /** R&D addition: the user's squad mates with their relation to him. */
  teammates?: PersonView[];
  /** R&D addition: everyone referenced by inbox[].cast plus coach, agent, rival; keyed by id. */
  people?: Record<number, PersonView>;
  /** R&D addition: table zones of the user's league (top `champion` rows, top `promote`, bottom `relegate`). */
  /** rounds: league matches per club this season (small leagues play 3-4 round robins). */
  leagueZones?: { promote: number; relegate: number; champion?: number; rounds?: number };
  /** R&D addition: user settings. */
  settings?: { autoMoments: boolean };
  /** R&D addition: every club of the career (history + current), keyed by id. */
  careerClubs?: Record<number, ClubView>;
  /** R&D addition: career-end lines (Hebrew): the move that changed everything, the person who mattered most. */
  careerStory?: { turningPoint?: string; keyPerson?: string };
  /** R&D addition: the user's matchday status for this week, present in the prematch phase. */
  prematch?: { lineup: 'starter' | 'bench' | 'youth' | 'out'; reason: string; subMinute: number | null };
}

// ---------------------------------------------------------------- commands (UI -> core)

export type Command =
  | { type: 'newCareer'; seed?: number; pos: Position; firstName: string; lastName: string; shirt?: number; clubsOverride?: unknown }
  | { type: 'setPlan'; plan: WeekPlan }
  | { type: 'quickWeek' } // repeat last plan, auto-resolve events with default option, jump to match
  | { type: 'resolveEvent'; uid: number; optionId: string }
  | { type: 'startMatch' }
  | { type: 'momentResult'; result: MomentResult }
  | { type: 'simRestOfMatch' }
  | { type: 'finishWeek' }
  | { type: 'respondOffer'; offerId: number; action: 'negotiate' | 'reject' }
  | { type: 'negotiate'; demand: { wage: number; role: SquadRole; years: number; releaseClause: number | null } }
  | { type: 'acceptNegotiation' }
  | { type: 'walkAway' }
  | { type: 'requestRenewal' }
  | { type: 'retire' }
  | { type: 'setAutoMoments'; value: boolean };

export interface ApplyResult { view: View; saveDue: boolean; toast?: string[] }
