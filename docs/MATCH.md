# Key moments (`src/match/`)

The match engine (core) sends 3 to 5 `MomentSpec`s per match. Each one plays as a 4 to 8 second interactive
PixiJS 8 mini-scene in portrait. The scene resolves with a `MomentResult` and then removes everything it created.

## API

```ts
import { playMoment } from './match';            // lazy-load: const { playMoment } = await import('./match')

const result = await playMoment(hostElement, spec, {
  reducedMotion?: boolean,                       // default: prefers-reduced-motion
  tuning?: Partial<Tuning>,                      // override anything in tuning.ts
  colors?: { user: [c1, c2], opp: [c1, c2] },    // team kits (CSS hex). Default blue vs red
  asKeeper?: boolean,                            // penalty only: the user is the goalkeeper
});
// result: { momentId, success, quality 0..1, skipped }
```

- `host` should be a sized element, normally a full-screen overlay. `playMoment` fills it with a canvas and a
  DOM HUD. If `host` is `position: static`, it is set to `relative` while the moment plays.
- Skip: `host.dispatchEvent(new CustomEvent('moment-skip'))` resolves at once with `{ skipped: true, success: false, quality: 0 }`.
  The engine should then use `resolveMomentAuto`.
- If no input arrives before the time limit, the moment resolves as a weak failure (quality about 0.05 to 0.1). It never hangs.
- If WebGL init fails, the moment resolves as `skipped: true`.
- Cleanup: the ticker stops, listeners are removed, and the Pixi app is destroyed (`removeView`, children) along with the
  generated stands texture. The HUD and wrapper are also removed. Twenty moments in a row leave 0 canvases and give no
  "too many WebGL contexts" warning (checked in Playwright).
- DPR is capped at `tuning.maxDpr` (2).

### `success` semantics (for the engine)
| kind | success means |
|---|---|
| shot, long_shot, free_kick, header, one_on_one, penalty (taker) | goal scored |
| penalty (keeper), save | no goal conceded (saved, or the shot missed) |
| rush_out | the keeper smothered the ball |
| through_ball | the pass reached a runner |
| cross | the cross reached a teammate's head. The header itself is up to the engine |
| dribble | the defender is beaten |
| interception / tackle / block / clearance | the attack was stopped. A tackle that is too early is a **foul**: `success: false`, reason shown as "עבירה!" |

`quality` is how well the action was executed. The engine uses it for the rating.
- Goals: 0.62 to 1.0. More margin past the keeper's reach scores higher.
- Saved shots: 0.28 to 0.53. Corner-bound shots score higher.
- Misses: 0.05 to 0.28. A near miss scores higher.
- Timing moments: 0.55 + 0.45 × accuracy inside the window. A near miss outside it scores 0.1 to 0.3.
- No input: about 0.05 to 0.1.

## Files

| file | what |
|---|---|
| `index.ts` | `playMoment`, phase loop (intro → action → resolve → result), slow-mo, skip, cleanup |
| `swipe.ts` | `classifyGesture` (pure) + `GestureTracker` (Pointer Events, works with touch, pen and mouse) |
| `tuning.ts` | all thresholds and constants (`DEFAULT_TUNING`, `mergeTuning`) |
| `sim.ts` | **pure** logic with no Pixi: ball step, launch/curl, keeper reach, timing windows, all outcome resolvers |
| `camera.ts` | pure pseudo-3D broadcast camera (project / unproject / framing) |
| `scene.ts` | Pixi renderer: pitch with stripes and lines, stands, ad boards, goal + net ripple, player tokens, ball + shadow + trail, particles, rain, shake, flash |
| `hud.ts` | DOM overlay in Hebrew/RTL: minute, stakes, score, context tags, instruction, timer bar, grade popup, result banner, rival name tag, heartbeat vignette |
| `moments/attack.ts` | shot, long_shot, free_kick, penalty (taker + keeper), one_on_one, header |
| `moments/play.ts` | dribble, through_ball, cross, interception |
| `moments/defend.ts` | tackle, block, clearance, save, rush_out |
| `demo.html` / `demo.ts` | dev page: `http://localhost:5173/src/match/demo.html` |

## Flow of every moment
1. **Intro (1.1s):** the camera eases in from a high, wide shot. A big instruction card shows, with an animated
   ghost-gesture hint (a swipe arrow or a pulsing tap target). An eager swipe after 0.35s starts the action
   right away. This applies to swipe moments only. Timing moments always wait for the intro to finish.
