# PRD: "קריירה", v1 browser build

Owner: Product + Content. Architecture: CTO (`docs/CONTRACTS.md`, `src/core/types.ts`). Source design docs: `docs/source/*.md` (Hebrew).

## 1. Product in one paragraph
A Hebrew (RTL), mobile-first, portrait, one-handed browser game (PWA) in which you live one footballer's whole career, from age 15-16 in a youth team until you retire at roughly 35-38. One session is 3-5 minutes: plan a week, face one event, play a match through 3-5 key moments you control, read how the world reacted, and stop on an open loop. There is no script. A seeded world simulates every league, and each decision is remembered by people who come back later. The game never scores the career. The career-end card tells the story.

## 2. Goals and non-goals
Goals for v1:
- First key moment within 60 seconds of a cold start.
- A full match week in about 90 seconds when using "שבוע מהיר".
- Every week ends on an open loop and shows at least one near-goal.
- Events feel personal: at least 1 in 4 cites a past choice ("כי בשבוע X...").
- A full career is playable to retirement, and the career-end card can be shared.

Non-goals for v1: multiplayer, servers or accounts, real club names or crests, monetisation, real-time timers, loot boxes, punishment for days without play, cup or European competitions (P2), several careers at once.

## 3. Principles (apply to every screen)
1. One primary action per screen: an orange button at the bottom, in thumb reach, at least 48px high.
2. A list shows at most 3 items to read at a glance.
3. Colour always comes with a word: orange = action or progress, green = good, red = risk.
4. Truthful media: headlines, fan reactions and "meanwhile" lines come only from what the sim actually did.
5. Show the strongest reason ("העייפות שלך הכריעה"), so outcomes never feel random.
6. Autosave after every screen. Leaving never costs anything.
7. Hebrew only in the UI. Short, punchy dressing-room voice. No em-dashes.

## 4. Core loop
```
Plan week (3 slots) -> Event (0-1, from the storyteller) -> Pre-match (line-up + reason)
 -> Match (3-5 key moments; 1-2 in routine games, 4-5 in derbies or finals)
 -> World reacts (only after a notable match) -> Week end: near-goals + open loops -> next week
```
- **Plan**: 3 free days (Tue/Wed/Thu), Saturday is match day. Each slot (`PlanSlot`) previews what it gives and what it costs (fitness, relations). Default plan = last week's plan.
- **Event**: chosen by weight x trait multipliers x season-theme boost x a 0.3 penalty if the category appeared in the last 3 weeks. "Silence" (no event) happens in about 1 of 3 weeks. Same template no sooner than its cooldown (12 weeks by default). The same variant text never appears twice in a career.
- **Match**: simulated in 18 segments. The user's key moments pause the sim. Context changes the moment (minute 85+ and close score, hostile away crowd, rival marking you, rain, derby). Moments can be auto-resolved (setting).
- **Week end ("מה מחכה לך")**: result, rating, attribute gains, 2 near-goal bars ("עוד 1 לדריבל 50"), up to 3 open loops (next opponent or derby, an unanswered message, a scout, an offer that expires), and one "בינתיים בליגה" line.

Acceptance:
- [ ] A week from plan to week end takes at most 5 taps when using "שבוע מהיר".
- [ ] A week end always shows at least 1 open loop and at least 1 near-goal while any goal is active.
- [ ] No event template repeats within its cooldown. No category appears 3 weeks in a row.

## 5. First 60 seconds (onboarding)
1. 0-5s: neighbourhood pitch at dusk, one line: "בן 15, והחלום עדיין רחוק."
2. Pick a **position** (8 cards, one tap) and type a **name** (first and last; a "random" button fills both from `names.json` IL). Nothing else: no stats, no style, no club.
3. The engine rolls the start with the seed: **60% Israel / 25% foreign academy / 15% raised abroad**. Position shifts the weights (GK and CB get more academy scouts looking for height, W and ST more scouts). The club is a weighted pick among clubs with room in that position. Age is 15 or 16.
4. The start is shown as a 2-line story card ("סקאוט של אקדמיה בפורטוגל ראה אותך בטורניר בנתניה."). Then the coach gives one line, and the user answers once (modest or confident: sets the starting trust).
5. Straight into match 1, with 3 key moments. The first is a quiet tutorial. One is always a scoring chance, which can still be missed. Week planning is introduced in week 2.

