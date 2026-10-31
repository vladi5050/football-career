// Data model of the "decision moment" (רגע החלטה): a tactical read on the whiteboard instead of a swipe.
import type { MomentKind } from '../../core/types';

/** Attributes an option can lean on (keys of core Attributes). */
export type OptAttr = 'finishing' | 'passing' | 'dribbling' | 'pace' | 'heading' | 'vision' | 'defending' | 'gk' | 'stamina';

export type Pt = [number, number];
/** Where a choreography step goes: a point, a named spot, a magnet id (its position when the step starts), or an offset. */
export type Target = Pt | string | { id: string; dx?: number; dy?: number } | { p: string; dx?: number; dy?: number };

export interface Step {
  /** 'ball' or a magnet id */
  w: string;
  to: Target;
  /** start time (s) from the pick */
  at?: number;
  /** duration (s) */
  d?: number;
  /** lob height (board units): the ball grows and its shadow drops away */
  arc?: number;
  /** magnet pose at the end of the step */
  pose?: 'dive' | 'slide' | 'down' | 'jump';
}

export type IconKey = 'shot' | 'curl' | 'chip' | 'pass' | 'cross' | 'dribble' | 'shield' | 'head' | 'tackle' | 'jockey' | 'cover' | 'glove' | 'clear' | 'run' | 'wait';

export interface OptionTpl {
  id: string;
  /** card label; {m1}/{m2}/{m3} are replaced by teammate labels */
  label: string;
  icon: IconKey;
  attr: OptAttr;
  risk: 1 | 2 | 3;
  /** false = a safe option: success keeps the ball / buys time but is not "the big play" */
  bold?: boolean;
  ok: Step[];
  fail: Step[];
  /** stamp texts [success, failure] (defaults per kind) */
  stamp?: [string, string];
  /** commentator lines [success, failure]; {name} = player surname */
  say: [string, string];
  /** context shifts of the situational fit */
  ctx?: { protect?: number; chase?: number; rain?: number; hostile?: number; rival?: number };
  /** a goal is scored on success (ripple the net) */
  goal?: boolean;
  /** a goal is conceded on failure */
  concede?: boolean;
}

export interface MagnetDef {
  id: string;
  team: 'u' | 'o';
  x: number;
  y: number;
  gk?: boolean;
  /** label on the magnet (shirt number); 'me' gets the user's number */
  n?: number | string;
}

export interface Arrow {
  from: Target;
  to: Target;
  /** run = teammate run (blue dashed), press = pressure (red), pass = possible pass (thin) */
  kind: 'run' | 'press' | 'pass';
  bend?: number;
}

export interface Variant {
  id: string;
  /** coach note (Hebrew, short) */
  note: string;
  magnets: MagnetDef[];
  ball: Pt;
  arrows: Arrow[];
  /** hidden situational fit 0..1 per option id. Missing = option not offered in this variant */
  fit: Record<string, number>;
  /** optional label overrides per option id */
  labels?: Record<string, string>;
  /** keeper / role variant filter */
  role?: 'keeper' | 'taker';
}

export interface KindDef {
  kind: MomentKind;
  title: string;
  /** default stamps [success, fail] */
  stamp: [string, string];
  options: OptionTpl[];
  variants: Variant[];
  /** our goal is the one on the board (defensive kinds) */
  defending?: boolean;
}

export interface DecisionOption {
  id: string;
  label: string;
  icon: IconKey;
  attr: OptAttr;
  attrValue: number;
  risk: 1 | 2 | 3;
  fit: number;
  chance: number;
  tpl: OptionTpl;
}

export interface Resolved {
  optionId: string | null;
  success: boolean;
  quality: number;
  stamp: string;
  line: string;
}
