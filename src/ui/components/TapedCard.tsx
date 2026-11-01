import type { ComponentChildren, CSSProperties } from 'preact';

interface Props {
  children: ComponentChildren;
  tilt?: 'l' | 'r' | 'none';
  tape?: 'right' | 'left' | 'center' | 'both' | 'none';
  dashed?: boolean;
  class?: string;
  style?: CSSProperties;
}
/** Paper card taped to the locker wall, with an optional dashed inner outline. */
export function TapedCard({ children, tilt = 'none', tape = 'right', dashed = true, class: cls, style }: Props) {
  return (
    <div class={`paper ${dashed ? 'dashed' : ''} ${tilt !== 'none' ? `tilt-${tilt}` : ''} ${cls ?? ''}`} style={style}>
      {(tape === 'right' || tape === 'both') && <span class="tape t-right" aria-hidden="true" />}
      {(tape === 'left' || tape === 'both') && <span class="tape t-left" aria-hidden="true" />}
      {tape === 'center' && <span class="tape t-center" aria-hidden="true" />}
      {children}
    </div>
  );
}
