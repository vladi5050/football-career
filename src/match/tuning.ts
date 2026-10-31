// Tunable constants for the key-moment player. Pure data, no Pixi.
// Every value can be overridden through playMoment(..., { tuning: {...} }).

export interface Tuning {
  // --- gesture thresholds (CSS px / ms). Mouse multiplies distances by desktopFactor.
  tapMaxMs: number;
  tapMaxPx: number;
  swipeMinPx: number;
  swipeMaxMs: number;
  /** midpoint deviation / length above which a swipe counts as curled */
  curlRatio: number;
  /** swipe speed (px/ms) that maps to power 0 and 1 */
  powerMinSpeed: number;
  powerMaxSpeed: number;
  desktopFactor: number;

  // --- reactions
  /** keeper / defender reaction time at difficulty 0 and 1 (seconds) */
  reactEasy: number;
  reactHard: number;
  /** keeper standing reach (m) and dive speed (m/s) */
  keeperReach: number;
  keeperDiveSpeed: number;
  /** defender reach for interceptions / blocks (m) */
  defenderReach: number;

  // --- timing windows (half width, ms) at difficulty 0; shrinks to *hardWindowFactor at difficulty 1
  tapWindowMs: number;
  hardWindowFactor: number;
  /** attacker skill 99 widens windows by this factor (skill 1 = 1.0) */
  skillWindowBonus: number;
  lateCloseWindow: number; // multiplier (0.8 = 20% smaller)
  hostileWindow: number; // multiplier (0.9 = 10% smaller)

  // --- ball
  gravity: number; // m/s^2
  groundFriction: number; // 1/s velocity decay on grass
  rainFriction: number; // multiplier on groundFriction in rain (<1 = slicker)
  airDrag: number; // 1/s
  bounce: number; // vertical restitution
  spinDecay: number; // 1/s
  /** lateral accel (m/s^2) for a fully curled swipe */
  maxCurlAccel: number;
  /** random aim deviation (m at the goal) in rain */
  rainDeviation: number;
  /** aim noise (m) at skill 1, and at skill 99 */
  aimNoiseLow: number;
  aimNoiseHigh: number;
  shotSpeedMin: number; // m/s at power 0
  shotSpeedMax: number; // m/s at power 1

  // --- presentation
  slowMoScale: number;
  slowMoSeconds: number; // real seconds of slow motion
  introSeconds: number; // instruction overlay before input opens
  resultSeconds: number; // result text hold
  maxDpr: number;
}

export const DEFAULT_TUNING: Tuning = {
  tapMaxMs: 200,
  tapMaxPx: 20,
  swipeMinPx: 40,
  swipeMaxMs: 600,
  curlRatio: 0.12,
  powerMinSpeed: 0.25,
  powerMaxSpeed: 2.4,
  desktopFactor: 1.5,

  reactEasy: 0.35,
  reactHard: 0.15,
  keeperReach: 1.15,
  keeperDiveSpeed: 4.6,
  defenderReach: 1.1,

  tapWindowMs: 190,
  hardWindowFactor: 0.6,
  skillWindowBonus: 0.35,
  lateCloseWindow: 0.8,
  hostileWindow: 0.9,

  gravity: 9.81,
  groundFriction: 0.9,
  rainFriction: 0.6,
  airDrag: 0.06,
  bounce: 0.45,
  spinDecay: 0.35,
  maxCurlAccel: 7.5,
  rainDeviation: 0.45,
  aimNoiseLow: 0.9,
  aimNoiseHigh: 0.15,
  shotSpeedMin: 13,
  shotSpeedMax: 31,

  slowMoScale: 0.22,
  slowMoSeconds: 0.75,
  introSeconds: 1.1,
  resultSeconds: 1.25,
  maxDpr: 2,
};

export function mergeTuning(over?: Partial<Tuning>): Tuning {
  return { ...DEFAULT_TUNING, ...(over ?? {}) };
}
