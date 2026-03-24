import React, { useState, useEffect, useRef, useMemo } from 'react';
import { revealItemInDir, openInEditor } from '../lib/shell';
import {
  useStore,
  getStore,
  retryCloseTask,
  setActiveTask,
  markAgentExited,
  restartAgent,
  switchAgent,
  updateTaskName,
  updateTaskNotes,
  spawnShellForTask,
  runBookmarkInTask,
  closeShell,
  setLastPrompt,
  clearInitialPrompt,
  clearPrefillPrompt,
  getProject,
  reorderTask,
  getFontScale,
  getTaskDotStatus,
  markAgentOutput,
  registerFocusFn,
  unregisterFocusFn,
  setTaskFocusedPanel,
  triggerFocus,
  clearPendingAction,
  showNotification,
  collapseTask,
} from '../store/store';
import { ResizablePanel, type PanelChild } from './ResizablePanel';
import { EditableText, type EditableTextHandle } from './EditableText';
import { IconButton } from './IconButton';
import { InfoBar } from './InfoBar';
import { PromptInput, type PromptInputHandle } from './PromptInput';
import { ChangedFilesList } from './ChangedFilesList';
import { StatusDot } from './StatusDot';
import { TerminalView } from './TerminalView';
import { ScalablePanel } from './ScalablePanel';
import { Dialog } from './Dialog';
import { CloseTaskDialog } from './CloseTaskDialog';
import { MergeDialog } from './MergeDialog';
import { PushDialog } from './PushDialog';
import { DiffViewerDialog } from './DiffViewerDialog';
import { EditProjectDialog } from './EditProjectDialog';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { mod, isMac } from '../lib/platform';
import { extractLabel, consumePendingShellCommand } from '../lib/bookmarks';
import { handleDragReorder } from '../lib/dragReorder';
import { marked } from 'marked';
import type { Task } from '../store/types';
import type { ChangedFile } from '../ipc/types';

interface TaskPanelProps {
  task: Task;
  isActive: boolean;
}

