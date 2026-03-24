import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusRestore } from '../lib/focus-restore';
import { useFocusTrap } from '../lib/focus-trap';
import { theme } from '../lib/theme';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  width?: string;
  zIndex?: number;
  panelStyle?: React.CSSProperties;
  children: ReactNode;
}

export function Dialog(props: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusRestore(props.open);
  useFocusTrap(props.open, () => panelRef.current);

  // Escape key → close
  useEffect(() => {
    if (!props.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [props.open, props.onClose]);

  // Scroll the panel with arrow/page keys, but ONLY when the panel itself
  // is focused — not when events bubble from interactive children like
  // <select>, <input>, etc.  We use a native listener so we can check
  // e.target reliably.
  useEffect(() => {
    if (!props.open) return;
    const el = panelRef.current;
    if (!el) return;

    const step = 40;
    const page = 200;
    const handler = (e: KeyboardEvent) => {
      if (e.target !== el) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        el.scrollTop += step;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        el.scrollTop -= step;
      } else if (e.key === 'PageDown') {
        e.preventDefault();
        el.scrollTop += page;
      } else if (e.key === 'PageUp') {
        e.preventDefault();
        el.scrollTop -= page;
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [props.open]);

  return createPortal(
    <>
      {props.open && (
        <div
          className="dialog-overlay"
          style={{
            position: 'fixed',
            inset: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            zIndex: props.zIndex ?? 1000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onClose();
          }}
        >
          <div
            ref={panelRef}
            tabIndex={0}
            className="dialog-panel"
            style={{
              background: theme.islandBg,
              border: `1px solid ${theme.border}`,
              borderRadius: '14px',
              padding: '28px',
              width: props.width ?? '400px',
              maxHeight: '80vh',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              outline: 'none',
              boxShadow: '0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset',
              ...props.panelStyle,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {props.children}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
