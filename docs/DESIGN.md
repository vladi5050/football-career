# קריירה: Design system ("locker room" / חדר ההלבשה)

Owner: Design/UX + front-end. Code: `src/ui/**`, `src/app/**`, `index.html`, `public/icon.svg`.
Screenshots of every screen (390x844, mock sim): `docs/screens/*.png`.

## 1. Direction

The whole app is a youth-team locker room. The background is the **navy locker wall** with vertical planks.
Content sits on objects you would find there:

| Object | Used for | Class / component |
|---|---|---|
| Whiteboard with aluminium frame + marker tray | weekly plan, tactics board, goals | `.board`, `<Whiteboard>` |
| Glossy round magnets | plan activities, positions, goal status | `.magnet`, `<Magnet>` |
| Taped paper card with dashed inner outline | events, result, lineup, offers, agent | `.paper.dashed`, `<TapedCard>` |
| Shirt on a hook | identity (title, reveal, club) | `<Shirt>`, `<ShirtOnHook>` |
| Newspaper | headlines, news | `.newspaper` |
| TV score bug | live match | `.scorebug` |
| Rubber stamp | match rating, lineup | `.stamp`, `.stamp-rect`, `<RatingStamp>` |

Never: dark background + neon green, cream + serif, decorative gradients. Gradients only describe material
(magnet gloss, aluminium bevel, wood bench).

## 2. Tokens (`src/ui/styles/tokens.css`)

| Token | Value | Use |
|---|---|---|
| `--wall` | `#22344F` | page background (planks: 58px, dark seam + light edge) |
| `--orange` / `--orange-press` | `#F28C28` / `#A85A10` | primary button + its 5px bottom press shadow, accents |
| `--paper` | `#F7F7F2` | cards, secondary buttons, text on wall |
| `--ink` | `#1B2A4A` | text on paper/board, ink buttons, bottom nav |
| `--board` | `#ECEFEA` | whiteboard, faint blue 22px grid `rgba(30,79,216,.09)` |
| `--alu` | `#B8BDC2` | whiteboard frame, hooks, share-card frame |
| `--red` / `--blue` | `#D7263D` / `#1E4FD8` | coach marker colours (handwriting, day names), magnets |
| `--yellow` / `--green` | `#F2C230` / `#2F9E57` | magnets, good/bad, zones |
| `--tape` | `rgba(236,222,176,.82)` | masking tape |

Spacing 4pt scale (`--s1..--s8`), radii 6/10/16, tap target `--tap: 48px` (never below 44px).

## 3. Type

| Role | Font | Size |
|---|---|---|
| Hero logo | Karantina 700 | 128px |
| H1 / H2 / H3 | Karantina 700 | 48 / 36 / 28px |
| Big numbers (score, overall, wage, attribute values) | Karantina 700 | 24-72px |
| Body, buttons, labels, any important info, small numbers | Assistant 400/600/700/800 | 12-22px |
| Coach handwriting | Amatic SC 700 | **>= 26px, short notes only** |

Small numbers (minutes in the feed, rating pills, table) use Assistant 800, because Karantina digits are
hard to read below ~22px. Numbers inside Hebrew text use `.num` (isolated, LTR, tabular).

## 4. Components (`src/ui/components`)

- `Crest` procedural SVG from `CrestSpec [shape 0-5, division 0-9, palette 0-13, charge 0-10]` + club colours.
  Shapes: heater, round, swiss, octagon, rounded, peaked. Divisions: plain, stripes, per pale, quarterly,
  chevron, sash, hoops, per fess, cross, chief. Palettes: 14 field/division/charge mappings of the two club
  colours + gold/white/ink, with automatic contrast fallback for the charge. Charges: star, tower, anchor,
  ball, lion head, crown, waves, tree, key, eagle, initials. Indexes are taken modulo, so any number is safe.
- `Shirt` / `ShirtOnHook` jersey from the back with name + number; `patternFor(division)` gives
  stripes/hoops/sash so kit and crest match.