Acceptance:
- [ ] Time from first tap to the first key moment is under 60s on a mid-range phone.
- [ ] The start distribution over 10,000 seeds is within ±2% of 60/25/15 for neutral positions.
- [ ] Same seed + same name + same position = identical world.

## 6. Screens and acceptance criteria

| # | Screen | Must do | Acceptance |
|---|---|---|---|
| S1 | Home / continue | Continue, New career, Team editor, Settings. After more than 3 days away: "בפרקים הקודמים" (3 lines) + "שום דבר לא אבד". | Continue loads the last autosave in under 1s. |
| S2 | New career | Position + name only (see §5). | 2 inputs, 1 button. Works with an on-screen keyboard in RTL. |
| S3 | Start story | Roll result, club card (crest, colours, coach line), one reply choice. | The crest is drawn from `CrestSpec` with the club's colours. |
| S4 | Week plan | 3 slots, drag or tap magnets, preview of gains and costs, **"שבוע מהיר"** button. | The plan persists as `lastPlan`. Slots locked by stage (media from age 17, mentoring from age 28) are hidden. |
| S5 | Event card | Title, body, "כי בשבוע X..." line when `because` resolves, 2-4 options with hints, cast avatars. | Text over 220 chars never appears (the validator enforces it). Options are reachable with the thumb. |
| S6 | Pre-match | Line-up with **one clear reason** ("תיכנס בדקה 60. תראה לי מה יש לך."), opponent, derby badge, weather. | A reason is shown 100% of the time. |
| S7 | Match | Live score ticker, minute, key-moment player (Pixi, lazy loaded), "סמלץ עד הסוף". | A moment resolves in 5-15s. Reduced motion is respected. Pixi is cleaned up. |
| S8 | World reacts | Headline + 2 fan lines + a 3-number comparison with the rival. Only when `WeekReport.notable`. | Never shown after a routine match. Every number comes from sim data. |
| S9 | Week end | See §4. One button: "לשבוע הבא". | At most 3 open loops, at most 2 near-goal bars. |
| S10 | Goals board | 3 horizons: week, season, dream. Created from the current state, not a fixed list. | At least 1 goal is active at all times. A completed goal shows its reward. |
| S11 | Inbox / offers | Offers with expiry, the agent's handwritten note, "Negotiate" or "Reject". | Expired offers disappear at `expiresWeek`. |
| S12 | Negotiation | See §8. | 3 visible rounds, patience shown through the manager's behaviour. |
| S13 | Club / table | League table, fixtures, rival club highlighted. | The table updates every week for every league (`simLevel` decides the detail). |
| S14 | News | Newest first. Kinds: match, transfer, sacking, career, rival, league, event. | Capped list. Every item links to real sim data. |
| S15 | Player / career | Attributes, potential range, form, fitness, contract, season and career stats, trophies, timeline. | The potential range narrows with age. |
| S16 | Career end | Timeline + share card (see §12). | Shareable image in 9:16. |
| S17 | Team editor | Import a local JSON (see §13). | The file never leaves the device. |
| S18 | Settings | Auto moments, reduced motion, export/import save, reset. | Export produces a JSON file. |

## 7. "שבוע מהיר" (quick week)
One button on S4 (and on S9 as a secondary action). It repeats `lastPlan`, auto-resolves events by picking the option marked `"default": true` (one per template; never when the event is flagged for a major decision: transfer, contract, army, national, captaincy, retirement), skips pre-match, and plays only the moments that matter (late and close, derby, or a rival involved). Everything else is simulated.
- [ ] Median time per quick week is 90s or less, including at most 2 moments.
- [ ] Major decisions are never auto-resolved. Quick week stops and shows them.
- [ ] Auto-resolved events still appear in the log and in history, so later events can cite them.

