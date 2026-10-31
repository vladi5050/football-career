# QA report: real engine, browser e2e

Owner: QA. Run: `npm run test:e2e` (`tests/e2e/run.mjs`). It builds with `npx vite build`, serves with `vite preview --port 4173`, and drives Chromium (Playwright) on a 390x844 touch context against the **real** worker engine (no `?mock`).
Options: `SKIP_BUILD=1`, `E2E_URL=http://...` (use a server that is already running), `E2E_ONLY=a,b,e,f`, `FIRSTKICK_RUNS=3`, `SEASON_MAX_WEEKS=60`.
Output: a summary table on stdout, screenshots in `tests/e2e/shots/NNN-*.png`, and raw logs (events, week ends, matches, toasts, tables, negotiation) in `tests/e2e/shots/report.json`. The exit code is 1 when any check fails.

Every run uses a new random seed, because names are random and the seed is not fixed. Screenshot numbers below come from the last full run (2026-10-31). Findings that depend on the seed say how often they appeared over 5 full runs.

## What the suite checks

| Scenario | Checks |
|---|---|
| a. First kick (x3) | Page open to the first key moment with immediate taps: taps and wall clock, under 60s. PRD §7: quick week skips pre-match. PRD §5.5: the first match has 3 key moments. No page or console errors. |
| b. Full season | Alternates quick week and a manual 3-magnet plan. Answers every event, cycling through the options. Plays the first moment of every 3rd match with a swipe and simulates the rest. Visits table, club, agent, news and goals every 4 weeks. Asserts a known screen every step, week +1, the table updating, numbers in range, rating 1-10, scores, <=3 open loops, <=2 near-goal bars, >=1 open loop, event body <=220 chars, 2-4 options, no repeated event variant, and pre-match line-up vs the actual match. |
| UI audit (every screen) | No `NaN/undefined/null/[object/Infinity/{placeholder}/${`, no Latin words, no `snake_case` ids, no em-dash, no horizontal overflow, buttons >= 40px, action bar inside the viewport. |
| c. Offseason | Offers reachable during the offseason, next season starts, negotiation (offer or renewal), 3 rounds, the final offer marked in the UI, sign, the club screen shows the signed wage, walk away (modal). |
| d. Save/continue | Autosave in IndexedDB matches the screen. Reload: the title "continue" shows club and week. Continue restores the same week, club and money in under 1.5s. A reload mid-week keeps progress. |
| e. Viewports | Desktop 1366x860 (side panel) and phone 360x640: title, week, all tabs, event, pre-match, moment, week end, with screenshots and the audit. |
| f. PWA | `<link rel=manifest>`, name, short_name, lang `he`, dir `rtl`, display, icons. `<html lang=he dir=rtl>`. Service worker ready. An offline reload renders the title, and a new career starts offline. |

## Latest result (51 pass / 9 fail)

| Result | Scenario | Step | Detail |
|---|---|---|---|
| PASS | a x3 | page -> title -> new career -> reveal -> week | 3 taps, 1.6-1.8s |
| PASS | a x3 | quick week -> first key moment | 5 taps total, 2.9-11.2s (median about 7s). The app's own steps take about 2s. The rest is the match clock running to the minute of the moment. |
| FAIL | a x3 | quick week skips pre-match | goes through pre-match every time (BUG-08) |
| FAIL | a 1/3 | first match has 3 key moments | 1-2 moments when the player comes off the bench (BUG-02), in about 1 of 3 careers |
| PASS | a, b, e | no page/console errors | 0 errors in every run |
| PASS | b | 38 weeks played, week +1, table updates, no repeated variant | |
| FAIL | d | reload mid-week keeps phase | pre-match -> reload -> back to the week plan (BUG-05) |
| PASS | d | reload on the plan screen -> continue | same week, club and money, continue in about 260ms |
| FAIL | c | offers reachable in offseason | the agent tab cannot be reached (BUG-04) |
| PASS | c | next season, renewal/offer negotiation, sign | the club screen shows the signed wage |
| FAIL | c | UI marks the final offer | the engine says "זו ההצעה האחרונה", the UI shows "סבב 3/3" with "לבקש" enabled (BUG-03) |
| PASS | c | walk away | could not be exercised after a signing ("המועדון לא ממהר לחדש"), see note under BUG-03 |
| PASS | e | desktop + small phone | no overflow, side panel present, all screens reached |
| PASS | f | manifest, lang/dir, SW, offline | remark: SVG icon only (BUG-12) |
| FAIL | audit | pre-match line-up contradicts the match | BUG-01 |
| FAIL | audit | more than 2 near-goal bars | BUG-07 |
| PASS | audit | text garbage, Latin, raw ids, em-dash, overflow, tap targets, action bar | clean on every screen and viewport |