- `Magnet` glossy radial-gradient magnet (red, blue, yellow, green, orange, ink). `.lifted`, `.snap`.
- `Whiteboard`, `TapedCard` (tape right/left/both/center, tilt l/r).
- `Bar`, `ProgressNearGoal` ("עוד 1 לדריבל 50", pulses when >= 80%), `PatienceBar` (mood words, no number),
  `RelationMeter` (-100 red left ... +100 green right).
- `AttrList`, `Stars`, `RatingPill`, `RatingStamp`, `Avatar` (initials, role colour), `CountUp`,
  `Confetti`, `Toast`, `Modal` (bottom sheet, portal to body), `BottomNav`, `TopBar`, `FallbackMoment`.

Buttons: `.btn` (paper), `.btn-primary` (orange, ink text, 800), `.btn-ink`, `.btn-ghost` (on wall),
`.btn-danger`. All have the 5px bottom "press" shadow and sink 4px on `:active`.

## 5. Layout

- Mobile first, portrait, one column (`--col-max: 480px`), `100dvh`, `viewport-fit=cover`, safe-area insets.
- One-hand reach: the primary action is always in the fixed `.action-bar` at the bottom (above the nav when
  the nav is shown). Back buttons are top-right (RTL start).
- Bottom nav, 5 tabs: שבוע · טבלה · מועדון · סוכן · עוד (shown only in `phase === 'plan'`).
- 600px+: the column gets side borders and floats on the wall.
- Tablet and desktop layouts: see section 13 (`src/ui/styles/responsive.css`).

## 6. Motion (`src/ui/styles/anim.css`)

| Animation | Where | Duration |
|---|---|---|
| screen slide (RTL forward = from left) / takeover rise | every screen change | 180 / 260ms |
| magnet snap (overshoot) | magnet placed on a day / position chosen | 360ms |
| card flip | start reveal | 620ms |
| stamp in | match rating | 420ms |
| count-up + pop | attribute gains | 900ms, staggered 250ms |
| confetti | user goal (match + week end) | ~2s |
| highlighter sweep | event "כי בשבוע X..." line | 600ms |
| shirt swing | title + reveal | 2.4s once |
| live dot, near-goal pulse | only looping animations | - |

Rules: motion confirms an action or reveals a result. Nothing blocks input. Reduced motion
(OS setting or the in-game toggle, `html.rm`) cuts every animation to 1ms, CountUp jumps to the value,
confetti is not rendered, the match clock jumps. Screen animations use `fill-mode: backwards` so they never
leave a transform behind (a lingering transform would trap the fixed action bar).

## 7. Screen flow

```
Title ──► NewCareer ──► StartReveal ──► Week (plan) ◄──────────────────────────┐
  │  (continue: load autosave) ─────────► Week                                  │
  ├─► TeamEditor / Settings (also from עוד)                                      │
                                                                                 │
Week ──[סגור את השבוע: setPlan]──► Event* ──► PreMatch ──[startMatch]──► Match   │
     └─[שבוע מהיר: quickWeek]──► Match (or Event if a major decision waits) │      │
                                                                          ▼      │
                       Match: clock runs to each moment ─► moment card ─► playMoment()
                              (or דלג: momentResult skipped / simRestOfMatch) ─► full time
                                                                          ▼      │
                                                    WeekEnd ──[finishWeek]───────┘
Tabs during plan: Week · Table · Club · Agent ─[negotiate]─► Contract · More (News, Goals, Settings, Editor, retire)
Contract ──[acceptNegotiation / walkAway]──► Week          retire ──► CareerEnd (share card)
Offseason: WeekEnd ("החלטות הקיץ" card: offers → Agent, renewal → Contract) + tabs (Week tab reads "קיץ")
           "לעונה הבאה" with an expired, undecided contract → confirm modal (check offers / let the club decide)
```

First kick in under 60 seconds: Title (1 tap) → NewCareer (name is pre-filled, 1 tap) → StartReveal
(tap to skip) → Week (שבוע מהיר) → Match directly → first moment at ~2s of match clock.
The first career match is usually a U19 youth game (3 moments, the first one easier).