## 8. Agent and negotiation
- 3 agent archetypes: **הכריש** (shark: high offers, big-club links, high commission, pushes moves that suit him), **המנטורית** (mentor: development and minutes first, modest wages), **הדוד** (uncle: almost no commission, totally loyal, few contacts). The user picks one when the first scout appears (age 15-17). Each has a trust score and memories.
- An offer has 4 parts: monthly wage, planned role (backup / rotation / starter), length, bonuses or release clause.
- **3 rounds.** In each round: sign, push one part, play a rival offer (only if one exists), or walk away. Patience drops each round. It is shown through the manager's lines and body language, never as a number. After round 3 comes a final offer. Pushing too hard can close the door.
- The agent never reveals the ceiling. He gives a **range**: mentor ±10%, shark ±20% biased up, uncle ±30%.
- Wages come from `wages.json` bands × league `wageFactor` × reputation and need. Example: 17-year-old in the Israeli tier 2 asks for 9,500 NIS a month and is offered 7,000. Release clauses of 1-2M NIS for youngsters in Israel.
- Consequences: a promised "starter" role you don't get opens a coach confrontation event. Pushing the wage hard raises fan expectations. Money gives at most a +10% training-quality edge.
- [ ] Agent ranges always contain the hidden ceiling for mentor and uncle, and do so in at least 80% of cases for the shark.
- [ ] "חתום כמו שזה" is available in every round.

## 9. Rival, news and the living world
- **Rival**: one fixed rival footballer (same age ±1, same or a related position), shown on S8 and S9 as a 3-number comparison (goals, rating, caps or value). He trains too, moves clubs, and appears in events (`rival` selector). Relations and memories carry across clubs.
- **News**: generated from sim facts only (results, transfers, sackings, promotions, your career beats, effect `news(...)`).
- **"בינתיים בליגה"**: one line per week on a transfer, a sacking or a streak in your league.
- **Living world**: every league plays every week. Clubs buy, sell and sack managers. Teams get promoted and relegated between il1/il2/il3. Managers and agents are persons with traits who keep their memories when they change roles.

## 10. Season themes
Each season draws 2 of the 20 themes in `themes.json`. A theme multiplies the weights of event categories (`categoryBoost`) and may unlock theme-specific events (`theme(id)` in `when`). Some themes are forced by state: `contract_year` when `contractLeft <= 1`, `army_call` at 17-18 in Israel, `farewell_tour` after a retirement announcement. The themes appear at the start of the season on S9 as a 1-line headline each.
- [ ] Two themes per season, never the same pair twice in a row.

## 11. Transfers, ageing and retirement
- 2 windows per season (summer: weeks 0-4, winter: mid-season, 3 weeks). Offers come from the world state (needs, budget, your rating, fame, agent links). The user can request a move, reject offers, or go on loan. A move abroad brings adaptation (morale dips for the first months) and homesickness events.
- **Life stages** (by age only): youth 15-17, army 18-20 (Israelis only: outstanding-athlete status, regular service or deferral), pro 19-27, veteran 28-33, retirement 33-38.
- **Ageing curve**: fast growth up to 23, peak 24-29, from 30 pace and stamina decline, vision keeps rising. Potential is hidden and shown as a range.
- **Retirement**: the player's choice, any time after 33. The career closes automatically at 38, or earlier after a career-ending injury.
- [ ] A 20-season career sim runs headless in under 10s (`npm run sim`), and 95%+ of careers retire between 33 and 38.

## 12. Career-end share card
A 9:16 canvas image styled like a framed shirt: name, shirt number, clubs as crests in order, the big numbers (apps, goals, caps, trophies), "the decision that changed everything" (the highest-weight history entry), and the person who mattered most (the highest absolute relation). Footer: "שחק את הקריירה שלך" + game name. Shared through the Web Share API, with a download fallback. A smaller mid-career share card for a newspaper headline after a big goal is P1.
- [ ] Renders offline. No network calls. Contains no real names unless the user imported them.

## 13. Team editor
Reached from S1. The user imports a local JSON file in the `leagues.json` shape (optionally also `names.json`) to rename leagues, clubs, cities, stadiums and colours, and optionally to add their own crest images as data URLs. Validation uses the same rules as `tools/validateContent.ts` (shared code), and every error is shown in Hebrew. The data is stored in IndexedDB only and passed as `clubsOverride` to `newCareer`. **Nothing is ever uploaded.** We ship no real names or crests, and we document that the import is for private use.
- [ ] An invalid file never breaks the game: the error list is shown and the defaults stay.
- [ ] No network request happens during or after import (checked in e2e).

