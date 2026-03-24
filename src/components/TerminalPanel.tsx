import { useEffect, useRef, useCallback } from 'react';
import {
  useStore,
  closeTerminal,
  updateTerminalName,
  setActiveTask,
  reorderTask,
  getFontScale,
  registerFocusFn,
  unregisterFocusFn,
  triggerFocus,
  setTaskFocusedPanel,
} from '../store/store';
import { EditableText, type EditableTextHandle } from './EditableText';
import { IconButton } from './IconButton';
import { TerminalView } from './TerminalView';
import { ScalablePanel } from './ScalablePanel';
import { theme } from '../lib/theme';
import { handleDragReorder } from '../lib/dragReorder';
import type { Terminal } from '../store/types';

interface TerminalPanelProps {
  terminal: Terminal;
  isActive: boolean;
}

export function TerminalPanel({ terminal, isActive }: TerminalPanelProps) {
  const titleEditHandleRef = useRef<EditableTextHandle | null>(null);
  const focusedPanel = useStore((s) => s.focusedPanel[terminal.id] ?? 'terminal');

  // Register focus handlers
  useEffect(() => {
    const id = terminal.id;
    registerFocusFn(`${id}:title`, () => titleEditHandleRef.current?.startEdit());

    return () => {
      unregisterFocusFn(`${id}:title`);
      unregisterFocusFn(`${id}:terminal`);
    };
  }, [terminal.id]);

  // Respond to focus panel changes
  useEffect(() => {
    if (!isActive) return;
    triggerFocus(`${terminal.id}:${focusedPanel}`);
  }, [isActive, terminal.id, focusedPanel]);

  const handleTitleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleDragReorder(e.nativeEvent, {
        itemId: terminal.id,
        getTaskOrder: () => useStore.getState().taskOrder,
        onReorder: reorderTask,
        onTap: () => setActiveTask(terminal.id),
      });
    },
    [terminal.id],
  );

  const fontScale = getFontScale(`${terminal.id}:terminal`);

  return (
    <div
      className={`task-column ${isActive ? 'active' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: theme.taskContainerBg,
        borderRadius: 0,
        border: `1px solid ${theme.border}`,
        overflow: 'clip',
        position: 'relative',
      }}
      onClick={() => setActiveTask(terminal.id)}
    >
      {/* Title bar */}
      <div
        className={isActive ? 'island-header-active' : ''}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          height: '36px',
          minHeight: '36px',
          background: 'transparent',
          borderBottom: `1px solid ${theme.border}`,
          userSelect: 'none',
          cursor: 'grab',
          flexShrink: 0,
        }}
        onMouseDown={handleTitleMouseDown}
      >
        <div
          style={{
            overflow: 'hidden',
            flex: 1,
            minWidth: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '13px',
              color: theme.fgMuted,
              flexShrink: 0,
            }}
          >
            &gt;_
          </span>
          <EditableText
            value={terminal.name}
            onCommit={(v) => updateTerminalName(terminal.id, v)}
            className="editable-text"
            ref={(h) => {
              titleEditHandleRef.current = h;
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: '4px', marginLeft: '8px', flexShrink: 0 }}>
          <IconButton
            icon={
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            }
            onClick={() => closeTerminal(terminal.id)}
            title="Close terminal"
          />
        </div>
      </div>

      {/* Terminal */}
      <ScalablePanel panelId={`${terminal.id}:terminal`}>
        <div
          className="focusable-panel"
          style={{ height: '100%', position: 'relative' }}
          onClick={() => setTaskFocusedPanel(terminal.id, 'terminal')}
        >
          <TerminalView
            taskId={terminal.id}
            agentId={terminal.agentId}
            isShell
            isFocused={isActive && focusedPanel === 'terminal'}
            command=""
            args={['-l']}
            cwd=""
            onReady={(focusFn) => registerFocusFn(`${terminal.id}:terminal`, focusFn)}
            fontSize={Math.round(13 * fontScale)}
            autoFocus
          />
        </div>
      </ScalablePanel>
    </div>
  );
}
