import { useEffect } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab / Shift+Tab focus cycling within a container element
 * while `open` is true.
 */
export function useFocusTrap(
  open: boolean,
  getPanel: () => HTMLElement | undefined | null,
): void {
  useEffect(() => {
    if (!open) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const el = getPanel();
      if (!el) return;
      e.preventDefault();
      const els = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (els.length === 0) return;
      const idx = els.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? els[(idx <= 0 ? els.length : idx) - 1]
        : els[(idx + 1) % els.length];
      next.focus();
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, getPanel]);
}
