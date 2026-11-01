// Marker-style line icons for the option cards (24x24, currentColor).
import type { IconKey } from './types';

const s = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS: Record<IconKey | 'eye' | 'mic', string> = {
  shot: s('<circle cx="16" cy="12" r="4.5"/><path d="M2.5 8.5h6M2 12h7M2.5 15.5h6"/>'),
  curl: s('<path d="M4 19c1.5-8.5 8.5-13.5 15-11"/><path d="M15.5 5.2l3.8 2.9-3.2 3.5"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/>'),
  chip: s('<path d="M3 19.5c3-11 15-11 18 0"/><circle cx="12" cy="7.3" r="2.6"/><path d="M8 19.5h8"/>'),
  pass: s('<circle cx="4.5" cy="12" r="2"/><path d="M8 12h11"/><path d="M15 7.5l4.5 4.5-4.5 4.5"/>'),
  cross: s('<path d="M3.5 20C6 9 13.5 5 20 7.5"/><path d="M16.5 4.5l3.7 3-3.3 3.4"/><path d="M14 20h6"/>'),
  dribble: s('<path d="M3 18l4-5.5 4 4 4-6.5 4 3.5"/><circle cx="20" cy="13.5" r="1.6" fill="currentColor"/>'),
  shield: s('<path d="M12 3l7 2.8v5.7c0 4.3-3 7.6-7 9.5-4-1.9-7-5.2-7-9.5V5.8z"/><path d="M9 12l2.2 2.2L15.5 10"/>'),
  head: s('<circle cx="9" cy="14" r="5.5"/><circle cx="18" cy="5.5" r="3"/><path d="M13.5 10l2.3-2.3"/>'),
  tackle: s('<path d="M3 17.5h9.5l5-5.5"/><path d="M3 14h6"/><circle cx="18.5" cy="17.5" r="2.8"/>'),
  jockey: s('<path d="M12 3.5v14"/><path d="M7 13l5 5 5-5"/><path d="M5 21h14"/>'),
  cover: s('<circle cx="12" cy="12" r="8.5"/><path d="M6 18L18 6"/>'),
  glove: s('<path d="M7.5 21v-3.5c-1.6-1.2-2.8-3-2.8-5.2V9.5a1.4 1.4 0 012.8 0V12"/><path d="M7.5 11V5a1.5 1.5 0 013 0v6"/><path d="M10.5 10.5V3.8a1.5 1.5 0 013 0v6.7"/><path d="M13.5 10.5V5a1.5 1.5 0 013 0v7.5c0 4-1.8 6.5-4 7.6V21"/>'),
  clear: s('<path d="M12 21V5"/><path d="M6 10.5L12 4.5l6 6"/><path d="M4 21h16"/>'),
  run: s('<path d="M3 12h13"/><path d="M12.5 7l5.5 5-5.5 5"/><path d="M3 7h5M3 17h5"/>'),
  wait: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  throw: s('<circle cx="12" cy="5" r="2.6"/><path d="M8 13l4-5 4 5"/><path d="M12 8v13"/><path d="M8 21h8"/>'),
  flag: s('<path d="M6 21V3"/><path d="M6 4h11l-2.5 4L17 12H6"/>'),
  foul: s('<rect x="7" y="3.5" width="10" height="14" rx="1.5"/><path d="M10 21h4"/><path d="M12 7.5v5"/><circle cx="12" cy="15" r=".6" fill="currentColor"/>'),
  turn: s('<path d="M7 20V9a5 5 0 0110 0v3"/><path d="M13.5 9.5L17 13l3.5-3.5"/><circle cx="7" cy="20" r="1.6" fill="currentColor"/>'),
  switch: s('<path d="M3 16c4-9 14-9 18 0"/><path d="M17.5 12.5L21 16l-4.3 1.6"/><circle cx="3" cy="16" r="1.6" fill="currentColor"/>'),
  eye: s('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  mic: s('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21M8.5 21h7"/>'),
};
