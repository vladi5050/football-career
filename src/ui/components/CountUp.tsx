import { useEffect, useRef, useState } from 'preact/hooks';
import { reducedMotion } from '../../app/store';

interface Props { from?: number; to: number; duration?: number; decimals?: number; delay?: number; pop?: boolean; format?: (n: number) => string }
/** Animated number. Instant when reduced motion is on. */
export function CountUp({ from = 0, to, duration = 900, decimals = 0, delay = 0, pop = true, format }: Props) {
  const [val, setVal] = useState(reducedMotion.value ? to : from);
  const [done, setDone] = useState(reducedMotion.value);
  const raf = useRef(0);
  useEffect(() => {
    if (reducedMotion.value) {
      setVal(to);
      setDone(true);
      return;
    }
    let start = 0;
    const t0 = setTimeout(() => {
      const step = (t: number) => {
        if (!start) start = t;
        const p = Math.min(1, (t - start) / duration);
        const e = 1 - Math.pow(1 - p, 3);
        setVal(from + (to - from) * e);
        if (p < 1) raf.current = requestAnimationFrame(step);
        else setDone(true);
      };
      raf.current = requestAnimationFrame(step);
    }, delay);
    return () => {
      clearTimeout(t0);
      cancelAnimationFrame(raf.current);
    };
  }, [from, to, duration, delay]);
  const f = 10 ** decimals;
  const shown = Math.floor(val * f + 1e-6) / f;
  const text = format ? format(shown) : shown.toFixed(decimals);
  return <span class={`num ${done && pop && to !== from ? 'count-pop' : ''}`}>{text}</span>;
}
