import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { TapedCard } from './TapedCard';
import { modalsOpen, toasts } from '../../app/store';

interface Props { open: boolean; title: string; onClose: () => void; children?: ComponentChildren; actions?: ComponentChildren }
/** Bottom sheet modal on a taped paper card. Esc / backdrop closes. */
export function Modal({ open, title, onClose, children, actions }: Props) {
  useEffect(() => {
    if (!open) return;
    // never stack a toast over a modal: clear what is showing and hold new ones while open
    modalsOpen.value++;
    toasts.value = [];
    return () => {
      modalsOpen.value--;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div class="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
        <TapedCard tape="center">
          <h2 class="paper-title">{title}</h2>
          <div style={{ marginTop: 8 }}>{children}</div>
          {actions && <div class="modal-actions">{actions}</div>}
        </TapedCard>
      </div>
    </div>,
    document.body,
  );
}