## 8. Phase → screen mapping (`resolveScreen` in `src/ui/App.tsx`)

| `view.phase` | Screen |
|---|---|
| no view | Title / NewCareer / TeamEditor / Settings by hash |
| `plan` | hash tab: week, table, club, agent, more, news, goals, settings, editor (+ `reveal` once after a new career) |
| `event` | Event (first of `view.inbox`) |
| `prematch` | PreMatch (line-up from `view.prematch`: starter / bench (+subMinute) / youth (U19 stamp, "<club> נוער") / out) |
| `match` | Match (stays on screen after the engine leaves `match` until the user taps "לסיכום השבוע") |
| `postmatch`, `weekend` | WeekEnd (takeover, no tabs; youth games get a U19 result card built from `view.live`) |
| `offseason` | WeekEnd with bottom nav; hash routes table, club, agent, more, news, goals, settings stay reachable. Button "לעונה הבאה" |
| `negotiation` | Contract (`negotiation.final` or an agreement → banner, only לחתום / לקום remain) |
| `retired` | CareerEnd |

Hash routing (`#/week` etc.) keeps browser / Android back working.

## 9. Round-2 notes

- Toasts sit in the thumb zone above the action bar / nav (max 2), never over the scorebug or headlines. Duplicates and
  lines already visible on the next screen (negotiation log, week report, top news) are dropped in `store.applyResult`.
- Scorebug counts goals from `live.fixture.scorers` whose minute is already on the feed (falls back to highlight count).
- Near-goal bars: fill = progress / target (engine keeps both in the same unit); label `progress/target`.
- Rating bands: 8+ מצוין, 7.2+ טוב מאוד, 6.5+ טוב, 5.8+ סביר, below חלש (`ratingWord` in i18n).
- Contract slider is a left-to-right number line (פחות ← → יותר); the agent band is laid on the thumb travel so the knob fits
  inside it; bubbles are labelled "אתה" / club short name.
- Club screen: coach, closest teammate, the one with tension; the rest of the squad folds into "כל הסגל (N)".
- PWA icons: `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` (rendered from
  `icon.svg` by `fc-shots/icons.cjs`); manifest has `start_url` and `scope` `/`.

## 10. Round-3 notes

- Toasts: deduped by text for 10 s, suppressed (and cleared) while any Modal is open (`modalsOpen` in the store), z-index 65
  (above nav 30 / action bar 20, below modal 70). No engine toasts on the career-end screen or for "החלטה" while on an event.
- Injury (`view.player.injury`): red TopBar badge, Week banner "פצוע: עוד N שבועות", training magnets become one "שיקום" magnet
  (+כושר; the engine turns train_* into rehab), no gym, fitness meter in red; Club hero chip and banner.
- Career end: clubs come from `View.careerClubs` (fallback current/offers/table via `clubLookup`); the share card draws the whole
  path, shrinking crests to fit; "ההחלטה ששינתה הכל" / "האדם שהכי השפיע" from `View.careerStory`. Retire is disabled before 30.
- Renewal button disabled after collapsed talks (`career.renewalBlockedUntil`, fallback: last renewal walked away), with a note.
- Money: one format everywhere, `money()` = "₪7,400" / "₪1.2 מיליון" (same as core `fmtMoney`). Counts: `countHe()`.
- Week end hides gain rows that round to +0.0 and shows `gainsNote` instead when nothing is left.

## 11. Narrow phones and the league table

- Table: `table-layout: fixed`, columns # (30) · club (rest, ellipsis) · מש׳ (34) · הפרש (42) · נק׳ (38). Toggle "מקוצר / מלא"
  (full swaps מש׳/הפרש for נ-ת-ה and the last-5 form dots). Tap a row for details (W-D-L, goals, form). Sticky header; zone
  colour bar on the right edge; the user's row tinted with an orange edge on the left.