## 14. Content scope (v1, delivered)
| File | Content |
|---|---|
| `src/content/leagues.json` | 13 leagues, 214 fictional clubs: IL tiers 1/2/3 (14/16/12), BE 16, NL 18, PT 18, CY 12, GR 14, EN-like 20, ES-like 20, IT-like 18, DE-like 18, FR-like 18. |
| `src/content/names.json` | 11 pools. IL has 88 first and 86 last names (Jewish, Arab, Ethiopian-Israeli, Russian-Israeli). The others have 35-36 first and last names each. All in Hebrew script. |
| `src/content/wages.json` | Monthly NIS bands per country, tier and age group. |
| `src/content/themes.json` | 20 season themes. |
| `src/content/events.json` | 150 templates (35 chain-only follow-ups, 35 chains), 466 variants, 448 options, all 15 categories. 41 cite a past choice through `because`, 25 are tied to season themes, 21 react to the last match. Every template marks exactly one `default` option for quick week. |
| `tools/validateContent.ts` | Schema, references, conditions, effects, placeholders, chains, history tags. Exit code 1 on error. |

Writing rules (enforced or reviewed): body ≤ 220 chars, option ≤ 60 chars, Hebrew only, no em-dashes, a real dilemma (no option strictly dominates), mixed tone, every `because` tag produced by some `history(tag)`.

## 15. Metrics (local only in v1; opt-in analytics later)
Day 1/7/30 return (later), the last screen before exit, % of players who reach the first contract, % who reach the career end, median seconds per week, the share of quick weeks, the share of "silence" weeks, and the distribution of options picked per event (any option above 85% means the dilemma is broken).

## 16. Prioritised backlog

### P0: v1 cannot ship without these
1. World generation from content + seed (leagues, clubs, squads, persons with traits). Weekly sim of all leagues, tables, promotion and relegation.
2. Onboarding (§5), with the 60/25/15 start roll.
3. Week plan + "שבוע מהיר" + autosave (IndexedDB).
4. Event engine: condition parser, weights, themes, anti-repetition, silence, cast selection, placeholders, the closed effect list, chains, `because` lines, memories.
5. Match sim with 3-5 key moments for W, ST and CM (GK, CB, FB and DM fall back to auto-resolve with text).
6. Week end with near-goals and open loops. World-reacts screen after notable matches.
7. Agent pick, offers, 3-round negotiation with an agent range.
8. Contracts, two transfer windows, wage bands.
9. Ageing, life stages incl. army, retirement, career-end timeline + share card.
10. Content validator in CI (`npm run validate`).

### P1: next, high value
1. Key moments for every position (GK, CB, FB, DM).
2. Rival comparison panel and rival career sim (moves, injuries).
3. National team windows (youth and senior), caps, choosing a nation when raised abroad.
4. Team editor import (§13). (P0 if legal review requires it for the beta.)
5. "בפרקים הקודמים" return screen.
6. Mid-career share card (headline).
7. Specialties: every 10 points in an attribute unlocks a visible move, up to 3 active.
8. Hidden personality traits shown as a season-end sentence.
9. 30+ more events, focused on veterans, abroad life and GK-specific stories.
10. Balance pass with mass sims (no dominant weekly plan, option-pick distribution).

### P2: later
1. Cup and European competitions, midweek matches (the week gets 1 slot).
2. Sponsorships and endorsements as a system, not just events.
3. Legacy: your son starts a career, and your old player is a coach in the world.
4. Shareable world seeds, a "challenge a friend" seed link.
5. More leagues (Turkey-like, Scotland-like, lower tiers abroad).
6. Opt-in analytics and a telemetry dashboard.
7. Accessibility audit for a full screen-reader pass of the match screen.

## 17. Open questions
- (Resolved) Quick-week picks come from the optional `default: true` field on one option per template, approved by the CTO. The validator errors on more than one and warns on none.
- Several careers at once, or one at a time (one gives every decision more weight)? We recommend one for v1.
