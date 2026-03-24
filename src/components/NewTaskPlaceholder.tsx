import { useEffect, useRef } from 'react';
import { toggleNewTaskDialog, createTerminal, unfocusPlaceholder } from '../store/store';
import { useStore } from '../store/store';
import { registerFocusFn, unregisterFocusFn } from '../store/store';
import { theme } from '../lib/theme';
import { mod } from '../lib/platform';

export function NewTaskPlaceholder() {
  const addTaskRef = useRef<HTMLDivElement>(null);
  const addTerminalRef = useRef<HTMLDivElement>(null);

  const placeholderFocused = useStore((s) => s.placeholderFocused);
  const placeholderFocusedButton = useStore((s) => s.placeholderFocusedButton);

  useEffect(() => {
    registerFocusFn('placeholder:add-task', () => addTaskRef.current?.focus());
    registerFocusFn('placeholder:add-terminal', () => addTerminalRef.current?.focus());
    return () => {
      unregisterFocusFn('placeholder:add-task');
      unregisterFocusFn('placeholder:add-terminal');
    };
  }, []);

  const isFocused = (btn: 'add-task' | 'add-terminal') =>
    placeholderFocused && placeholderFocusedButton === btn;

  const focusedBorder = (btn: 'add-task' | 'add-terminal') =>
    isFocused(btn) ? `2px dashed ${theme.accent}` : `2px dashed ${theme.border}`;

  const focusedColor = (btn: 'add-task' | 'add-terminal') =>
    isFocused(btn) ? theme.accent : theme.fgSubtle;

  const focusedBg = (btn: 'add-task' | 'add-terminal') =>
    isFocused(btn) ? `color-mix(in srgb, ${theme.accent} 8%, transparent)` : undefined;

  return (
    <div
      style={{
        width: '48px',
        minWidth: '48px',
        height: 'calc(100% - 12px)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        margin: '6px 3px',
        flexShrink: '0',
      }}
    >
      {/* Add task button — fills remaining space */}
      <div
        ref={addTaskRef}
        className="new-task-placeholder"
        role="button"
        tabIndex={0}
        aria-label="New task"
        onClick={() => toggleNewTaskDialog(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleNewTaskDialog(true);
          }
        }}
        style={{
          flex: '1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          borderRadius: '12px',
          border: focusedBorder('add-task'),
          color: focusedColor('add-task'),
          background: focusedBg('add-task'),
          fontSize: '20px',
          userSelect: 'none',
        }}
        title={`New task (${mod}+N)`}
      >
        +
      </div>

      {/* Terminal button — same width, fixed height */}
      <div
        ref={addTerminalRef}
        className="new-task-placeholder"
        role="button"
        tabIndex={0}
        aria-label="New terminal"
        onClick={() => createTerminal()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            unfocusPlaceholder();
            createTerminal();
          }
        }}
        style={{
          height: '44px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          borderRadius: '10px',
          border: focusedBorder('add-terminal'),
          color: focusedColor('add-terminal'),
          background: focusedBg('add-terminal'),
          fontSize: '13px',
          fontFamily: 'monospace',
          userSelect: 'none',
          flexShrink: '0',
        }}
        title={`New terminal (${mod}+Shift+D)`}
      >
        &gt;_
      </div>
    </div>
  );
}