export function TaskPanel({ task, isActive }: TaskPanelProps) {
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [notesTab, setNotesTab] = useState<'notes' | 'plan'>('notes');
  const [planFullscreen, setPlanFullscreen] = useState(false);

  const showPlans = useStore((s) => s.showPlans);
  const agents = useStore((s) => s.agents);
  const focusedPanel = useStore((s) => s.focusedPanel);
  const pendingAction = useStore((s) => s.pendingAction);
  const editorCommand = useStore((s) => s.editorCommand);

  // Auto-switch to plan tab when plan content first appears
  const hadPlanRef = useRef(false);
  useEffect(() => {
    const hasPlan = showPlans && !!task.planContent;
    if (hasPlan && !hadPlanRef.current) {
      setNotesTab('plan');
    } else if (!hasPlan && hadPlanRef.current) {
      setNotesTab('notes');
    }
    hadPlanRef.current = hasPlan;
  }, [showPlans, task.planContent]);

  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushing, setPushing] = useState(false);
  const pushSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => clearTimeout(pushSuccessTimerRef.current);
  }, []);
  const [diffFile, setDiffFile] = useState<ChangedFile | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [shellExits, setShellExits] = useState<
    Record<string, { exitCode: number | null; signal: string | null }>
  >({});
  const panelRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const changedFilesRef = useRef<HTMLDivElement>(null);
  const shellToolbarRef = useRef<HTMLDivElement>(null);
  const titleEditHandleRef = useRef<EditableTextHandle | undefined>(undefined);
  const promptHandleRef = useRef<PromptInputHandle | undefined>(undefined);
  const [shellToolbarIdx, setShellToolbarIdx] = useState(0);
  const [shellToolbarFocused, setShellToolbarFocused] = useState(false);

  const projectBookmarks = useMemo(
    () => getProject(task.projectId)?.terminalBookmarks ?? [],
    [task.projectId],
  );

  const editingProject = useMemo(() => {
    return editingProjectId ? (getProject(editingProjectId) ?? null) : null;
  }, [editingProjectId]);

  // Focus registration for this task's panels
  useEffect(() => {
    const id = task.id;
    registerFocusFn(`${id}:title`, () => titleEditHandleRef.current?.startEdit());
    registerFocusFn(`${id}:notes`, () => notesRef.current?.focus());
    registerFocusFn(`${id}:changed-files`, () => {
      changedFilesRef.current?.focus();
    });
    registerFocusFn(`${id}:prompt`, () => promptRef.current?.focus());
    registerFocusFn(`${id}:shell-toolbar`, () => shellToolbarRef.current?.focus());
    // Individual shell:N and ai-terminal focus fns are registered via TerminalView.onReady

    return () => {
      unregisterFocusFn(`${id}:title`);
      unregisterFocusFn(`${id}:notes`);
      unregisterFocusFn(`${id}:changed-files`);
      unregisterFocusFn(`${id}:shell-toolbar`);
      // Individual shell:N focus fns are cleaned up by their own cleanup
      unregisterFocusFn(`${id}:ai-terminal`);
      unregisterFocusFn(`${id}:prompt`);
    };
  }, [task.id]);

  // Respond to focus panel changes from store
  useEffect(() => {
    if (!isActive) return;
    const panel = focusedPanel[task.id];
    if (panel) {
      triggerFocus(`${task.id}:${panel}`);
    }
  }, [isActive, focusedPanel, task.id]);

  // Auto-focus prompt when task first becomes active (if no panel set yet)
  const autoFocusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (autoFocusTimerRef.current !== undefined) clearTimeout(autoFocusTimerRef.current);
    };
  }, []);
  useEffect(() => {
    if (isActive && !focusedPanel[task.id]) {
      const id = task.id;
      if (autoFocusTimerRef.current !== undefined) clearTimeout(autoFocusTimerRef.current);
      autoFocusTimerRef.current = setTimeout(() => {
        autoFocusTimerRef.current = undefined;
        // Only focus prompt if no panel was set in the meantime
        const currentFocusedPanel = getStore().focusedPanel;
        if (!currentFocusedPanel[id] && panelRef.current && !panelRef.current.contains(document.activeElement)) {
          promptRef.current?.focus();
        }
      }, 0);
    }
  }, [isActive, focusedPanel, task.id]);

  // React to pendingAction from keyboard shortcuts
  useEffect(() => {
    if (!pendingAction || pendingAction.taskId !== task.id) return;
    clearPendingAction();
    switch (pendingAction.type) {
      case 'close':
        setShowCloseConfirm(true);
        break;
      case 'merge':
        if (!task.directMode) openMergeConfirm();
        break;
      case 'push':
        if (!task.directMode) setShowPushConfirm(true);
        break;
    }
  }, [pendingAction, task.id, task.directMode]);

  function openMergeConfirm() {
    setShowMergeConfirm(true);
  }

  const firstAgent = useMemo(() => {
    const ids = task.agentIds;
    return ids.length > 0 ? agents[ids[0]] : undefined;
  }, [task.agentIds, agents]);

  const firstAgentId = task.agentIds[0] ?? '';

  function handleTitleMouseDown(e: React.MouseEvent) {
    handleDragReorder(e.nativeEvent, {
      itemId: task.id,
      getTaskOrder: () => getStore().taskOrder,
      onReorder: reorderTask,
      onTap: () => setActiveTask(task.id),
    });
  }

  function titleBar(): PanelChild {
    return {
      id: 'title',
      initialSize: 50,
      fixed: true,
      content: (
        <div
          className={isActive ? 'island-header-active' : ''}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 10px',
            height: '100%',
            background: 'transparent',
            borderBottom: `1px solid ${theme.border}`,
            userSelect: 'none',
            cursor: 'grab',
          }}
          onMouseDown={handleTitleMouseDown}
        >
          <div
            style={{
              overflow: 'hidden',
              flex: '1',
              minWidth: '0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <StatusDot status={getTaskDotStatus(task.id)} size="md" />
            {task.directMode && (
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  background: `color-mix(in srgb, ${theme.warning} 15%, transparent)`,
                  color: theme.warning,
                  border: `1px solid color-mix(in srgb, ${theme.warning} 25%, transparent)`,
                  flexShrink: '0',
                  whiteSpace: 'nowrap',
                }}
              >
                {task.branchName}
              </span>
            )}
            <EditableText
              value={task.name}
              onCommit={(v) => updateTaskName(task.id, v)}
              className="editable-text"
              title={task.savedInitialPrompt}
              ref={(h) => { titleEditHandleRef.current = h ?? undefined; }}
            />
          </div>
          <div style={{ display: 'flex', gap: '4px', marginLeft: '8px', flexShrink: '0' }}>
            {!task.directMode && (
              <>
                <IconButton
                  icon={
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
                    </svg>
                  }
                  onClick={openMergeConfirm}
                  title="Merge into main"
                />
                <div style={{ position: 'relative', display: 'inline-flex' }}>
                  {pushing ? (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '4px',
                        border: `1px solid ${theme.border}`,
                        borderRadius: '6px',
                      }}
                    >
                      <span className="inline-spinner" style={{ width: '14px', height: '14px' }} />
                    </div>
                  ) : (
                    <IconButton
                      icon={
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <path
                            d="M4.75 8a.75.75 0 0 1 .75-.75h5.19L8.22 4.78a.75.75 0 0 1 1.06-1.06l3.5 3.5a.75.75 0 0 1 0 1.06l-3.5 3.5a.75.75 0 1 1-1.06-1.06l2.47-2.47H5.5A.75.75 0 0 1 4.75 8Z"
                            transform="rotate(-90 8 8)"
                          />
                        </svg>
                      }
                      onClick={() => setShowPushConfirm(true)}
                      title="Push to remote"
                    />
                  )}
                  {pushSuccess && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '-4px',
                        right: '-4px',
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: theme.success,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <svg width="8" height="8" viewBox="0 0 16 16" fill="white">
                        <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                      </svg>
                    </div>
                  )}
                </div>
              </>
            )}
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 8a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8Z" />
                </svg>
              }
              onClick={() => collapseTask(task.id)}
              title="Collapse task"
            />
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              }
              onClick={() => setShowCloseConfirm(true)}
              title="Close task"
            />
          </div>
        </div>
      ),
    };
  }

  function branchInfoBar(): PanelChild {
    return {
      id: 'branch',
      initialSize: 28,
      fixed: true,
      content: (
        <InfoBar
          title={
            editorCommand
              ? `Click to open in ${editorCommand} · ${isMac ? 'Cmd' : 'Ctrl'}+Click to reveal in file manager`
              : task.worktreePath
          }
          onClick={(e?: React.MouseEvent) => {
            if (editorCommand && !(e && (e.ctrlKey || e.metaKey))) {
              openInEditor(editorCommand, task.worktreePath).catch((err) =>
                showNotification(
                  `Editor failed: ${err instanceof Error ? err.message : 'unknown error'}`,
                ),
              );
            } else {
              revealItemInDir(task.worktreePath).catch(() => {});
            }
          }}
        >
          {(() => {
            const project = getProject(task.projectId);
            return (
              project ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingProjectId(project.id);
                  }}
                  title="Project settings"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'transparent',
                    border: 'none',
                    padding: '0',
                    margin: '0 12px 0 0',
                    color: 'inherit',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                  }}
                >
                  <div
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: project.color,
                      flexShrink: '0',
                    }}
                  />
                  {project.name}
                </button>
              ) : null
            );
          })()}
          {task.githubUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                window.open(task.githubUrl!, '_blank');
              }}
              title={task.githubUrl}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                marginRight: '12px',
                background: 'transparent',
                border: 'none',
                padding: '0',
                color: theme.accent,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 'inherit',
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="currentColor"
                style={{ flexShrink: '0' }}
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
              {task.githubUrl.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
            </button>
          )}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginRight: '12px',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ flexShrink: '0' }}
            >
              <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6.25 7.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 7.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 0h5.5a2.5 2.5 0 0 0 2.5-2.5v-.5a.75.75 0 0 0-1.5 0v.5a1 1 0 0 1-1 1H5a3.25 3.25 0 1 0 0 6.5h6.25a.75.75 0 0 0 0-1.5H5a1.75 1.75 0 1 1 0-3.5Z" />
            </svg>
            {!task.directMode && task.branchName}
            {task.directMode && (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: '600',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  background: `color-mix(in srgb, ${theme.warning} 15%, transparent)`,
                  color: theme.warning,
                  border: `1px solid color-mix(in srgb, ${theme.warning} 25%, transparent)`,
                }}
              >
                {task.branchName}
              </span>
            )}
          </span>
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: 0.6 }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              style={{ flexShrink: '0' }}
            >
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
            </svg>
            {task.worktreePath}
          </span>
        </InfoBar>
      ),
    };
  }

  function notesAndFiles(): PanelChild {
    return {
      id: 'notes-files',
      initialSize: 150,
      minSize: 60,
      content: (
        <ResizablePanel
          direction="horizontal"
          persistKey={`task:${task.id}:notes-split`}
          children={[
            {
              id: 'notes',
              initialSize: 200,
              minSize: 100,
              content: (
                <ScalablePanel panelId={`${task.id}:notes`}>
                  <div
                    className="focusable-panel"
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                    onClick={() => setTaskFocusedPanel(task.id, 'notes')}
                  >
                    {showPlans && task.planContent && (
                      <div
                        style={{
                          display: 'flex',
                          borderBottom: `1px solid ${theme.border}`,
                          flexShrink: '0',
                        }}
                      >
                        <button
                          style={{
                            padding: '2px 8px',
                            fontSize: sf(10),
                            background: notesTab === 'notes' ? theme.taskPanelBg : 'transparent',
                            color: notesTab === 'notes' ? theme.fg : theme.fgMuted,
                            border: 'none',
                            borderBottom:
                              notesTab === 'notes'
                                ? `2px solid ${theme.accent}`
                                : '2px solid transparent',
                            cursor: 'pointer',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                          onClick={() => setNotesTab('notes')}
                        >
                          Notes
                        </button>
                        <button
                          style={{
                            padding: '2px 8px',
                            fontSize: sf(10),
                            background: notesTab === 'plan' ? theme.taskPanelBg : 'transparent',
                            color: notesTab === 'plan' ? theme.fg : theme.fgMuted,
                            border: 'none',
                            borderBottom:
                              notesTab === 'plan'
                                ? `2px solid ${theme.accent}`
                                : '2px solid transparent',
                            cursor: 'pointer',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                          onClick={() => setNotesTab('plan')}
                        >
                          Plan
                        </button>
                        <button
                          style={{
                            marginLeft: 'auto',
                            padding: '2px 6px',
                            fontSize: sf(10),
                            background: 'transparent',
                            color: theme.fgMuted,
                            border: 'none',
                            cursor: 'pointer',
                            fontFamily: "'JetBrains Mono', monospace",
                          }}
                          title="Open plan fullscreen"
                          onClick={() => setPlanFullscreen(true)}
                        >
                          {'⤢'}
                        </button>
                      </div>
                    )}

                    {(notesTab === 'notes' || !showPlans || !task.planContent) && (
                      <textarea
                        ref={notesRef}
                        value={task.notes}
                        onChange={(e) => updateTaskNotes(task.id, e.currentTarget.value)}
                        placeholder="Notes..."
                        style={{
                          width: '100%',
                          flex: '1',
                          background: theme.taskPanelBg,
                          border: 'none',
                          padding: '6px 8px',
                          color: theme.fg,
                          fontSize: sf(11),
                          fontFamily: "'JetBrains Mono', monospace",
                          resize: 'none',
                          outline: 'none',
                        }}
                      />
                    )}

                    {notesTab === 'plan' && showPlans && task.planContent && (
                      <div
                        className="plan-markdown"
                        style={{
                          flex: '1',
                          overflow: 'auto',
                          padding: '6px 8px',
                          background: theme.taskPanelBg,
                          color: theme.fg,
                          fontSize: sf(11),
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                        dangerouslySetInnerHTML={{
                          __html: marked.parse(task.planContent ?? '', { async: false }) as string,
                        }}
                      />
                    )}
                  </div>
                </ScalablePanel>
              ),
            },
            {
              id: 'changed-files',
              initialSize: 200,
              minSize: 100,
              content: (
                <ScalablePanel panelId={`${task.id}:changed-files`}>
                  <div
                    style={{
                      height: '100%',
                      background: theme.taskPanelBg,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                    onClick={() => setTaskFocusedPanel(task.id, 'changed-files')}
                  >
                    <div
                      style={{
                        padding: '4px 8px',
                        fontSize: sf(10),
                        fontWeight: '600',
                        color: theme.fgMuted,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        borderBottom: `1px solid ${theme.border}`,
                        flexShrink: '0',
                      }}
                    >
                      Changed Files
                    </div>
                    <div style={{ flex: '1', overflow: 'hidden' }}>
                      <ChangedFilesList
                        worktreePath={task.worktreePath}
                        isActive={isActive}
                        onFileClick={setDiffFile}
                        ref={(el) => { changedFilesRef.current = el; }}
                      />
                    </div>
                  </div>
                </ScalablePanel>
              ),
            },
          ]}
        />
      ),
    };
  }

  function shellSection(): PanelChild {
    return {
      id: 'shell-section',
      initialSize: 28,
      minSize: 28,
      get fixed() {
        return task.shellAgentIds.length === 0;
      },
      requestSize: task.shellAgentIds.length > 0 ? 200 : 28,
      content: (
        <ScalablePanel panelId={`${task.id}:shell`}>
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              background: 'transparent',
            }}
          >
            <div
              ref={shellToolbarRef}
              className="focusable-panel shell-toolbar-panel"
              tabIndex={0}
              onClick={() => setTaskFocusedPanel(task.id, 'shell-toolbar')}
              onFocus={() => setShellToolbarFocused(true)}
              onBlur={() => setShellToolbarFocused(false)}
              onKeyDown={(e) => {
                const itemCount = 1 + projectBookmarks.length;
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  setShellToolbarIdx((i) => Math.min(itemCount - 1, i + 1));
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  setShellToolbarIdx((i) => Math.max(0, i - 1));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const idx = shellToolbarIdx;
                  if (idx === 0) {
                    spawnShellForTask(task.id);
                  } else {
                    const bm = projectBookmarks[idx - 1];
                    if (bm) runBookmarkInTask(task.id, bm.command);
                  }
                }
              }}
              style={{
                height: '28px',
                minHeight: '28px',
                display: 'flex',
                alignItems: 'center',
                padding: '0 8px',
                background: 'transparent',
                gap: '4px',
                outline: 'none',
              }}
            >
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  spawnShellForTask(task.id);
                }}
                tabIndex={-1}
                title={`Open terminal (${mod}+Shift+T)`}
                style={{
                  background: theme.taskPanelBg,
                  border: `1px solid ${shellToolbarIdx === 0 && shellToolbarFocused ? theme.accent : theme.border}`,
                  color: theme.fgMuted,
                  cursor: 'pointer',
                  borderRadius: '4px',
                  padding: '4px 12px',
                  fontSize: sf(13),
                  lineHeight: '1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span style={{ fontFamily: 'monospace', fontSize: sf(13) }}>&gt;_</span>
                <span>Terminal</span>
              </button>
              {projectBookmarks.map((bookmark, i) => (
                <button
                  key={bookmark.command}
                  className="icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    runBookmarkInTask(task.id, bookmark.command);
                  }}
                  tabIndex={-1}
                  title={bookmark.command}
                  style={{
                    background: theme.taskPanelBg,
                    border: `1px solid ${shellToolbarIdx === i + 1 && shellToolbarFocused ? theme.accent : theme.border}`,
                    color: theme.fgMuted,
                    cursor: 'pointer',
                    borderRadius: '4px',
                    padding: '4px 12px',
                    fontSize: sf(13),
                    lineHeight: '1',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <span>{extractLabel(bookmark.command)}</span>
                </button>
              ))}
            </div>
            {task.shellAgentIds.length > 0 && (
              <div
                style={{
                  flex: '1',
                  display: 'flex',
                  overflow: 'hidden',
                  background: theme.taskContainerBg,
                  gap: '6px',
                  marginTop: '6px',
                }}
              >
                {task.shellAgentIds.map((shellId, i) => (
                  <ShellTerminalItem
                    key={shellId}
                    shellId={shellId}
                    index={i}
                    taskId={task.id}
                    isActive={isActive}
                    worktreePath={task.worktreePath}
                    shellExits={shellExits}
                    setShellExits={setShellExits}
                  />
                ))}
              </div>
            )}
          </div>
        </ScalablePanel>
      ),
    };
  }

  function aiTerminal(): PanelChild {
    return {
      id: 'ai-terminal',
      minSize: 80,
      content: (
        <ScalablePanel panelId={`${task.id}:ai-terminal`}>
          <div
            className="focusable-panel shell-terminal-container"
            data-shell-focused={
              focusedPanel[task.id] === 'ai-terminal' ? 'true' : 'false'
            }
            style={{
              height: '100%',
              position: 'relative',
              background: theme.taskPanelBg,
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={() => setTaskFocusedPanel(task.id, 'ai-terminal')}
          >
            <InfoBar
              title={
                task.lastPrompt ||
                (task.initialPrompt ? 'Waiting to send prompt...' : 'No prompts sent yet')
              }
              onDblClick={() => {
                if (task.lastPrompt && promptHandleRef.current && !promptHandleRef.current.getText())
                  promptHandleRef.current.setText(task.lastPrompt);
              }}
            >
              <span style={{ opacity: task.lastPrompt ? 1 : 0.4 }}>
                {task.lastPrompt
                  ? `> ${task.lastPrompt}`
                  : task.initialPrompt
                    ? '\u23F3 Waiting to send prompt\u2026'
                    : 'No prompts sent'}
              </span>
            </InfoBar>
            <div style={{ flex: '1', position: 'relative', overflow: 'hidden' }}>
              {firstAgent && (
                <>
                  {firstAgent.status === 'exited' && (
                    <div
                      className="exit-badge"
                      title={firstAgent.lastOutput.length ? firstAgent.lastOutput.join('\n') : undefined}
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '12px',
                        zIndex: '10',
                        fontSize: sf(11),
                        color: firstAgent.exitCode === 0 ? theme.success : theme.error,
                        background: 'color-mix(in srgb, var(--island-bg) 80%, transparent)',
                        padding: '4px 12px',
                        borderRadius: '8px',
                        border: `1px solid ${theme.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span>
                        {firstAgent.signal === 'spawn_failed'
                          ? 'Failed to start'
                          : `Process exited (${firstAgent.exitCode ?? '?'})`}
                      </span>
                      <AgentRestartMenu agent={firstAgent} />
                      {firstAgent.def.resume_args?.length ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            restartAgent(firstAgent.id, true);
                          }}
                          style={{
                            background: theme.bgElevated,
                            border: `1px solid ${theme.border}`,
                            color: theme.fg,
                            padding: '2px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: sf(10),
                          }}
                        >
                          Resume
                        </button>
                      ) : null}
                    </div>
                  )}
                  {/* Key on id:generation to force remount on restart */}
                  <TerminalView
                    key={`${firstAgent.id}:${firstAgent.generation}`}
                    taskId={task.id}
                    agentId={firstAgent.id}
                    isFocused={
                      isActive && focusedPanel[task.id] === 'ai-terminal'
                    }
                    command={firstAgent.def.command}
                    args={[
                      ...(firstAgent.resumed && firstAgent.def.resume_args?.length
                        ? (firstAgent.def.resume_args ?? [])
                        : firstAgent.def.args),
                      ...(task.skipPermissions && firstAgent.def.skip_permissions_args?.length
                        ? (firstAgent.def.skip_permissions_args ?? [])
                        : []),
                    ]}
                    cwd={task.worktreePath}
                    onExit={(code) => markAgentExited(firstAgent.id, code)}
                    onData={(data) => markAgentOutput(firstAgent.id, data, task.id)}
                    onPromptDetected={(text) => setLastPrompt(task.id, text)}
                    onReady={(focusFn) =>
                      registerFocusFn(`${task.id}:ai-terminal`, focusFn)
                    }
                    fontSize={Math.round(13 * getFontScale(`${task.id}:ai-terminal`))}
                  />
                </>
              )}
            </div>
          </div>
        </ScalablePanel>
      ),
    };
  }

  function promptInput(): PanelChild {
    return {
      id: 'prompt',
      initialSize: 72,
      stable: true,
      minSize: 54,
      maxSize: 300,
      content: (
        <ScalablePanel panelId={`${task.id}:prompt`}>
          <div
            onClick={() => setTaskFocusedPanel(task.id, 'prompt')}
            style={{ height: '100%' }}
          >
            <PromptInput
              taskId={task.id}
              agentId={firstAgentId}
              initialPrompt={task.initialPrompt}
              prefillPrompt={task.prefillPrompt}
              onSend={() => {
                if (task.initialPrompt) clearInitialPrompt(task.id);
              }}
              onPrefillConsumed={() => clearPrefillPrompt(task.id)}
              inputRef={(el) => { promptRef.current = el; }}
              handle={(h) => { promptHandleRef.current = h; }}
            />
          </div>
        </ScalablePanel>
      ),
    };
  }

  return (
    <div
      ref={panelRef}
      className={`task-column ${isActive ? 'active' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: theme.taskContainerBg,
        borderRadius: '12px',
        border: `1px solid ${theme.border}`,
        overflow: 'clip',
        position: 'relative',
      }}
      onClick={() => setActiveTask(task.id)}
    >
      {task.closingStatus && task.closingStatus !== 'removing' && (
        <div
          style={{
            position: 'absolute',
            inset: '0',
            zIndex: '50',
            background: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            borderRadius: '12px',
            color: theme.fg,
          }}
        >
          {task.closingStatus === 'closing' && (
            <div style={{ fontSize: '13px', color: theme.fgMuted }}>Closing task...</div>
          )}
          {task.closingStatus === 'error' && (
            <>
              <div style={{ fontSize: '13px', color: theme.error, fontWeight: '600' }}>
                Close failed
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: theme.fgMuted,
                  maxWidth: '260px',
                  textAlign: 'center',
                  wordBreak: 'break-word',
                }}
              >
                {task.closingError}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  retryCloseTask(task.id);
                }}
                style={{
                  background: theme.bgElevated,
                  border: `1px solid ${theme.border}`,
                  color: theme.fg,
                  padding: '6px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '12px',
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
      <ResizablePanel
        direction="vertical"
        persistKey={`task:${task.id}`}
        children={[
          titleBar(),
          branchInfoBar(),
          notesAndFiles(),
          shellSection(),
          aiTerminal(),
          promptInput(),
        ]}
      />
      <CloseTaskDialog
        open={showCloseConfirm}
        task={task}
        onDone={() => setShowCloseConfirm(false)}
      />
      <MergeDialog
        open={showMergeConfirm}
        task={task}
        initialCleanup={getProject(task.projectId)?.deleteBranchOnClose ?? true}
        onDone={() => setShowMergeConfirm(false)}
        onDiffFileClick={setDiffFile}
      />
      <PushDialog
        open={showPushConfirm}
        task={task}
        onStart={() => {
          setPushing(true);
          setPushSuccess(false);
          clearTimeout(pushSuccessTimerRef.current);
        }}
        onDone={(success) => {
          setShowPushConfirm(false);
          setPushing(false);
          if (success) {
            setPushSuccess(true);
            pushSuccessTimerRef.current = setTimeout(() => setPushSuccess(false), 3000);
          }
        }}
      />
      <DiffViewerDialog
        file={diffFile}
        worktreePath={task.worktreePath}
        projectRoot={getProject(task.projectId)?.path}
        branchName={task.branchName}
        onClose={() => setDiffFile(null)}
      />
      <EditProjectDialog project={editingProject} onClose={() => setEditingProjectId(null)} />
      <Dialog open={planFullscreen} onClose={() => setPlanFullscreen(false)} width="800px">
        <div
          className="plan-markdown"
          style={{
            color: theme.fg,
            fontSize: '15px',
            fontFamily: "'JetBrains Mono', monospace",
            maxHeight: '70vh',
            overflow: 'auto',
          }}
          dangerouslySetInnerHTML={{
            __html: marked.parse(task.planContent ?? '', { async: false }) as string,
          }}
        />
      </Dialog>
    </div>
  );
}

// --- Sub-components extracted to avoid hook rules violations inside map callbacks ---

interface ShellTerminalItemProps {
  shellId: string;
  index: number;
  taskId: string;
  isActive: boolean;
  worktreePath: string;
  shellExits: Record<string, { exitCode: number | null; signal: string | null }>;
  setShellExits: React.Dispatch<React.SetStateAction<Record<string, { exitCode: number | null; signal: string | null }>>>;
}

function ShellTerminalItem({
  shellId,
  index,
  taskId,
  isActive,
  worktreePath,
  shellExits,
  setShellExits,
}: ShellTerminalItemProps) {
  const focusedPanel = useStore((s) => s.focusedPanel);
  const initialCommandRef = useRef(consumePendingShellCommand(shellId));
  const shellFocusFnRef = useRef<(() => void) | undefined>(undefined);
  const registeredKeyRef = useRef<string | undefined>(undefined);

  // Re-register focus fn whenever the index changes (e.g. after a sibling is removed)
  useEffect(() => {
    const key = `${taskId}:shell:${index}`;
    if (registeredKeyRef.current && registeredKeyRef.current !== key) {
      unregisterFocusFn(registeredKeyRef.current);
    }
    if (shellFocusFnRef.current) registerFocusFn(key, shellFocusFnRef.current);
    registeredKeyRef.current = key;

    return () => {
      if (registeredKeyRef.current) unregisterFocusFn(registeredKeyRef.current);
    };
  }, [taskId, index]);

  const isShellFocused = focusedPanel[taskId] === `shell:${index}`;

  return (
    <div
      className="focusable-panel shell-terminal-container"
      data-shell-focused={isShellFocused ? 'true' : 'false'}
      style={{
        flex: '1',
        overflow: 'hidden',
        position: 'relative',
        background: theme.taskPanelBg,
      }}
      onClick={() => setTaskFocusedPanel(taskId, `shell:${index}`)}
    >
      <button
        className="shell-terminal-close"
        onClick={(e) => {
          e.stopPropagation();
          closeShell(taskId, shellId);
        }}
        title="Close terminal (Ctrl+Shift+Q)"
        style={{
          background: 'color-mix(in srgb, var(--island-bg) 85%, transparent)',
          border: `1px solid ${theme.border}`,
          color: theme.fgMuted,
          cursor: 'pointer',
          borderRadius: '6px',
          padding: '2px 6px',
          lineHeight: '1',
          fontSize: '14px',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
      {shellExits[shellId] && (
        <div
          className="exit-badge"
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            zIndex: '10',
            fontSize: sf(11),
            color:
              shellExits[shellId]?.exitCode === 0 ? theme.success : theme.error,
            background: 'color-mix(in srgb, var(--island-bg) 80%, transparent)',
            padding: '4px 12px',
            borderRadius: '8px',
            border: `1px solid ${theme.border}`,
          }}
        >
          Process exited ({shellExits[shellId]?.exitCode ?? '?'})
        </div>
      )}
      <TerminalView
        taskId={taskId}
        agentId={shellId}
        isShell
        isFocused={
          isActive && focusedPanel[taskId] === `shell:${index}`
        }
        command={getShellCommand()}
        args={['-l']}
        cwd={worktreePath}
        initialCommand={initialCommandRef.current}
        onData={(data) => markAgentOutput(shellId, data, taskId)}
        onExit={(info) =>
          setShellExits((prev) => ({
            ...prev,
            [shellId]: {
              exitCode: info.exit_code,
              signal: info.signal,
            },
          }))
        }
        onReady={(focusFn) => {
          shellFocusFnRef.current = focusFn;
          if (registeredKeyRef.current) registerFocusFn(registeredKeyRef.current, focusFn);
        }}
        fontSize={Math.round(11 * getFontScale(`${taskId}:shell`))}
        autoFocus
      />
    </div>
  );
}

// --- Agent restart menu (extracted to use hooks properly) ---

interface AgentRestartMenuProps {
  agent: NonNullable<ReturnType<typeof useStore.getState>['agents'][string]>;
}

function AgentRestartMenu({ agent }: AgentRestartMenuProps) {
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const availableAgents = useStore((s) => s.availableAgents);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAgentMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex' }}
      ref={menuRef}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          restartAgent(agent.id, false);
        }}
        style={{
          background: theme.bgElevated,
          border: `1px solid ${theme.border}`,
          color: theme.fg,
          padding: '2px 8px',
          borderRadius: '4px 0 0 4px',
          borderRight: 'none',
          cursor: 'pointer',
          fontSize: sf(10),
        }}
      >
        Restart
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowAgentMenu(!showAgentMenu);
        }}
        style={{
          background: theme.bgElevated,
          border: `1px solid ${theme.border}`,
          color: theme.fg,
          padding: '2px 4px',
          borderRadius: '0 4px 4px 0',
          cursor: 'pointer',
          fontSize: sf(10),
        }}
      >
        &#x25BE;
      </button>
      {showAgentMenu && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: '0',
            marginTop: '4px',
            background: theme.bgElevated,
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            padding: '4px 0',
            zIndex: '20',
            minWidth: '160px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          <div
            style={{
              padding: '4px 10px',
              fontSize: sf(9),
              color: theme.fgMuted,
            }}
          >
            Restart with...
          </div>
          {availableAgents
            .filter((ag) => ag.available !== false)
            .map((agentDef) => (
              <button
                key={agentDef.id}
                title={agentDef.description}
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAgentMenu(false);
                  if (agentDef.id === agent.def.id) {
                    restartAgent(agent.id, false);
                  } else {
                    switchAgent(agent.id, agentDef);
                  }
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  background:
                    agentDef.id === agent.def.id
                      ? theme.bgSelected
                      : 'transparent',
                  border: 'none',
                  color: theme.fg,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  fontSize: sf(10),
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  if (agentDef.id !== agent.def.id)
                    e.currentTarget.style.background = theme.bgHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background =
                    agentDef.id === agent.def.id
                      ? theme.bgSelected
                      : 'transparent';
                }}
              >
                {agentDef.name}
                {agentDef.id === agent.def.id && (
                  <>
                    {' '}
                    <span style={{ opacity: 0.5 }}>(current)</span>
                  </>
                )}
              </button>
            ))}
        </div>
      )}
    </span>
  );
}

function getShellCommand(): string {
  // Empty string tells the backend to use $SHELL (Unix) or %COMSPEC% (Windows)
  return '';
}
