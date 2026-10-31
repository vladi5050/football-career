// Small stroke icons (24x24). Hand-drawn feel via round caps.
import type { SVGAttributes } from 'preact';

type P = { size?: number } & SVGAttributes<SVGSVGElement>;
const base = (size = 24) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  'stroke-width': 2.2, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const, 'aria-hidden': true,
});

export const IconWeek = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M7 13h3M14 13h3M7 17h3" /></svg>
);
export const IconTable = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="4" cy="6" r="0.6" /><path d="M8 4v16" /></svg>
);
export const IconClub = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 11l2 2 4-4" /></svg>
);
export const IconAgent = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /><path d="M12 15l-1.5 3 1.5 3 1.5-3z" /></svg>
);
export const IconMore = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>
);
export const IconBolt = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke-width="1.6" /></svg>
);
export const IconBack = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M9 6l6 6-6 6" /></svg>
);
export const IconChev = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M15 6l-6 6 6 6" /></svg>
);
export const IconBall = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7l4 3-1.5 4.5h-5L8 10z" /></svg>
);
export const IconRain = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M7 15a4 4 0 010-8 5 5 0 019.6 1.5A3.5 3.5 0 0117 15z" /><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2" /></svg>
);
export const IconFire = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z" /></svg>
);
export const IconCrowd = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="7" cy="9" r="2.5" /><circle cx="17" cy="9" r="2.5" /><circle cx="12" cy="7" r="2.5" /><path d="M3 19c.5-3 2-5 4-5M21 19c-.5-3-2-5-4-5M7 20c.5-4 2.5-6 5-6s4.5 2 5 6" /></svg>
);
export const IconShare = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5" /></svg>
);
export const IconDownload = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
);
export const IconUpload = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>
);
export const IconLock = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></svg>
);
export const IconCheck = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12l5 5 9-10" /></svg>
);
export const IconPlay = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>
);
export const IconFF = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M13 6l-8 6 8 6zM21 6l-8 6 8 6z" fill="currentColor" stroke-width="1.4" /></svg>
);
export const IconWhistle = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="9" cy="14" r="5" /><path d="M12 10l9-4v5l-6 2M3 6l2 2M8 3v3" /></svg>
);
export const IconNews = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="3" y="4" width="15" height="16" rx="1.5" /><path d="M18 8h3v10a2 2 0 01-2 2M7 8h7M7 12h7M7 16h4" /></svg>
);
export const IconTarget = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></svg>
);
export const IconGear = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
);
export const IconPen = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></svg>
);
export const IconHome = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 11l9-7 9 7M5 10v10h14V10" /></svg>
);
export const IconFlag = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 21V4M5 4h12l-2 4 2 4H5" /></svg>
);
export const IconDice = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="15" cy="9" r="1.2" fill="currentColor" /><circle cx="9" cy="15" r="1.2" fill="currentColor" /></svg>
);

/** Glyphs used on plan magnets. */
export function SlotGlyph({ glyph }: { glyph: string }) {
  switch (glyph) {
    case 'zz':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h7l-7 9h7M14 4h5l-5 6h5" /></svg>;
    case 'team':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M3 20c.6-3.5 2.6-5 5-5s4.4 1.5 5 5M11 20c.6-3.5 2.6-5 5-5s4.4 1.5 5 5" /></svg>;
    case 'talk':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16v10H10l-5 4v-4H4z" /></svg>;
    case 'gym':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7v10M17 7v10M4 9v6M20 9v6M7 12h10" /></svg>;
    case 'mic':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></svg>;
    case 'home':
      return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7M6 10v10h12V10" /><path d="M12 14.5c-1.5-1.6-3.5 0-2 1.6L12 18l2-1.9c1.5-1.6-.5-3.2-2-1.6z" /></svg>;
    default:
      return <span>{glyph}</span>;
  }
}
