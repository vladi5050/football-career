// Minimal DOM key moment used only when the Pixi match module is not available.
// A needle sweeps a bar; the green zone grows with skill and shrinks with difficulty. Tap to act.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MomentResult, MomentSpec } from '../../core/types';
import { reducedMotion } from '../../app/store';

const VERB: Partial<Record<MomentSpec['kind'], string>> = {
  shot: 'בעט!', one_on_one: 'בעט!', header: 'נגח!', long_shot: 'בעט!', penalty: 'בעט!', free_kick: 'בעט!',
  dribble: 'עקוף!', through_ball: 'מסור!', cross: 'הגבה!', tackle: 'תקל!', interception: 'חטוף!', block: 'חסום!',
  clearance: 'הרחק!', save: 'זנק!', rush_out: 'צא!',
};

export function FallbackMoment({ spec, onDone }: { spec: MomentSpec; onDone: (r: MomentResult) => void }) {
  const zone = Math.max(10, Math.min(42, spec.attackerSkill * 0.55 - spec.difficulty * 22));
  const center = 50;
  const [pos, setPos] = useState(0);
  const [result, setResult] = useState<MomentResult | null>(null);
  const t0 = useRef(performance.now());
  const posRef = useRef(0);
  const doneRef = useRef(false);
  const raf = useRef(0);
  const speed = reducedMotion.value ? 0.045 : 0.09 + spec.difficulty * 0.06;

  useEffect(() => {
    const step = (t: number) => {
      const e = (t - t0.current) * speed;
      posRef.current = 50 + 50 * Math.sin(e / 18);
      setPos(posRef.current);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    const timeout = setTimeout(() => hit(), 6000);
    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(timeout);
    };
  }, []);

  function hit() {
    if (doneRef.current) return;
    doneRef.current = true;
    cancelAnimationFrame(raf.current);
    const d = Math.abs(posRef.current - center);
    const success = d <= zone / 2;
    const quality = Math.max(0, 1 - d / 50);
    const r: MomentResult = { momentId: spec.id, success, quality, skipped: false };
    setResult(r);
    setTimeout(() => onDone(r), 900);
  }

  return (
    <div class="fb-moment" onPointerDown={hit} role="button" aria-label={VERB[spec.kind] ?? 'עכשיו!'}>
      <div class="fb-title">{spec.stakes}</div>
      <div class="fb-bar">
        <span class="fb-zone" style={{ width: `${zone}%`, right: `${center - zone / 2}%` }} />
        <span class="fb-needle" style={{ right: `${pos}%` }} />
      </div>
      <div class={`fb-verb display ${result ? (result.success ? 'ok' : 'miss') : ''}`}>
        {result ? (result.success ? 'יש!' : 'כמעט...') : VERB[spec.kind] ?? 'עכשיו!'}
      </div>
      <div class="fb-help">הקש כשהמחוג באזור הירוק</div>
    </div>
  );
}
