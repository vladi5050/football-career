// Procedural club crest. 6 shapes x 10 divisions x 14 palettes x 11 charges, coloured from the club colours.
// Pure SVG: sharp at any size. Never a real crest.
import { memo } from 'preact/compat';
import type { JSX } from 'preact';
import type { CrestSpec } from '../../core/types';

interface Props {
  spec: CrestSpec;
  colors: [string, string];
  size?: number;
  /** Used by the "initials" charge and for the accessible label. */
  name?: string;
  short?: string;
  class?: string;
}

const GOLD = '#E3B23C';
const WHITE = '#F7F7F2';
const INK = '#1B2A4A';

// ------------------------------------------------------------ colour helpers
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
export function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
/** Pick the most readable of candidates on top of `bg`. */
export function readableOn(bg: string, ...candidates: string[]): string {
  let best = candidates[0] ?? INK;
  let bestC = 0;
  for (const c of [...candidates, WHITE, INK]) {
    const k = contrast(bg, c);
    if (k > bestC + 0.01) {
      best = c;
      bestC = k;
    }
    if (k >= 3 && candidates.includes(c)) return c;
  }
  return best;
}

// ------------------------------------------------------------ palettes: [field, division, charge]
type Pal = (a: string, b: string) => [string, string, string];
const PALETTES: Pal[] = [
  (a, b) => [a, b, b],
  (a, b) => [b, a, a],
  (a, b) => [a, b, GOLD],
  (a, b) => [a, WHITE, b],
  (a, b) => [b, a, GOLD],
  (a) => [WHITE, a, a],
  (a) => [a, shade(a, -0.3), WHITE],
  (a, b) => [shade(a, -0.25), a, b],
  (a, b) => [a, b, WHITE],
  (a, b) => [b, shade(b, -0.25), a],
  (a, b) => [INK, a, b],
  (a, b) => [a, INK, b],
  (a, b) => [b, a, INK],
  (a, b) => [a, b, INK],
];

// ------------------------------------------------------------ shapes (viewBox 0 0 100 120)
const SHAPES: string[] = [
  'M8 8 H92 V58 C92 88 72 104 50 114 C28 104 8 88 8 58 Z', // heater
  '', // round: see ROUND
  'M8 14 Q50 2 92 14 V62 C92 90 72 104 50 114 C28 104 8 90 8 62 Z', // swiss
  'M30 6 H70 L94 30 V82 L70 112 H30 L6 82 V30 Z', // octagon badge
  'M24 6 H76 Q94 6 94 24 V96 Q94 114 76 114 H24 Q6 114 6 96 V24 Q6 6 24 6 Z', // rounded
  'M50 4 L92 20 V64 C92 90 70 106 50 116 C30 106 8 90 8 64 V20 Z', // peaked
];
const ROUND = 'M50 12 a48 48 0 1 0 0.01 0 Z';

function shapePath(i: number): string {
  return i % 6 === 1 ? ROUND : SHAPES[i % SHAPES.length]!;
}

function division(d: number, color: string): JSX.Element | null {
  switch (d % 10) {
    case 0:
      return null;
    case 1: // vertical stripes
      return (
        <g fill={color}>
          {[14, 38, 62].map((x) => <rect key={x} x={x} y="0" width="12" height="120" />)}
          <rect x="86" y="0" width="12" height="120" />
        </g>
      );
    case 2: // per pale
      return <rect x="50" y="0" width="50" height="120" fill={color} />;
    case 3: // quarterly
      return (
        <g fill={color}>
          <rect x="50" y="0" width="50" height="58" />
          <rect x="0" y="58" width="50" height="62" />
        </g>
      );
    case 4: // chevron
      return <path d="M0 78 L50 40 L100 78 V102 L50 64 L0 102 Z" fill={color} />;
    case 5: // sash
      return <path d="M-10 18 L18 -10 L112 84 L84 112 Z" fill={color} />;
    case 6: // hoops
      return (
        <g fill={color}>
          {[16, 44, 72, 100].map((y) => <rect key={y} x="0" y={y} width="100" height="14" />)}
        </g>
      );
    case 7: // per fess
      return <rect x="0" y="60" width="100" height="60" fill={color} />;
    case 8: // cross
      return (
        <g fill={color}>
          <rect x="41" y="0" width="18" height="120" />
          <rect x="0" y="44" width="100" height="18" />
        </g>
      );
    case 9: // chief (top band)
      return <rect x="0" y="0" width="100" height="34" fill={color} />;
  }
  return null;
}

