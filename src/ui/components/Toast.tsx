import { toasts } from '../../app/store';

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class="toast">{t.text}</div>
      ))}
    </div>
  );
}
