// A jersey seen from the back (name + number), optionally hanging on a locker hook.
import { readableOn, shade } from './Crest';

interface ShirtProps {
  name: string;
  number: number;
  colors: [string, string];
  pattern?: 'plain' | 'stripes' | 'hoops' | 'sash';
  width?: number;
  class?: string;
  /** Omit name/number (used when the text is drawn elsewhere, e.g. on the share canvas). */
  noText?: boolean;
}

const BODY = 'M44 12 Q70 22 96 12 L124 24 L138 58 L114 68 L109 54 L109 142 Q70 149 31 142 L31 54 L26 68 L2 58 L16 24 Z';
let n = 0;

export function Shirt({ name, number, colors, pattern = 'plain', width = 140, class: cls, noText }: ShirtProps) {
  const [c1, c2] = colors;
  const ink = readableOn(c1, c2);
  const id = `sh${++n}`;
  const label = name.trim();
  const long = label.length > 9;
  return (
    <svg class={`shirt-svg ${cls ?? ''}`} width={width} height={width * (150 / 140)} viewBox="0 0 140 150" role="img" aria-label={`חולצה ${number} ${label}`}>
      <defs>
        <clipPath id={id}>
          <path d={BODY} />
        </clipPath>
        <linearGradient id={`${id}g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="#000" stop-opacity="0.16" />
          <stop offset="0.22" stop-color="#000" stop-opacity="0" />
          <stop offset="0.78" stop-color="#000" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity="0.18" />
        </linearGradient>
      </defs>
      <g clip-path={`url(#${id})`}>
        <rect width="140" height="150" fill={c1} />
        {pattern === 'stripes' && (
          <g fill={c2} opacity="0.9">
            {[38, 62, 86].map((x) => <rect key={x} x={x} y="0" width="12" height="150" />)}
          </g>
        )}
        {pattern === 'hoops' && (
          <g fill={c2} opacity="0.9">
            {[30, 70, 110].map((y) => <rect key={y} x="0" y={y} width="140" height="16" />)}
          </g>
        )}
        {pattern === 'sash' && <path d="M0 40 L30 10 L140 120 L110 150 Z" fill={c2} opacity="0.9" />}
        {/* number/name panel so text always reads on patterned shirts */}
        {pattern !== 'plain' && <rect x="40" y="38" width="60" height="92" rx="6" fill={c1} />}
        <rect width="140" height="150" fill={`url(#${id}g)`} />
        {/* fabric folds */}
        <path d="M50 70 Q56 100 48 140 M92 74 Q86 104 94 140" stroke="#000" stroke-opacity="0.07" stroke-width="3" fill="none" />
      </g>
      <path d={BODY} fill="none" stroke={shade(c1, -0.4)} stroke-width="1.6" stroke-linejoin="round" />
      {/* collar + cuffs */}
      <path d="M44 12 Q70 22 96 12" fill="none" stroke={c2} stroke-width="5" stroke-linecap="round" />
      <path d="M138 58 L114 68 M2 58 L26 68" stroke={c2} stroke-width="5" />
      {!noText && <text
        x="70"
        y="52"
        text-anchor="middle"
        font-family="Assistant, sans-serif"
        font-weight="800"
        font-size={long ? 12 : 14}
        fill={ink}
        {...(label.length > 12 ? { textLength: 64, lengthAdjust: 'spacingAndGlyphs' } : {})}
      >
        {label}
      </text>}
      {!noText && <text x="70" y="124" text-anchor="middle" font-family="Karantina, Assistant, sans-serif" font-weight="700" font-size="74" fill={ink}>
        {number}
      </text>}
    </svg>
  );
}

export function ShirtOnHook(props: ShirtProps & { swing?: boolean }) {
  return (
    <div class={`shirt-hook ${props.swing ? 'swing' : ''}`}>
      <svg class="hook" viewBox="0 0 34 30" aria-hidden="true">
        <rect x="9" y="0" width="16" height="9" rx="2" fill="#8E959C" />
        <path d="M17 6 V18 Q17 26 10 26 Q5 26 5 21" fill="none" stroke="#B8BDC2" stroke-width="3.5" stroke-linecap="round" />
        <path d="M17 6 V18 Q17 26 10 26" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="1" />
      </svg>
      <Shirt {...props} />
    </div>
  );
}

/** Map a crest division to a shirt pattern so a club's kit and crest feel related. */
export function patternFor(division: number): ShirtProps['pattern'] {
  return division === 1 ? 'stripes' : division === 6 ? 'hoops' : division === 5 ? 'sash' : 'plain';
}