2. **Action:** the instruction shrinks into a pill and a timer bar runs. The scene animates: players run, the cross
   flies, the lane lights up.
3. **Resolve:** the outcome comes from `sim.ts` and the animation replays it. Slow motion (×0.22 for 0.75s real
   time) plus a 10% zoom punch lands on the decisive frame (ball reaching the goal line, the tackle, the
   interception). Then the FX play: on a goal, net ripple + flash + shake + confetti + crowd surge; on a save,
   sparks; on the woodwork, a clang.
4. **Result (1.25s):** a big banner shows (גול! / החטאה / הצלה! / חטיפה! / עבירה! …). A quality line follows when
   relevant ("ביצוע מושלם").

## How each moment plays
Camera: attacking moments use a broadcast view from behind the attacker with the goal at the top.
Defensive moments use a view from behind our own goal. Keeper moments use a tight camera, so the goal fills the width.

| kind | gesture | what decides it |
|---|---|---|
| **shot** | swipe from anywhere | The swipe direction is cast from the ball to the goal line, which gives the lateral aim. Swipe length (relative to the on-screen distance to goal) plus power set the height, and too much goes over. A bowed swipe adds curl (slightly harder for the keeper to read). Aim noise grows with power and shrinks with skill. The keeper reacts after `reactionTime`, with reach + dive speed. A defender closes in: if you wait too long he blocks the shot. |
| **long_shot** | swipe | Same as shot from 24 to 30m. Two or three blockers stand in the lane (they are obstacles in the sim), and the keeper stands off his line. A weak shot gives the keeper time to save it. |
| **free_kick** | swipe, ideally curled | A wall of 4 or 5 sits 9.15m away toward the near post. Its obstacle height is 2.15m because the wall jumps. The keeper stands at the far post. To score, get over the wall and dip under the bar, or bend the ball around the wall. |
| **penalty (taker)** | swipe | Aim as for a shot. The keeper commits to a side. On a hard spec he reads your side more often (22% plus 30% × difficulty). A centred ball beats a diving keeper, and a corner on his wrong side always goes in. |
| **penalty (keeper)** (`asKeeper`) | swipe to dive | The taker runs up. The swipe direction maps to the dive point: up means high, and the screen is mirrored. Diving more than 0.3s before the kick lets the taker switch sides. |
| **one_on_one** | tap **or** up-swipe | Tap when the keeper's ring turns green (gap about 5m) to round him and roll the ball into the empty net. Or swipe up to chip: this works when the keeper is 1.8 to 10m from you, and the best weight is power about 0.48. Doing nothing means the keeper smothers the ball. The camera follows the run. |
| **header** | tap when the ball reaches the shrinking ring | A real lofted cross from the wing. The timing window is ±175ms (scaled by context). Tap on the left or right half of the screen to pick the corner. Better timing gives a firmer, lower header, which then goes through the normal keeper check. |
| **dribble** | swipe left/right | The defender leans to one side, then commits: the red ring closes on him. Swipe to the other side as he commits (window ±200ms × 1.25). Too early and he recovers, too late and he wins the ball, and the wrong side fails. |
| **through_ball** | swipe toward a runner's lane | Two runners attack the gaps (cyan dashed lanes). Power sets the distance (10 to 36m), and a bowed swipe bends the pass. Every defender, the presser and the keeper run at the ball after their reaction time, and whoever reaches it first wins it. You have to lead the runner. |
| **cross** | swipe toward a teammate | Aim assist snaps the length to the teammate closest to the swipe ray. Power trades float for pace. Markers, the near fullback and the keeper (inside 6m) compete for the ball. |
| **interception** | tap when the pass lane lights up | The lane goes from grey dashed to glowing yellow, and the pass follows 0.14s later. Tapping before the light makes the passer see you and pick another option. Tapping late lets the ball through. |
| **tackle** | tap when the ball is in the ring | The dribbler takes a heavy touch (the ball glows) and the ring closes. Too early is a foul (yellow card text). Too late and he skips past. |
| **block** | swipe toward the shot side (or tap/swipe up for a central shot) | A red line telegraphs where the shot is going 0.5s before the strike. Get the direction right (tolerance 0.45 to 0.55 rad) before the ball reaches you. |
| **clearance** | swipe away from goal | A cross drops onto you. A swipe made early is queued and plays when the ball arrives. You need the ball away from goal (cos > 0.26) and power ≥ 0.28. Clearing to the flanks scores higher. A swipe toward your own goal is "כמעט שער עצמי". |
| **save** | swipe to dive | The shooter dribbles in and strikes. The swipe sets the dive point. You need at least 0.06s of lead before the ball arrives. Diving early lets the shooter go the other way. A shot straight at a frozen keeper still counts as a save. |
| **rush_out** | tap when the striker over-runs the ball | The ball glows and pulses when it gets loose. Tap in the window to smother it. Too early and you get chipped, too late and he finishes past you. |