Test bugs found and fixed while building the suite: a `RegExp` button name was passed to `.first()`; the week screen flashes for one frame before the reveal route is pushed (the suite now waits for a stable screen); the audit ran during the takeover animation and reported the fixed action bar off-screen (the suite now waits for animations); the 4th "לבקש" hit the engine's final-offer rule (now part of BUG-03); the table "update" check now allows the league to finish before the season does (see UX-01).

## Bugs

### BUG-01 major: the pre-match line-up promise is often wrong
- **Screen:** S6 Pre-match -> S7 Match.
- **Repro:** start a new career, go to "סגור את השבוע" or "שבוע מהיר", read the line-up card ("פותח בהרכב" or "על הספסל"), then press "צא למגרש".
- **Expected:** the line-up and coach line match what happens (PRD S6: "one clear reason, 100% of the time").
- **Actual:** "פותח בהרכב" is followed by "לא נכנסת לסגל הבוגר. היום אתה משחק בנוער" or "אתה על הספסל". "על הספסל / תיכנס בדקה 60" is followed by "שריקת פתיחה. אתה על הדשא." It happens in 3-6 weeks of every season and in both directions.
- **Screenshots:** `tests/e2e/shots/016-lineup-mismatch-w1.png`, `046-lineup-mismatch-w18.png`, `054-lineup-mismatch-w27.png` (pre-match: `015-prematch-w1.png`).
- **Likely cause:** `src/ui/screens/PreMatch.tsx` guesses `starter` from contract role and form, because `v.live` is null in the `prematch` phase. The real decision is made later in `startLiveMatch()` (`src/core/matchSim.ts`), when `startMatch` runs. Fix: pick the XI and sub minute when the engine enters `prematch` (`enterMatchOrWeekend` in `src/core/game.ts`) and expose them in the View.

### BUG-02 major: the first match sometimes has only 1-2 key moments
- **Screen:** S7 Match, career week 1.
- **Repro:** new career -> "שבוע מהיר" -> "צא למגרש". In about 1 of 3 seeds the feed shows "X נכנס מהספסל בדקה 59-78", and only 1-2 moments appear (the first was at minute 87 in one run).
- **Expected:** PRD §5.5: "Straight into match 1, with 3 key moments. The first is a quiet tutorial. One is always a scoring chance."
- **Actual:** the first match uses the normal selection rules, so the player can start as a sub (1-2 moments) or play for the youth team.
- **Screenshot:** `tests/e2e/shots/002-first-kick-moment.png` / `004-first-kick-moment.png` (one of the 3 runs, varies by seed).
- **Likely cause:** `startLiveMatch()` / `planMoments()` in `src/core/matchSim.ts` have no "first career match" case: they need to force `started` and `n = 3`, with a scoring-chance kind.

