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
