import { useState, useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { theme } from '../lib/theme';

export interface EditableTextHandle {
  startEdit: () => void;
}

interface EditableTextProps {
  value: string;
  onCommit: (newValue: string) => void;
  placeholder?: string;
  className?: string;
  title?: string;
}

export const EditableText = forwardRef<EditableTextHandle, EditableTextProps>(
  function EditableText({ value, onCommit, placeholder, className, title }, ref) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    const startEdit = useCallback(() => {
      setDraft(value);
      setEditing(true);
    }, [value]);

    useImperativeHandle(ref, () => ({ startEdit }), [startEdit]);

    useEffect(() => {
      if (editing) {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }, [editing]);

    function commit() {
      const val = draft.trim();
      setEditing(false);
      if (val && val !== value) {
        onCommit(val);
      }
    }

    function cancel() {
      setEditing(false);
    }

    if (editing) {
      return (
        <input
          ref={inputRef}
          className="editable-text-input"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={commit}
          style={{
            background: theme.bgInput,
            border: `1px solid ${theme.borderFocus}`,
            borderRadius: '4px',
            padding: '2px 6px',
            color: theme.fg,
            fontSize: 'inherit',
            fontFamily: 'inherit',
            fontWeight: 'inherit',
            outline: 'none',
            width: '100%',
            minWidth: 0,
          }}
        />
      );
    }

    return (
      <span
        className={className}
        title={title}
        onDoubleClick={startEdit}
        style={{
          cursor: 'default',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {value || placeholder}
      </span>
    );
  },
);