- Round label: "מחזור N מתוך T" where N = the user's played matches from the table, T = (clubs - 1) * 2 for this league.
- Overflow audit `fc-shots/overflow.cjs`: Chromium with an iPhone Safari UA at 360/390/430 with long real club names
  (team-names override in IndexedDB). Rule: every flex/grid child that holds text gets `min-width: 0` + ellipsis.
- Safari < 16 lacks `overflow: clip`; `@supports not` falls back to `overflow-x: hidden` on #app / .shell.

## 12. Round-4 notes

- Toasts (supersedes §9/§10 placement): one compact banner at the TOP, `top: safe-t + 58px` (under the top bar / scorebug),
  2 lines max, auto-dismiss 3.5 s, tap to dismiss; extra lines queue (max 3) and show one after another. Still deduped for
  10 s and suppressed while a modal is open.
- Near-goal numbers: integers only; within 0.5 of the target the text reads "כמעט 40".
- Negotiation bubbles drop a leading club name from the engine line (the label already names the speaker).
- Share card trophies wrap to 2 lines (font 40 → 30 px), then "+N".
- Scorebug at a moment uses `live.score` (same as the decision overlay); goals without a named scorer count at once.

## 13. Responsive layouts (`src/ui/styles/responsive.css`, `src/ui/useMedia.ts`)

Breakpoints (same values in CSS and in `MQ_TABLET` / `MQ_DESKTOP`):

| Range | Name | Layout |
| --- | --- | --- |
| < 700px | phone | The base styles. Nothing in `responsive.css` applies, so phones look exactly as before. |
| 700-1099px | tablet | Column 900px, bigger type tokens and magnets, two-column screens, bottom nav stays. |
| >= 1100px | desktop | Nav rail on the right, main area up to 1200px, week side column, card screens centred. |

- **Column wrappers.** `.cols` / `.col` are `display: contents` on phones, so the children stay flex items of
  `.screen` in their original order. From 700px `.cols` is a 2-column grid. Used on Week (`.week-cols`: board |
  palette + status), Club (`.club-cols`: hero + my card | people + rival) and Agent (`.agent-cols`: agent | offers + renewal).
- **Tablet portrait** (`orientation: portrait`): the week board is full width with the palette and status side by
  side under it, magnets 72px.
- **Table.** Starts in "מלא" from 700px (`useState(() => matches(MQ_TABLET))`). From 1100px the full view is
  `LeagueTableAll` (`.ltable.all`): every column (#, team, P, W, D, L, goals, GD, pts, form).
- **Nav rail (desktop).** The same `.bottom-nav` (same 5 buttons, same order) restyled as a fixed rail on the right
  (`--rail-w: 104px`), active tab marked with a bar on its inner edge. `.shell-row.is-tabbed` reserves its width.
- **Action bars (desktop).** `position: sticky; bottom: 0` inside the screen instead of fixed and viewport-centred,
  so they stay under their own column next to the rail and side panel.
- **Side column (desktop, week only).** `SidePanel` in `.shell-row.has-side`: next fixture, mini table with
  "לטבלה המלאה", nearest goal, headlines. The shell (max 820px) and the panel (320px) are centred as a pair.
- **Match (desktop).** Grid: scorebug across the top (max 760px), pitch in the main column, feed as a 340px side
  column, decision card centred on the pitch (max 520px).
- **Card screens** (event, prematch, weekend, contract, reveal, new career, career end, settings, goals, news,
  more, team editor): max 760px on tablet, 720px on desktop, centred.
- **Title.** Lockers scaled 1.3 (tablet) / 1.6 (desktop), logo 168 / 200px, buttons max 460 / 440px.
- **Pointer devices** (`hover: hover` and `pointer: fine`): hover tint on buttons, list rows, table rows and nav;
  pointer cursor and a small lift on magnets, `grabbing` while dragging. Keyboard focus uses the global
  `:focus-visible` ring (inset on the nav rail).
- No horizontal scroll from 360 to 1920px (checked at 360, 390, 430, 768, 820x1180, 1024x768, 1280x800,
  1440x900, 1920x1080). Shots: `docs/screens/50-*.png`.
