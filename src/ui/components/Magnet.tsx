import type { ComponentChildren } from 'preact';

export type MagnetColor = 'red' | 'blue' | 'yellow' | 'green' | 'orange' | 'ink';
interface Props {
  color?: MagnetColor;
  size?: number;
  lifted?: boolean;
  snap?: boolean;
  children?: ComponentChildren;
  class?: string;
  title?: string;
}
/** Glossy round whiteboard magnet. Purely visual; wrap in a <button> for interaction. */
export function Magnet({ color = 'blue', size = 48, lifted, snap, children, class: cls, title }: Props) {
  return (
    <span
      class={`magnet ${color} ${lifted ? 'lifted' : ''} ${snap ? 'snap' : ''} ${cls ?? ''}`}
      style={{ '--size': `${size}px` }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {children}
    </span>
  );
}
