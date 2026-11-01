# Contracts between departments (owned by the CTO)

Source design docs are in `docs/source/` (Hebrew). The data model is `src/core/types.ts` — do NOT change it without the CTO; if you need a field, add it as optional and note it in your report.

## Layers (enforced)
```
src/content/   JSON data only (leagues, clubs, names, events, themes, wages, tuning)
src/core/      pure TS game logic. No DOM, no window, no pixi, no preact. Runs in Node + Web Worker.
src/worker/    sim.worker.ts: wraps core, exposed via Comlink
src/match/     PixiJS key-moment player (lazy loaded). Imports only core/types.
src/ui/        Preact screens + components + CSS. Imports core/types (types only) and app/store.
src/app/       store.ts (signals), save.ts (IndexedDB), main.tsx
```

## Content: `src/content/leagues.json`
```jsonc
{
  "leagues": [
    { "key": "il1", "name": "ליגת העל", "countryCode": "IL", "country": "ישראל", "tier": 1,
      "promotesTo": null, "relegatesTo": "il2", "promoteSpots": 0, "relegateSpots": 2,
      "strength": 52, "wageFactor": 1.0, "simLevel": "full",
      "clubs": [
        { "name": "מכבי הכרמל", "short": "מכ״כ", "city": "חיפה", "colors": ["#0B7A3B", "#FFFFFF"],
          "reputation": 78, "stadium": "אצטדיון הכרמל", "rival": "הפועל הכרמל", "crestCharge": 3 }
      ] }
  ]
}
```
- Lookalike / fictional names only. Never a real club name, never real crests.
- `rival` is the name of another club in the same file (derby). Optional.
- `crestCharge` optional (0..10), otherwise derived from a hash of the name.

## Content: `src/content/names.json`
`{ "IL": { "first": [...], "last": [...] }, "BE": {...}, ... }` all in Hebrew transliteration (the UI is Hebrew). >= 60 first + 60 last for IL, >= 30/30 for others.

## Content: `src/content/wages.json`
Monthly wage NIS bands per league tier & age group, e.g.
`{ "IL": { "1": { "u19": [6000, 12000], "u23": [15000, 45000], "prime": [30000, 120000], "vet": [20000, 70000] }, "2": {...} }, "BE": {...} }`

## Content: `src/content/themes.json`
`[{ "id": "relegation_fight", "name": "מאבק בתחתית", "desc": "...", "categoryBoost": { "pressure": 2, "money": 1.3 } }]`

## Content: `src/content/events.json` — event templates
```jsonc
{
  "id": "coach_bench_after_party",            // unique snake_case
  "category": "discipline",                    // minutes|money|injury|transfer|family|media|rival|team|discipline|pressure|agent|army|fans|national|life
  "weight": 10,                                 // base weight
  "cooldown": 12,                               // weeks before it can appear again (default 12)
  "once": false,                                // true = once per career
  "when": ["flag(party) >= 1", "rel(coach) < 30"],   // ALL must be true
  "cast": { "coach": "coach", "mate": "teammate" },  // roleName -> selector
  "because": "party",                           // history tag to cite in a "כי בשבוע X..." line (optional)
  "variants": [                                  // 3-5 variants; {placeholders} below
    { "title": "המאמן לא שכח", "body": "{coach} קורא לך לחדר. \"שמעתי על המסיבה.\"" }
  ],
  "options": [
    { "id": "apologise", "text": "להתנצל ולהבטיח שזה לא יחזור", "hint": "המאמן יעריך את זה",
      "effects": ["rel(coach) += 8", "morale -= 3", "memory(coach, apologised, 10)"],
      "chain": [{ "after": 4, "event": "coach_checks_promise" }] },
    { "id": "defy", "text": "\"זה הזמן הפרטי שלי\"", "effects": ["rel(coach) -= 15", "fame += 1", "flag(defiant) += 1"] }
  ]
}
```
Rules: every template must have >= 2 options and >= 3 variants (chain-only follow-ups may have 2). Option `text` <= 60 chars. Hebrew only, natural Israeli football voice, no em-dashes.

### Selectors (cast)
`coach` (user's club manager), `agent`, `rival` (rival footballer), `teammate` (random squad mate), `captain`, `youngster` (youngest squad mate), `veteran` (oldest), `journalist`, `chairman`, `father`, `mother`, `friend`, `opp_coach` (next opponent manager). Chains reuse the cast of the parent event automatically.

### Placeholders
`{player}` user's full name, `{first}` user's first name, `{club}`, `{league}`, `{opp}` next opponent, `{week}`, `{age}`, any cast role e.g. `{coach}` `{mate}`, `{because}` is rendered separately by the engine.

### Condition language (`when`)
Expressions combined with `&&`, `||`, `!`, parentheses; comparisons `< <= > >= == !=`; numbers.
Functions/values:
`rel(role)` relation of cast/role person with user (-100..100) · `attr(key)` user attribute · `overall` · `age` · `fame` · `money` · `form` · `morale` · `fitness` · `persistence` · `seasonWeek` · `season` · `absWeek` · `flag(name)` · `injured` (0/1) · `tier` (league tier) · `foreign` (0/1 playing abroad) · `starter` (0/1 started last match) · `lastResult` (1 win, 0 draw, -1 loss) · `lastRating` · `goalsSeason` · `trait(role, trait_id)` (0/1) · `theme(id)` (0/1) · `window` (0/1 transfer window open) · `derbyNext` (0/1) · `recent(tag, weeks)` (0/1 history tag within N weeks) · `stage(youth|army|pro|veteran)` (0/1) · `pos(W)` (0/1) · `hasOffer` (0/1) · `contractLeft` (seasons left)

### Effects (closed list)
`rel(role) += n` / `-= n` · `morale += n` · `persistence += n` / `-= n` (training persistence 1..100) · `fame += n` · `money += n` · `form += n` · `fitness += n` · `attr(key) += n` · `flag(name) += n` / `flag(name) = n` · `memory(role, tag, weight)` · `history(tag)` · `promise(role, weeks, tag)` · `injury(weeks)` · `potential += n` · `goal(kind, target, text)` · `news(text)` · `offer(any|abroad|bigger)` (spawn a transfer offer) · `squadRole(starter|rotation|backup)`

## Moment player API (`src/match/`)
```ts
export async function playMoment(host: HTMLElement, spec: MomentSpec, opts: { reducedMotion?: boolean }): Promise<MomentResult>
```
Resolves after the moment animation finishes. Must clean up its Pixi app. `spec.kind` drives the mini-scene.

## Core API (`src/core/game.ts`)
```ts
export function newGame(cmd: Extract<Command,{type:'newCareer'}>, content: Content): World
export function apply(world: World, cmd: Command, content: Content): { world: World; toast?: string[] } // mutates + returns
export function buildView(world: World): View
export function resolveMomentAuto(spec: MomentSpec, rng): MomentResult
```
`Content` is defined in `src/core/content.ts` (loaded JSON bundle).
