import type { ComponentChildren } from 'preact';

/** Whiteboard with aluminium frame and a marker tray underneath. */
export function Whiteboard({ children, class: cls, tray = true, title }: { children: ComponentChildren; class?: string; tray?: boolean; title?: ComponentChildren }) {
  return (
    <div class={`board-wrap ${cls ?? ''}`}>
      <div class="board">
        {title && <div class="board-title">{title}</div>}
        {children}
      </div>
      {tray && (
        <div class="board-tray" aria-hidden="true">
          <span class="marker m-red" />
          <span class="marker m-blue" />
        </div>
      )}
    </div>
  );
}
