import { useEffect, useRef, type ReactNode } from 'react';
import { Dialog } from './Dialog';
import { theme } from '../lib/theme';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmLoading?: boolean;
  danger?: boolean;
  confirmDisabled?: boolean;
  autoFocusCancel?: boolean;
  width?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Auto-focus the cancel button (or let Dialog's panel get focus)
  useEffect(() => {
    if (!props.open) return;
    const focusCancelBtn = props.autoFocusCancel ?? true;

    // Blur whatever is focused outside the dialog (e.g. the button that
    // triggered this dialog) so our programmatic focus call sticks.
    (document.activeElement as HTMLElement)?.blur?.();

    // Focus the cancel button after the Dialog panel renders.
    requestAnimationFrame(() => {
      if (focusCancelBtn) cancelRef.current?.focus();
    });
  }, [props.open, props.autoFocusCancel]);

  return (
    <Dialog open={props.open} onClose={props.onCancel} width={props.width}>
      <h2
        style={{
          margin: '0',
          fontSize: '16px',
          color: theme.fg,
          fontWeight: '600',
        }}
      >
        {props.title}
      </h2>

      <div style={{ fontSize: '13px', color: theme.fgMuted, lineHeight: '1.5' }}>
        {props.message}
      </div>

      <div
        style={{
          display: 'flex',
          gap: '8px',
          justifyContent: 'flex-end',
          paddingTop: '4px',
        }}
      >
        <button
          ref={cancelRef}
          type="button"
          className="btn-secondary"
          onClick={() => props.onCancel()}
          style={{
            padding: '9px 18px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            color: theme.fgMuted,
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          {props.cancelLabel ?? 'Cancel'}
        </button>
        <button
          type="button"
          className={props.danger ? 'btn-danger' : 'btn-primary'}
          disabled={props.confirmDisabled}
          onClick={() => props.onConfirm()}
          style={{
            padding: '9px 20px',
            background: props.danger ? theme.error : theme.accent,
            border: 'none',
            borderRadius: '8px',
            color: props.danger ? '#fff' : theme.accentText,
            cursor: props.confirmDisabled ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: '500',
            opacity: props.confirmDisabled ? '0.5' : '1',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {props.confirmLoading && (
            <span className="inline-spinner" aria-hidden="true" />
          )}
          {props.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </Dialog>
  );
}