### BUG-03 major: the engine's final offer is not shown as final, and one more "לבקש" ends the talks
- **Screen:** S12 Negotiation.
- **Repro:** agent tab -> "לבקש חוזה חדש" (or an offer -> "לשבת למשא ומתן") -> "לבקש" twice above the agent range. The log says "...משפרים ל-X ₪. זו ההצעה האחרונה." The header still says "סבב 3/3", and "לבקש", the slider, the role, the years and the clause stay enabled. Press "לבקש" again.
- **Expected:** after round 3 the UI shows "הצעה אחרונה", disables demands, and leaves sign or walk away (PRD §8: "After round 3 comes a final offer").
- **Actual:** `neg.round` stops at 3, while `Contract.tsx` only treats `round > 3` as final. The extra ask hits `neg.round >= 3`, and the club walks out ("קמים מהשולחן. אין על מה לדבר.") with a -8 chairman relation. Players lose the offer for pressing an enabled button.
- **Screenshot:** `tests/e2e/shots/069-contract-final-not-marked.png`.
- **Likely cause:** a mismatch between `src/ui/screens/Contract.tsx` (`const final = n.round > 3`) and `negotiateRound()` in `src/core/negotiation.ts` (the last offer is made when `round` reaches 3, and any later ask collapses). Fix one side: expose `final` in the View, or increment `round` to 4 on the last offer.
- Note: an accepted demand ("מסכימים. אפשר לחתום.") does not advance the round counter. That is fine, but "משפרים ל-X" can repeat the same number as the current offer (seen: 1,900 -> "משפרים ל1,900").

### BUG-04 major: offseason offers cannot be seen before you pass them
- **Screen:** S9 Week end in the `offseason` phase.
- **Repro:** play to the end of the season. The engine spawns summer offers (and, if the contract ends, "החוזה שלך נגמר. אפשר לבקש חידוש או לבחור הצעה"). The screen has one button, "לעונה הבאה". It has no bottom nav, and `#/agent` still renders the week end.
- **Expected:** the user can open the agent tab and negotiate during the offseason. The engine allows `respondOffer` and `requestRenewal` in `offseason`.
- **Actual:** the only exit is "לעונה הבאה". It runs `beginNextSeason`, which **auto-renews or auto-accepts a transfer** when the contract has ended, so the user never sees the decision. PRD §7 says major decisions (transfer, contract) must never be auto-resolved.
- **Screenshot:** `tests/e2e/shots/063-offseason-weekend.png`.
- **Likely cause:** `resolveScreen()` in `src/ui/App.tsx` maps `offseason` to the week end for every route, and `TABBED`/`tabbed` require `phase === 'plan'`. Also `beginNextSeason()` in `src/core/game.ts` auto-signs.

### BUG-05 minor: progress inside a week is not autosaved
- **Screen:** any screen between "סגור את השבוע" and "לשבוע הבא".
- **Repro:** week plan -> "שבוע מהיר" (now on pre-match, or after answering an event) -> reload -> "המשך קריירה".
- **Expected:** PRD principle 6: "Autosave after every screen. Leaving never costs anything." You resume on pre-match, with the event answer kept.
- **Actual:** you return to the week plan, and the plan and event answers are lost. The event may be re-rolled, which also lets players reroll bad outcomes.
- **Screenshot:** `tests/e2e/shots/031-reload-midweek-continued.png`.
- **Likely cause:** `SAVE_AFTER` in `src/worker/sim.worker.ts` only covers `newCareer`, `finishWeek`, negotiation and `retire`. Add `setPlan`, `quickWeek`, `resolveEvent`, `momentResult` and `simRestOfMatch`, or save on `visibilitychange`.

### BUG-06 minor: the scorebug lags behind goals already shown in the feed
- **Screen:** S7 Match.
- **Repro:** play a match where a goal at minute X is followed by another goal later. After minute X the feed and ticker say "שער! ..." but the scorebug still shows 0-0 until the clock passes the **last** goal.
- **Expected:** the score updates when each goal highlight becomes visible.
- **Actual:** `shownScore` only takes `live.score` once every goal highlight is visible.
- **Screenshot:** `tests/e2e/shots/018-after-moment-w1.png` (goal at 14', scorebug 0-0 at 19').
- **Likely cause:** `src/ui/screens/Match.tsx`, the line `if (goalsSeen >= goalsAll) shownScore.current = ...`. It needs to count visible goals per side from the highlights.

### BUG-07 minor: the week end shows 3 near-goal bars (PRD max 2)
- **Screen:** S9 Week end. It happens almost every week.
- **Expected:** "At most 3 open loops, at most 2 near-goal bars."
- **Screenshot:** `tests/e2e/shots/020-weekend-w1.png`.
- **Likely cause:** `nearGoals()` in `src/core/goals.ts` returns `out.slice(0, 3)`.