// Charges drawn in a 40x40 box, centred by the caller.
function charge(c: number, fill: string, hole: string, label: string): JSX.Element {
  switch (c % 11) {
    case 0: // star
      return <path d="M20 1 L25 14.5 L39.5 15 L28 24 L32 38.5 L20 30 L8 38.5 L12 24 L0.5 15 L15 14.5 Z" fill={fill} />;
    case 1: // tower
      return <path d="M6 38 V12 H11 V5 H16 V10 H24 V5 H29 V10 H34 V38 H24 V28 A4 4 0 0 0 16 28 V38 Z" fill={fill} />;
    case 2: // anchor
      return (
        <g fill="none" stroke={fill} stroke-width="4" stroke-linecap="round">
          <circle cx="20" cy="6.5" r="4" />
          <path d="M20 10.5 V36 M11 16 H29 M5 25 Q8 36 20 36 Q32 36 35 25" />
        </g>
      );
    case 3: // ball
      return (
        <g>
          <circle cx="20" cy="20" r="17" fill={fill} />
          <path d="M20 12 L27 17 L24.5 25 H15.5 L13 17 Z" fill={hole} />
          <path d="M20 12 V4 M27 17 L34 14 M24.5 25 L29 32 M15.5 25 L11 32 M13 17 L6 14" stroke={hole} stroke-width="2" />
        </g>
      );
    case 4: // lion-ish head
      return (
        <g>
          <path d="M20 1 L24 6 L30 3 L31 10 L38 10 L35 16 L40 21 L34 24 L36 31 L29 30 L27 37 L20 33 L13 37 L11 30 L4 31 L6 24 L0 21 L5 16 L2 10 L9 10 L10 3 L16 6 Z" fill={fill} />
          <circle cx="20" cy="20" r="9.5" fill={hole} />
          <circle cx="16.5" cy="18" r="1.8" fill={fill} />
          <circle cx="23.5" cy="18" r="1.8" fill={fill} />
          <path d="M17 23 L20 26 L23 23 Z" fill={fill} />
        </g>
      );
    case 5: // crown
      return <path d="M3 32 L1 10 L11 19 L20 5 L29 19 L39 10 L37 32 Z M3 35 H37 V39 H3 Z" fill={fill} />;
    case 6: // waves
      return (
        <g fill="none" stroke={fill} stroke-width="4.5" stroke-linecap="round">
          {[9, 20, 31].map((y) => <path key={y} d={`M2 ${y} q4.5 -6 9 0 t9 0 t9 0 t9 0`} />)}
        </g>
      );
    case 7: // tree
      return <path d="M20 1 L31 15 H26 L35 27 H23 V39 H17 V27 H5 L14 15 H9 Z" fill={fill} />;
    case 8: // key
      return (
        <g fill={fill}>
          <path d="M20 2 a9 9 0 1 0 0.01 0 Z M20 7 a4 4 0 1 1 -0.01 0 Z" fill-rule="evenodd" />
          <rect x="17.5" y="18" width="5" height="21" />
          <rect x="22" y="28" width="7" height="4" />
          <rect x="22" y="34" width="5" height="4" />
        </g>
      );
    case 9: // eagle-ish
      return (
        <g fill={fill}>
          <path d="M20 10 C14 4 6 4 0 8 C6 10 8 14 9 18 C4 18 2 21 1 24 C7 22 11 24 14 28 L17 38 H23 L26 28 C29 24 33 22 39 24 C38 21 36 18 31 18 C32 14 34 10 40 8 C34 4 26 4 20 10 Z" />
          <circle cx="20" cy="9" r="4.5" />
        </g>
      );
    default: // initials
      return (
        <text x="20" y="31" text-anchor="middle" font-family="Karantina, Assistant, sans-serif" font-weight="700" font-size={label.length > 1 ? 30 : 36} fill={fill}>
          {label}
        </text>
      );
  }
}

let uid = 0;

const mod = (x: number, n: number) => ((Math.floor(Number(x) || 0) % n) + n) % n;

function CrestImpl({ spec, colors, size = 48, name = '', short, class: cls }: Props) {
  const shapeI = mod(spec[0], 6), divI = mod(spec[1], 10), palI = mod(spec[2], 14), chI = mod(spec[3], 11);
  const [a, b] = colors;
  const [field, div, ch0] = PALETTES[palI % PALETTES.length]!(a, b);
  // Charge sits mostly on the field; make sure it reads.
  const charge0 = contrast(field, ch0) < 2.2 ? readableOn(field, div, GOLD) : ch0;
  const id = `cr${++uid}`;
  const path = shapePath(shapeI);
  const label = (short ?? name).replace(/[״׳"'.\s-]/g, '').slice(0, 2) || '?';
  const rim = contrast(field, INK) > 3 ? INK : shade(field, -0.45);
  const scale = 1.05;
  return (
    <svg
      class={`crest ${cls ?? ''}`}
      width={size}
      height={size * 1.2}
      viewBox="-4 -4 108 128"
      role="img"
      aria-label={name ? `סמל ${name}` : 'סמל מועדון'}
    >
      <defs>
        <clipPath id={id}>
          <path d={path} />
        </clipPath>
      </defs>
      <path d={path} fill={rim} transform="translate(0 2.5)" opacity="0.35" />
      <g clip-path={`url(#${id})`}>
        <rect x="-5" y="-5" width="110" height="130" fill={field} />
        {division(divI, div)}
        {/* gloss */}
        <path d="M0 0 H100 V44 Q50 58 0 44 Z" fill="#fff" opacity="0.10" />
      </g>
      <path d={path} fill="none" stroke={rim} stroke-width="5" />
      <path d={path} fill="none" stroke={WHITE} stroke-width="1.6" opacity="0.55" transform="translate(50 60) scale(0.9) translate(-50 -60)" />
      <g transform={`translate(${50 - 20 * scale} ${57 - 20 * scale}) scale(${scale})`}>
        {/* halo so the charge separates from busy divisions */}
        <g stroke={field} stroke-width="5" stroke-linejoin="round" opacity="0.9">
          {charge(chI, field, field, label)}
        </g>
        {charge(chI, charge0, field, label)}
      </g>
    </svg>
  );
}

export const Crest = memo(CrestImpl);
