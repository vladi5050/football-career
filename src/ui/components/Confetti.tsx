import { useMemo } from 'preact/hooks';
import { reducedMotion } from '../../app/store';

const COLORS = ['#F28C28', '#F7F7F2', '#D7263D', '#1E4FD8', '#F2C230', '#2F9E57'];
/** CSS confetti burst for goals. Renders nothing under reduced motion. */
export function Confetti({ count = 42, seed = 1 }: { count?: number; seed?: number }) {
  const bits = useMemo(() => {
    let s = seed * 9301 + 49297;
    const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: count }, (_, i) => ({
      x: `${r() * 100}%`, dx: `${(r() - 0.5) * 160}px`, r: `${Math.floor(r() * 360)}deg`,
      d: `${1.4 + r() * 1.4}s`, delay: `${r() * 0.35}s`, c: COLORS[i % COLORS.length]!,
    }));
  }, [count, seed]);
  if (reducedMotion.value) return null;
  return (
    <div class="confetti" aria-hidden="true">
      {bits.map((b, i) => (
        <i key={i} style={{ '--x': b.x, '--dx': b.dx, '--r': b.r, '--d': b.d, '--delay': b.delay, '--c': b.c }} />
      ))}
    </div>
  );
}