### Variety
- Each spec is seeded by `spec.id` + minute. Ball spot, angle, side, defenders, wall size, cross side, runner gaps, strike
  timing and shot target all change, so the same kind never plays the same way twice.
- Context changes how a moment looks and feels:
  - `lateClose`: tap windows shrink by 20%, the zoom goes up 7%, and a red heartbeat vignette and letterbox bars appear.
  - `hostileCrowd`: windows shrink by 10%, the screen jolts in rhythm and the stands bounce.
  - `rain`: friction × 0.6 (passes run on), plus a random aim deviation of ±0.45m, rain streaks, a darker grade and a wet sheen.
  - `rivalInvolved`: the opponent gets a red ring and a "היריב {name}" tag. He reacts 10% faster and has 6% more reach.
  - `derby`: a tag in the HUD.
- `difficulty` scales the keeper or defender reaction time (0.35s → 0.15s) and the keeper's reach (×0.85 → ×1.18). It also shrinks the
  windows (×1 → ×0.6). `attackerSkill` widens the windows by up to 35% and cuts the aim noise from 0.9m to 0.15m.

### Reduced motion
Turns off camera eases, the slow-mo and zoom punch, shake, confetti and falling rain. It reduces particles to a third,
caps the flash and makes the vignette static. Gameplay timing does not change.

## Tuning (`tuning.ts`, all overridable)

| key | default | meaning |
|---|---|---|
| tapMaxMs / tapMaxPx | 200 / 20 | a tap is shorter and smaller than this |
| swipeMinPx / swipeMaxMs | 40 / 600 | a swipe is at least this long, and faster than this |
| curlRatio | 0.12 | midpoint deviation / length that counts as a curl |
| powerMinSpeed / powerMaxSpeed | 0.25 / 2.4 px/ms | speeds that map to power 0 and 1 |
| desktopFactor | 1.5 | mouse multiplies distance thresholds (`pointerType === 'mouse'`) |
| reactEasy / reactHard | 0.35 / 0.15 s | opponent reaction time at difficulty 0 and 1 |
| keeperReach / keeperDiveSpeed | 1.15 m / 4.6 m/s | standing reach, plus dive speed after reacting (max 3.6m) |
| defenderReach | 1.1 m | interception reach |
| tapWindowMs | 190 | base half-window (some kinds use their own base: header 175, dribble 200, interception 200, rush_out 230) |
| hardWindowFactor | 0.6 | window multiplier at difficulty 1 |
| skillWindowBonus | 0.35 | extra window at skill 99 |
| lateCloseWindow / hostileWindow | 0.8 / 0.9 | context multipliers |
| gravity / groundFriction / airDrag / bounce | 9.81 / 0.9 / 0.06 / 0.45 | ball model |
| rainFriction / rainDeviation | 0.6 / 0.45 m | rain |
| spinDecay / maxCurlAccel | 0.35 /s / 7.5 m/s² | curl |
| aimNoiseLow / aimNoiseHigh | 0.9 / 0.15 m | aim noise at skill 1 / 99 (× power factor) |
| shotSpeedMin / shotSpeedMax | 13 / 31 m/s | shot speed at power 0 / 1 |
| slowMoScale / slowMoSeconds | 0.22 / 0.75 | decisive-frame slow motion |
| introSeconds / resultSeconds | 1.1 / 1.25 | phase lengths |
| maxDpr | 2 | renderer resolution cap |

## Dev page and verification
- `npx vite --port 5174` → `http://localhost:5174/src/match/demo.html`. Pick a kind, toggle the context flags, then play.
  "5 ברצף" runs five moments in a row and logs the canvas count.
  URL params for automation: `?kind=save&rain=1&lateClose=1&hostileCrowd=1&rivalInvolved=1&derby=1&asKeeper=1&difficulty=0.7&skill=60&auto=1&bare=1&seed=3`.
- In dev builds the current scene is exposed as `globalThis.__mm` (`scene`, `ctx`, `script`). Playwright uses it to aim swipes.
- Unit tests: `npx vitest run tests/unit/match` covers swipe classification and all of the sim's resolvers and physics.
- Screenshots: `docs/match-shots/*.png`.
