import { useEffect, useRef } from 'react';

/**
 * Saves the currently focused element when `open` becomes true,
 * and restores focus to it when `open` becomes false or the
 * component unmounts.
 */
export function useFocusRestore(open: boolean): void {
  const savedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function restore(): void {
      if (!savedRef.current) return;
      const el = savedRef.current;
      savedRef.current = null;
      requestAnimationFrame(() => {
        const current = document.activeElement;
        if (current && current !== document.body) return;
        if (el.isConnected) el.focus();
      });
    }

    if (open) {
      savedRef.current = document.activeElement as HTMLElement | null;
    } else {
      restore();
    }

    return restore;
  }, [open]);
}
