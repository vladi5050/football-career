import { useEffect, useState } from 'preact/hooks';

/** Breakpoints shared with the CSS (responsive.css): phone < 700, tablet 700-1099, desktop >= 1100. */
export const MQ_TABLET = '(min-width: 700px)';
export const MQ_DESKTOP = '(min-width: 1100px)';

export function matches(q: string): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;
}

/** Live media-query match. */
export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => matches(q));
  useEffect(() => {
    const mql = window.matchMedia?.(q);
    if (!mql) return;
    const on = () => setM(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [q]);
  return m;
}
