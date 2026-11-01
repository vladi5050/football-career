import { dismissToast, screen, toasts } from '../../app/store';

/** Compact banner under the top bar / scorebug. Tap to dismiss; auto-dismiss after 3.5 s. */
export function Toasts() {
  return (
    <div class={`toasts ${screen.value === 'table' || screen.value === 'more' ? 'toasts-low' : ''}`} role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <button key={t.id} type="button" class="toast" onClick={() => dismissToast(t.id)} aria-label={`${t.text}. הקש לסגירה`}>
          {t.text}
        </button>
      ))}
    </div>
  );
}