### BUG-08 minor (doc conflict): quick week stops on pre-match
- PRD §7 says quick week "skips pre-match". DESIGN §7 draws "שבוע מהיר -> PreMatch", and the engine sets `phase = 'prematch'`. As built, the first kick costs 5 taps instead of 4. It is still far inside the 60s target. Product needs to pick one rule. Files: `quickWeek` in `src/core/game.ts`, and `docs/PRD.md` §7 or `docs/DESIGN.md` §7.

### BUG-09 minor: near-goal bar is empty or shows mismatched units
- **Screen:** S9 Week end, S4 Week.
- **Actual:** "עוד 8 למהירות 50" with "42/50" and an **empty** bar. "עוד 1 למסירה 40" with "9/10". "עוד 2 לסיומת 50" with "8/10".
- **Screenshots:** `tests/e2e/shots/020-weekend-w1.png`, `089-small-weekend.png`.
- **Likely cause:** the week end passes `from={target-5}` to `ProgressNearGoal` (`src/ui/screens/WeekEnd.tsx:91`), so 42 of 50 is drawn as 0%. Attribute goals in `src/core/goals.ts` store progress in tenths (target 10) while the text uses the attribute value.

### BUG-10 minor: the renewal opening offer can be a large pay cut
- **Screen:** S12 Negotiation (renewal at the start of season 2).
- **Repro (seed-dependent, seen once in 5 runs):** the club screen shows a wage of ₪14,700. "לבקש חוזה חדש" opens with ₪6,100, and the best final offer was ₪8,100, which is 45% below the current wage. The suite signed it, and the club screen then showed ₪8,100.
- **Expected:** a renewal for a player who is developing starts near the current wage or above it, or the agent warns about the cut.
- **Likely cause:** the ceiling and opening offer in `openNegotiation()` (`src/core/negotiation.ts`) use `marketWage` and ignore `contract.monthlyWage`.

### BUG-11 polish: Hebrew grammar in generated lines
- "סלים עם 1 שערים, אתה עם 1" (every week), "סיים עם 1 שערים ב3 הופעות", "עוד 1 להשער הראשון בקריירה" (it should be "לשער"), "משפרים ל7,400 ₪", "ב3", and "ל9,200" are missing the maqaf before digits. Money is written "₪8,100" in some places and "8,100 ₪" in others.
- Files: `openLoops()` in `src/core/game.ts:398`, `src/core/season.ts:77`, `src/core/goals.ts:101`, `fmtMoney` in `src/core/negotiation.ts` versus `money()` in `src/ui/i18n.ts`.

### BUG-12 polish: the PWA manifest has only an SVG icon
- The manifest is valid (name, `lang: he`, `dir: rtl`, standalone). The service worker is active and the game works offline. But there is no 192/512 PNG icon (needed for Chrome install criteria and the iOS home screen) and no `start_url`. File: `vite.config.ts` (VitePWA `manifest.icons`).

### BUG-13 polish: toasts cover the scorebug and the week-end headline
- At season end, 3 toasts stack over the newspaper headline, and they repeat the "בינתיים בליגה" lines word for word (`063-offseason-weekend.png`). "חלון ההעברות של ינואר נפתח" covers the live scorebug (seen in an earlier run). Files: `src/ui/components/Toast.tsx`, the toast list from `advanceWeek()` in `src/core/game.ts`.

## UX findings (manual review of a whole season of screenshots + report.json)

