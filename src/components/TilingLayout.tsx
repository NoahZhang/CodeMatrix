import React, { useMemo, useEffect, useRef, useState } from 'react';
import { useStore, getStore, pickAndAddProject, closeTerminal, toggleNewTaskDialog } from '../store/store';
import { closeTask } from '../store/store';
import { ResizablePanel, type PanelChild, type ResizablePanelHandle } from './ResizablePanel';
import { TaskPanel } from './TaskPanel';
import { TerminalPanel } from './TerminalPanel';
import { NewTaskPlaceholder } from './NewTaskPlaceholder';
import { theme } from '../lib/theme';
import { mod } from '../lib/platform';
import { createCtrlShiftWheelResizeHandler } from '../lib/wheelZoom';

// Simple React ErrorBoundary wrapper
class PanelErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: (error: Error, reset: () => void) => React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode; fallback: (error: Error, reset: () => void) => React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset);
    }
    return this.props.children;
  }
}

export function TilingLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelHandleRef = useRef<ResizablePanelHandle | undefined>(undefined);

  const taskOrder = useStore((s) => s.taskOrder);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const collapsedTaskOrder = useStore((s) => s.collapsedTaskOrder);
  const projects = useStore((s) => s.projects);

  // Wheel zoom handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handleWheel = createCtrlShiftWheelResizeHandler((deltaPx) => {
      panelHandleRef.current?.resizeAll(deltaPx);
    });
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Scroll the active task panel into view when selection changes
  useEffect(() => {
    if (!activeTaskId || !containerRef.current) return;
    const el = containerRef.current.querySelector<HTMLElement>(
      `[data-task-id="${CSS.escape(activeTaskId)}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior });
  }, [activeTaskId]);

  // Cache PanelChild objects by ID so we maintain stable references
  const panelCacheRef = useRef(new Map<string, PanelChild>());

  const panelChildren = useMemo((): PanelChild[] => {
    const panelCache = panelCacheRef.current;
    const currentIds = new Set<string>(taskOrder);
    currentIds.add('__placeholder');

    // Remove stale entries for deleted tasks
    for (const key of panelCache.keys()) {
      if (!currentIds.has(key)) panelCache.delete(key);
    }

    const panels: PanelChild[] = taskOrder.map((panelId) => {
      let cached = panelCache.get(panelId);
      if (!cached) {
        cached = {
          id: panelId,
          initialSize: 520,
          minSize: 300,
          content: <TilingPanelContent panelId={panelId} />,
        };
        panelCache.set(panelId, cached);
      }
      return cached;
    });

    let placeholder = panelCache.get('__placeholder');
    if (!placeholder) {
      placeholder = {
        id: '__placeholder',
        initialSize: 54,
        fixed: true,
        content: <NewTaskPlaceholder />,
      };
      panelCache.set('__placeholder', placeholder);
    }
    panels.push(placeholder);

    return panels;
  }, [taskOrder]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: '1',
        overflowX: 'auto',
        overflowY: 'hidden',
        height: '100%',
        padding: '2px 4px',
      }}
    >
      {taskOrder.length > 0 ? (
        <ResizablePanel
          direction="horizontal"
          children={panelChildren}
          fitContent
          persistKey="tiling"
          onHandle={(h) => {
            panelHandleRef.current = h;
          }}
        />
      ) : (
        <div
          className="empty-state"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {collapsedTaskOrder.length === 0 ? (
            projects.length > 0 ? (
              <>
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '16px',
                    background: theme.islandBg,
                    border: `1px solid ${theme.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    color: theme.fgSubtle,
                  }}
                >
                  +
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      fontSize: '15px',
                      color: theme.fgMuted,
                      fontWeight: '500',
                      marginBottom: '6px',
                    }}
                  >
                    No tasks yet
                  </div>
                  <div style={{ fontSize: '12px', color: theme.fgSubtle, marginBottom: '12px' }}>
                    Create a task to start an AI coding agent
                  </div>
                </div>
                <button
                  onClick={() => toggleNewTaskDialog(true)}
                  style={{
                    background: theme.accent,
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px 24px',
                    color: theme.accentText,
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span style={{ fontSize: '16px' }}>+</span>
                  New Task
                </button>
                <div style={{ fontSize: '11px', color: theme.fgSubtle }}>
                  or press{' '}
                  <kbd
                    style={{
                      background: theme.bgElevated,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: '10px',
                    }}
                  >
                    {mod}+N
                  </kbd>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '16px',
                    background: theme.islandBg,
                    border: `1px solid ${theme.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: theme.fgSubtle,
                  }}
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.22.78 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
                  </svg>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      fontSize: '15px',
                      color: theme.fgMuted,
                      fontWeight: '500',
                      marginBottom: '6px',
                    }}
                  >
                    Link your first project to get started
                  </div>
                  <div style={{ fontSize: '12px', color: theme.fgSubtle }}>
                    A project is a local folder with your code
                  </div>
                </div>
                <button
                  onClick={() => pickAndAddProject()}
                  style={{
                    background: theme.bgElevated,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '8px',
                    padding: '8px 20px',
                    color: theme.fg,
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.22.78 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Z" />
                  </svg>
                  Link Project
                </button>
              </>
            )
          ) : (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: '15px',
                  color: theme.fgMuted,
                  fontWeight: '500',
                  marginBottom: '6px',
                }}
              >
                All tasks are collapsed
              </div>
              <div style={{ fontSize: '12px', color: theme.fgSubtle }}>
                Click a task in the sidebar to restore it
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Extracted panel content component to use hooks inside the render function
function TilingPanelContent({ panelId }: { panelId: string }) {
  const task = useStore((s) => s.tasks[panelId]);
  const terminal = useStore((s) => s.terminals[panelId]);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const [appeared, setAppeared] = useState(false);

  if (!task && !terminal) return <div />;

  const isRemoving = task?.closingStatus === 'removing' || terminal?.closingStatus === 'removing';

  return (
    <div
      data-task-id={panelId}
      className={isRemoving ? 'task-removing' : appeared ? '' : 'task-appearing'}
      style={{ height: '100%', padding: '6px 3px' }}
      onAnimationEnd={(e) => {
        if ((e as React.AnimationEvent).animationName === 'taskAppear')
          setAppeared(true);
      }}
    >
      <PanelErrorBoundary
        fallback={(err, reset) => (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              padding: '24px',
              background: theme.islandBg,
              borderRadius: '12px',
              border: `1px solid ${theme.border}`,
              color: theme.fgMuted,
              fontSize: '13px',
            }}
          >
            <div style={{ color: theme.error, fontWeight: '600' }}>Panel crashed</div>
            <div
              style={{
                textAlign: 'center',
                wordBreak: 'break-word',
                maxWidth: '300px',
              }}
            >
              {String(err)}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={reset}
                style={{
                  background: theme.bgElevated,
                  border: `1px solid ${theme.border}`,
                  color: theme.fg,
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
              <button
                onClick={() => {
                  const currentStore = getStore();
                  const currentTask = currentStore.tasks[panelId];
                  if (currentTask) {
                    const msg = currentTask.directMode
                      ? 'Close this task? Running agents and shells will be stopped.'
                      : 'Close this task? The worktree and branch will be deleted.';
                    if (window.confirm(msg)) closeTask(panelId);
                  } else if (currentStore.terminals[panelId]) {
                    closeTerminal(panelId);
                  }
                }}
                style={{
                  background: theme.bgElevated,
                  border: `1px solid ${theme.border}`,
                  color: theme.error,
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                {task ? 'Close Task' : 'Close Terminal'}
              </button>
            </div>
          </div>
        )}
      >
        {task ? (
          <TaskPanel task={task} isActive={activeTaskId === panelId} />
        ) : terminal ? (
          <TerminalPanel terminal={terminal} isActive={activeTaskId === panelId} />
        ) : null}
      </PanelErrorBoundary>
    </div>
  );
}