1. **UX-01 Dead weeks at the end of the season (biggest fantasy break).** The season length is the longest league's round count (38). An Israeli tier-3 club (12 teams) finishes at week 22, and a 16-team league at week 30. The user then clicks through 8-16 empty weeks: no match, no headline, the same "מה השתפר" and the same open loop. Make the season length per league, or fill the gap (friendlies, cup, an early offseason). `buildSeason` in `src/core/schedule.ts`. Screenshot: `061-weekend-w36.png`.
2. **UX-02 Too much silence.** Events came in only 13-17 of 38 weeks (silence was 55-66% against the PRD's about 33%). With the dead weeks, half the season is "plan -> sim -> next" with nothing to read.
3. **UX-03 "מה השתפר" shows +0.0 rows.** Every week the same 5 attributes are listed, 2-3 of them at "+0.0", and a 0.1 tick looks like nothing happened. Show only real gains, or show the week's training progress bar instead.
4. **UX-04 The rival open loop is the same every week.** "סלים עם 1 שערים, אתה עם 1" is often the only open loop for 30+ weeks. PRD wants up to 3 loops that change (next opponent, unanswered message, scout, offer). The ticker loop also needs number-aware Hebrew (BUG-11).
5. **UX-05 A 15-16 year old starting senior league games.** At career start ("רוצה אותך בנוער") the player started 16-20 senior first-division matches (Belgian top tier, Israeli tier 1), while the reveal says youth team. Ratings stayed 4.1-6.8 (one 8.7) and the stamp read "חלש" after a 2-0 win. Starting youth abroad in the senior XI feels wrong, and the low ratings feel like punishment. Balance in `selectXI` (`src/core/matchSim.ts`).
6. **UX-06 Wages and money feel arbitrary.** A 16-year-old "כישרון" at a Belgian club earns ₪14,700 a month. The next season's renewal opens at ₪6,100. Money grows ₪462 every week with nothing to spend it on. Then "חובות" asks for the whole amount. Show what money does (PRD: up to +10% training edge), and keep renewals monotonic unless the role drops.
7. **UX-07 Same event skeleton, new title.** "שתי הודעות" (week 3) and "הלילה שלפני" (week 21) have identical options ("ללכת למבחן / לוותר על המבחן / לבקש מהמאמן..."). "המשכורת לא נכנסה" (week 9) and "אחמד אבוטבול בטלפון" (week 35) share options too. Two different templates are both titled "הלילה שלפני". Players notice repeated option text more than a repeated title. `src/content/events.json`.
8. **UX-08 Negotiation screen readability.** In RTL the slider puts the minimum (₪6,500) on the right and the maximum on the left. The "טווח הסוכן" band does not visually contain the knob when the demand is inside the range. The log bubbles mix "דרשת" (you) lines, without the "אתה:" prefix the UI strips, with club lines, so both look the same (`069-contract-final-not-marked.png`). "משפרים ל-X" when X equals the current offer reads as a joke.
9. **UX-09 Lists far beyond "3 at a glance".** The club screen lists every teammate (about 25 rows, all "ניטרלי") with a relation meter (`058-club-w33.png`). That is a long scroll of identical rows. Show the 3 people who matter (coach, captain, best friend or enemy) and collapse the rest.
10. **UX-10 Youth-team matches look like senior matches.** When he is not in the senior squad the match screen still shows the senior clubs' scorebug ("מכ״מ - כנרת"), and the week-end headline reads "בנוער: 4-0 נגד אתלטיקו ויאנה". In RTL that is read 0-4, and it is not clear whose 4. Add a "נוער" chip on the scorebug and the result card, and write "ניצחון 4-0 בנוער".
11. Smaller: the tray of week magnets is cut at the left edge with no scroll hint ("שיחה" half visible, `008-week-1.png`). The coach note signature "נדב" sits under the board text and is hard to read. The event option hint has no space before it in accessible text ("ללכת למבחןאמא מרוצה"), so a screen reader runs the words together (`src/ui/screens/Event.tsx`, `.opt-text` + `.opt-hint`). "המנטור" is shown where the PRD says "המנטורית".

---

# Round 2: regression after core round 3, UI round 2 and content (163 events)

## How it was run

`npm run test:e2e`. It builds the app, serves it with vite preview and drives Chromium at 390x844 (touch, he-IL).

Options (environment variables):

| Variable | Default | Meaning |
|---|---|---|
| `QA_SEED` | 20261031 | Seed for the deterministic career. A test-only init script injects it into the worker `newCareer` message. Name: נועם בן שושן. |
| `RANDOM_RUNS` | 2 | Extra first-kick runs with a random seed. Each one also plays 2 seasons in fast mode, with auto key moments and reduced motion turned on. |
| `RETIRE_AT` | 34 | The deterministic career retires through the UI at this age. |
| `LONG_MAX_MIN` | 50 | Time budget, in minutes, for the long career. |
| `E2E_ONLY` | all | Run only some groups, for example `a,b`. |
| `SKIP_BUILD` | unset | Set it to skip the build step. |

Scenarios:

| Group | What it covers |
|---|---|
| a | First kick, three times: the fixed seed plus 2 random seeds. |
| h | Each random run plays 2 fast seasons with a walk-away, a renewal and a mid-season transfer. |
| b | Season 1 of the deterministic career, played in detail. |
| c | Every offseason: tabs and summer card, a walk-away from a fresh negotiation, transfers, renewal up to the final offer, and the expired-contract modal ("לבדוק הצעות" / "המועדון יחליט"). |
| d | Save and continue, including a reload in the middle of a week. |
| g | The long career: fast seasons until retirement, then the career-end card. |
| e | Desktop 1366x860 and small 360x640. |
| f | PWA and offline. |
| ui-audit | Runs on every screen. |

Raw output is in `tests/e2e/shots/report.json`. Screenshots are in `tests/e2e/shots/`.

## Result: 136 pass / 2 fail (exit 1)

| Group | Pass | Fail |
|---|---|---|
| setup | 2 | 0 |
| a-first-kick (fixed + 2 random) | 16 | 0 |
| h-random (2 careers x 2 seasons) | 8 | 0 |
| b-season1 | 5 | 0 |
| c-offseason (deterministic + 2 random) | 57 | 0 |
| d-save-continue | 4 | 0 |
| g-long-career / g-career-end | 23 | 0 |
| e-desktop / e-small | 9 | 0 |
| f-pwa | 5 | 0 |
| ui-audit | 7 | 2 (UX-03 "+0.0", BUG-14 injury not shown) |

First kick takes 4 taps every time. It took 1.9 s with the fixed seed, and 2.0 s and 8.1 s with the random seeds (the slow one had its first moment in minute 64). Quick week went straight to the match in every run. No page or console errors in any scenario.

The deterministic career started at age 16 at אוניונה סרנו (Italian league), with mostly U19 matches in season 1. In season 2 it moved mid-season to מכבי העמק (הליגה הלאומית). In season 6 the contract expired and the club-decides path led to הפועל הכרמל (ליגת העל). The contract was renewed in s9, s12, s15 and s17. The player retired through the UI at 34, in season 19.

Career totals: 440 apps, 154 goals, 141 assists, average rating 6.8, 1 trophy (אליפות ליגת העל 2042).

## Round-1 items: verification

| Item | Status | Evidence |
|---|---|---|
| BUG-01 line-up promise | Fixed | 0 mismatches between the promise and the actual role, over 3 careers. PreMatch now has youth and out states. |
| BUG-02 first match < 3 moments | Fixed | 3/3 runs had at least 3 moments (001-first-kick-1-moment.png). |
| BUG-03 final offer not shown | Fixed | The final round shows "הצעה אחרונה" / "יש הסכמה", and "לבקש" is disabled (173-175 renew-s9-*). |
| BUG-04 offseason offers hidden | Fixed | Offseason has tabs and a summer card with "הצעות על השולחן (n)" (100-det-s1-offseason.png). |
| BUG-05 no autosave inside a week | Fixed | Reloading in the middle of a week returns to the same phase and the same event ("פקק באיילון"). |
| BUG-06 scorebug lags the feed | Fixed | 0 differences between the scorebug and the feed. |
| BUG-07 3 near-goal bars | Fixed | At most 2 bars in every week end. |
| BUG-08 quick week stops on pre-match | Fixed | Quick week goes straight to the match, as decided. |
| BUG-09 near-goal bar units | Fixed | The bar fill matches a/b and the units are consistent (060-weekend-s1w1.png). |
| BUG-10 renewal pay cut | Not reproduced | Renewals went 42,000 -> 188,600 -> 224,500 -> 218,900 (-2.5% at 30, acceptable). |
| BUG-11 Hebrew grammar | Mostly fixed | Still open: "1 שערים" in the CareerEnd timeline rows. Money format is mixed: "₪X מיליון" from core vs "₪XM" in the UI. |
| BUG-12 PWA icons | Fixed | The manifest has PNG icons and a start_url. |
| BUG-13 toasts cover content | Still open | Toasts cover the expired-contract modal text (145-s6-expired-modal.png), the contract action bar and the career-end stats (235-det-career-end.png). The same toast often shows twice. |
| UX-01 weeks without a match | Mostly fixed | 3 such weeks per season (7 in a season with a mid-season move), down from 8-16. |
| UX-02 empty weeks | Still open | In detailed season 1, 14 of 37 weeks had an event, so 62% had none. Later seasons had 1-4 events in 29 weeks. |
| UX-03 "+0.0" rows | Still open | 22 distinct week ends show "+0.0" in "מה השתפר" (ui-audit fail). |
| UX-04 rival loop | Still open | "אבבה: 0 שערים העונה. אתה: X" appears about 44 times in one career. The rival scores 0 goals for years. |
| UX-05 youth realism | Fixed | Youth matches at 16, ratings 4.8-9.8 (mean 6.76). |
| UX-06 wage scale | Partly open | Jump from 42k to 188.6k at age 24 for an overall-63 player. |
| UX-07 event repetition | Partly open | No title repeats in the career, but answer sets repeat 2-4 times ('"איפה שצריך אותי"' x4, '"זה הישג של כל הקבוצה"' x4). |
| UX-08 negotiation readability | Fixed | The slider has פחות/יותר labels, and the log bubbles are labelled "אתה" / club. |
| UX-09 long squad list | Fixed | The list is collapsed to "כל הסגל (22)". |
| UX-10 youth vs senior unclear | Fixed | U19 chips and the "נוער" suffix. |
| UX-11 a11y hint | Fixed | The hint is now separate from the moment text. |

## New bugs (round 2)

### BUG-14 major: injuries are never shown in the UI
- Screen: week (plan), club, top bar.
- Repro: seed 20261031, long career. At s9w9 the save has `injury` = "פציעה קשה", 19 weeks.
- Expected: the week screen shows that you are injured, the weeks left and the recovery. Training choices that make no sense are disabled.
- Actual: the normal plan, fitness 93 and a coach note. The only sign is the toast "אתה פצוע. צופה מהיציע." The audit found 9 injuries in 3 careers that were not shown on the week screen.
- Screenshot: shots/166-injury-hidden-s9w9.png
- Likely files: src/ui/Week.tsx, src/ui/Club.tsx, TopBar. No UI component reads the injury from the View. Also check that buildView exposes it.

### BUG-15 major: the career-end card loses every former club
- Screen: career end, share card.
- Repro: play past one transfer, then retire through More -> "לתלות את הנעליים" -> "לפרוש".
- Expected (PRD §12): the clubs in order, as crests. Also "the decision that changed everything" and "the person who mattered most".
- Actual:
  - Every season at a former club shows "מועדון" with no crest (6 seasons here).
  - The share card shows only the current club's crest.
  - The two PRD lines are missing.
- Screenshots: shots/236-det-career-end-full.png, shots/237-det-share-card.png
- Likely files: src/ui/CareerEnd.tsx. `clubById` returns null for clubs that are not in the current View, and the View does not carry history clubs (core buildView).

### BUG-16 major (balance): the scout's potential range never matches reality
- Screen: club, scout report.
- Repro: seed 20261031, read the potential range every season.
- Expected: the range narrows toward the real peak as the player ages.
- Actual: the range rises to 95-99, while overall peaks at 68 (ages 25-33) and falls to 66 at 34.
- Screenshots: shots/164-club-s9w2.png, shots/230-club-s18w2.png
- Likely file: src/core (potential/scout estimate).

### BUG-17 major (balance): renewal talks collapse after 2 asks inside the agent's range
- Screen: contract.
- Repro:
  - s1 renewal: ask once at the middle of the agent's range, ask again, and the club gets up from the table.
  - s6: the uncle's range is ₪24,700-45,900. Ask 35,300, then +3%, and the talks collapse.
- Expected: asks inside the range the agent gave should not end talks in one step. The patience bar should warn before a collapse.
- Actual: the bar read "מתחיל להתעייף" (no warning) and the talks ended on the next ask.
- Screenshot: shots/103-renew-s1-contract-ask1.png
- Likely file: src/core/negotiation.ts. The patience drop `8 + wageGap*140` is too steep.

### BUG-18 minor: "המועדון יחליט" takes 3 presses and picks a new club
- Screen: offseason, expired-contract modal.
- Repro: seed 20261031, s6. The renewal talks collapse, then press "לעונה הבאה" -> "המועדון יחליט".
- Expected: one press. The club (or the agent) decides, probably on the pending offer.
- Actual:
  - Press 1 shows the toast "לא מחדשים. יש הצעה אחת על השולחן".
  - Press 2 shows the toast "בלי חוזה אין עונה...".
  - Press 3: the agent spawns a different club (הפועל הכרמל) instead of the pending offer, and a negotiation opens.
- Screenshots: shots/145-s6-expired-modal.png, shots/147-s6-club-decides-contract.png
- Likely files: src/core/game.ts `beginNextSeason` (stepwise `offseason_prompt`), and the modal copy in src/ui/WeekEnd.tsx.

### BUG-19 minor: "לבקש חידוש" stays enabled after talks collapsed
- Screen: offseason summer card.
- Repro: let the renewal talks collapse, then press "לבקש חידוש".
- Expected: the button is disabled, or explains why.
- Actual: the button is enabled and highlighted. The club answers "עוד זוכרים שהשיחות האחרונות התפוצצו".
- Likely files: src/ui/WeekEnd.tsx and src/ui/viewExtras.ts (the renewal-available flag).

### BUG-20 minor (balance): national team caps are almost never earned
- Repro: seed 20261031 career.
- Evidence: 154 goals in ליגת העל, 6 national-team events and a "זימון לנבחרת", but only 1 cap in 18 seasons.
- Likely file: src/core (national team selection/caps).

### BUG-21 polish: text details
- "לבקש חידוש במכ״ע" uses the club's short abbreviation. Use the full name, or "במועדון".
- A near-goal row shows "39.9 מתוך 40". Round it, or treat it as achieved.
- The negotiation log bubble glues the club short name to the text: "מכ״עמכבי העמק...". It is a label element with no separator, so screen readers and copied text read it glued.
- "יש החלטה גדולה שמחכה לך" is toasted repeatedly, sometimes twice in a row.
- Money format differs between core and UI (see BUG-11).

## Other observations
- A 16-year-old abroad has ₪114K in savings by week 31. Money feels too easy early on.
- Transfers update the UI correctly:
  - week title, club screen, table row, league name and crest after a mid-season move (113-transfer-s2-club-after.png)
  - the same checks after the offseason club change
- The youth -> senior transition works. Season 1 had 2 senior and 32 youth results. From season 2 on, all results were senior.
- Desktop and small viewports, PWA and offline: all pass (239-desktop-week.png, 247-small-week.png, 254/255-offline-*.png).

## Test fixes made in round 2 (not product bugs)
- Fixed seed and name for deterministic runs. The seed is injected at the worker message, without touching product code.
- New PreMatch states: the button is found by role in the action bar, not by label. Line-up checks map the promise to the actual role (start / bench / youth / out).
- A walk-away is recognised from the negotiation status. The negotiation object stays in the save with status walked_away.
- The expired-contract loop allows up to 8 presses of "לעונה הבאה", because "המועדון יחליט" is stepwise (BUG-18).
- The near-goal units check matches the new text format.
- Senior and youth results are counted from week-end results, because fast mode skips the match screen.
- Demand escalation in the negotiation driver is +3% per round, to stay inside the agent's range.
