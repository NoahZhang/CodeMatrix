import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  useStore,
  getStore,
  pickAndAddProject,
  removeProject,
  removeProjectWithTasks,
  toggleNewTaskDialog,
  setActiveTask,
  toggleSidebar,
  reorderTask,
  getTaskDotStatus,
  registerFocusFn,
  unregisterFocusFn,
  focusSidebar,
  unfocusSidebar,
  setTaskFocusedPanel,
  getTaskFocusedPanel,
  getPanelSize,
  setPanelSizes,
  toggleSettingsDialog,
  uncollapseTask,
  isProjectMissing,
} from '../store/store';
import type { Project } from '../store/types';
import { ConnectPhoneModal } from './ConnectPhoneModal';
import { ConfirmDialog } from './ConfirmDialog';
import { EditProjectDialog } from './EditProjectDialog';
import { SidebarFooter } from './SidebarFooter';
import { IconButton } from './IconButton';
import { StatusDot } from './StatusDot';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { mod } from '../lib/platform';

const DRAG_THRESHOLD = 5;
const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 160;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_SIZE_KEY = 'sidebar:width';

export function Sidebar() {
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showConnectPhone, setShowConnectPhone] = useState(false);
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const taskListRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  const taskOrder = useStore((s) => s.taskOrder);
  const tasks = useStore((s) => s.tasks);
  const projects = useStore((s) => s.projects);
  const collapsedTaskOrder = useStore((s) => s.collapsedTaskOrder);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const sidebarFocused = useStore((s) => s.sidebarFocused);
  const sidebarFocusedTaskId = useStore((s) => s.sidebarFocusedTaskId);
  const sidebarFocusedProjectId = useStore((s) => s.sidebarFocusedProjectId);
  const remoteAccess = useStore((s) => s.remoteAccess);

  const sidebarWidth = getPanelSize(SIDEBAR_SIZE_KEY) ?? SIDEBAR_DEFAULT_WIDTH;

  const taskIndexById = useMemo(() => {
    const map = new Map<string, number>();
    taskOrder.forEach((taskId, idx) => map.set(taskId, idx));
    return map;
  }, [taskOrder]);

  const groupedTasks = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    const orphaned: string[] = [];
    const projectIds = new Set(projects.map((p) => p.id));

    for (const taskId of taskOrder) {
      const task = tasks[taskId];
      if (!task) continue;
      const projectId = task.projectId;
      if (projectId && projectIds.has(projectId)) {
        (grouped[projectId] ??= []).push(taskId);
      } else {
        orphaned.push(taskId);
      }
    }

    return { grouped, orphaned };
  }, [taskOrder, tasks, projects]);

  const collapsedTasks = useMemo(
    () => collapsedTaskOrder.filter((id) => tasks[id]?.collapsed),
    [collapsedTaskOrder, tasks],
  );

  const dragFromIndexRef = useRef(dragFromIndex);
  dragFromIndexRef.current = dragFromIndex;
  const dropTargetIndexRef = useRef(dropTargetIndex);
  dropTargetIndexRef.current = dropTargetIndex;

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMove(ev: MouseEvent) {
      const newWidth = Math.max(
        SIDEBAR_MIN_WIDTH,
        Math.min(SIDEBAR_MAX_WIDTH, startWidth + ev.clientX - startX),
      );
      setPanelSizes({ [SIDEBAR_SIZE_KEY]: newWidth });
    }

    function onUp() {
      setResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function computeDropIndex(clientY: number, fromIdx: number): number {
    if (!taskListRef.current) return fromIdx;
    const items = taskListRef.current.querySelectorAll<HTMLElement>('[data-task-index]');
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (clientY < midY) return i;
    }
    return items.length;
  }

  const handleTaskMouseDown = useCallback(
    (e: MouseEvent, taskId: string, index: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      function onMove(ev: MouseEvent) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;

        if (!dragging) {
          dragging = true;
          setDragFromIndex(index);
          document.body.classList.add('dragging-task');
        }

        const dropIdx = computeDropIndex(ev.clientY, index);
        setDropTargetIndex(dropIdx);
      }

      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);

        if (dragging) {
          document.body.classList.remove('dragging-task');
          const from = dragFromIndexRef.current;
          const to = dropTargetIndexRef.current;
          setDragFromIndex(null);
          setDropTargetIndex(null);

          if (from !== null && to !== null && from !== to) {
            const adjustedTo = to > from ? to - 1 : to;
            reorderTask(from, adjustedTo);
          }
        } else {
          setActiveTask(taskId);
          focusSidebar();
        }
      }

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [],
  );

  // Attach mousedown on task list container via native listener + register sidebar focus
  useEffect(() => {
    const el = taskListRef.current;
    if (el) {
      const handler = (e: MouseEvent) => {
        const target = (e.target as HTMLElement).closest<HTMLElement>('[data-task-index]');
        if (!target) return;
        const index = Number(target.dataset.taskIndex);
        const currentTaskOrder = getStore().taskOrder;
        const taskId = currentTaskOrder[index];
        if (taskId === undefined || taskId === null) return;
        handleTaskMouseDown(e, taskId, index);
      };
      el.addEventListener('mousedown', handler);
      return () => el.removeEventListener('mousedown', handler);
    }
  }, [handleTaskMouseDown]);

  useEffect(() => {
    registerFocusFn('sidebar', () => taskListRef.current?.focus());
    return () => unregisterFocusFn('sidebar');
  }, []);

  // When sidebarFocused changes, trigger focus
  useEffect(() => {
    if (sidebarFocused) {
      taskListRef.current?.focus();
    }
  }, [sidebarFocused]);

  // Scroll the active task into view when it changes
  useEffect(() => {
    if (!activeTaskId || !taskListRef.current) return;
    const idx = taskIndexById.get(activeTaskId);
    if (idx === undefined) return;
    const el = taskListRef.current.querySelector<HTMLElement>(
      `[data-task-index="${CSS.escape(String(idx))}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
  }, [activeTaskId, taskIndexById]);

  // Scroll the focused task into view when navigating via keyboard
  useEffect(() => {
    if (!sidebarFocusedTaskId || !taskListRef.current) return;
    const idx = taskIndexById.get(sidebarFocusedTaskId);
    if (idx === undefined) return;
    const el = taskListRef.current.querySelector<HTMLElement>(
      `[data-task-index="${CSS.escape(String(idx))}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
  }, [sidebarFocusedTaskId, taskIndexById]);

  // Scroll the focused project into view when it changes
  useEffect(() => {
    if (!sidebarFocusedProjectId) return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(
        `[data-project-id="${CSS.escape(sidebarFocusedProjectId)}"]`,
      );
      el?.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
    });
  }, [sidebarFocusedProjectId]);

  async function handleAddProject() {
    await pickAndAddProject();
  }

  function handleRemoveProject(projectId: string) {
    const s = getStore();
    const hasTasks =
      s.taskOrder.some((tid) => s.tasks[tid]?.projectId === projectId) ||
      s.collapsedTaskOrder.some((tid) => s.tasks[tid]?.projectId === projectId);
    if (hasTasks) {
      setConfirmRemove(projectId);
    } else {
      removeProject(projectId);
    }
  }

  function abbreviatePath(path: string): string {
    const prefixes = ['/home/', '/Users/'];
    for (const prefix of prefixes) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        const slashIdx = rest.indexOf('/');
        if (slashIdx !== -1) return '~' + rest.slice(slashIdx);
        return '~';
      }
    }
    return path;
  }

  function globalIndex(taskId: string): number {
    return taskIndexById.get(taskId) ?? -1;
  }

  const connected = remoteAccess.enabled && remoteAccess.connectedClients > 0;
  const accent = connected ? theme.success : theme.fgMuted;

  const confirmRemoveTaskCount = confirmRemove
    ? [...taskOrder, ...collapsedTaskOrder].filter(
        (tid) => tasks[tid]?.projectId === confirmRemove,
      ).length
    : 0;

  return (
    <div
      ref={sidebarRef}
      style={{
        width: `${sidebarWidth}px`,
        minWidth: `${SIDEBAR_MIN_WIDTH}px`,
        maxWidth: `${SIDEBAR_MAX_WIDTH}px`,
        display: 'flex',
        flexShrink: '0',
        userSelect: resizing ? 'none' : undefined,
      }}
    >
      <div
        style={{
          flex: '1',
          minWidth: '0',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px',
          gap: '16px',
          userSelect: 'none',
        }}
      >
        {/* Logo + collapse */}
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 2px' }}>
            <svg
              width="24"
              height="24"
              viewBox="0 0 64 64"
              fill="none"
              style={{ flexShrink: '0' }}
            >
              {/* Outer circuit ring */}
              <circle cx="32" cy="32" r="29" stroke="#00cc66" strokeWidth="2.5" fill="none" />
              {/* Inner circuit ring */}
              <circle cx="32" cy="32" r="22" stroke="#00cc66" strokeWidth="1.5" fill="none" />
              {/* Circuit nodes */}
              <circle cx="32" cy="3" r="2" fill="#00cc66" />
              <circle cx="32" cy="61" r="2" fill="#00cc66" />
              <circle cx="3" cy="32" r="2" fill="#00cc66" />
              <circle cx="61" cy="32" r="2" fill="#00cc66" />
              {/* Letter M */}
              <text x="32" y="40" textAnchor="middle" fill="#00cc66" fontSize="28" fontWeight="bold" fontFamily="monospace">M</text>
            </svg>
            <span
              style={{
                fontSize: sf(14),
                fontWeight: '600',
                color: theme.fg,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              CodeMatrix
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 2.25a.75.75 0 0 1 .73.56l.2.72a4.48 4.48 0 0 1 1.04.43l.66-.37a.75.75 0 0 1 .9.13l.75.75a.75.75 0 0 1 .13.9l-.37.66c.17.33.31.68.43 1.04l.72.2a.75.75 0 0 1 .56.73v1.06a.75.75 0 0 1-.56.73l-.72.2a4.48 4.48 0 0 1-.43 1.04l.37.66a.75.75 0 0 1-.13.9l-.75.75a.75.75 0 0 1-.9.13l-.66-.37a4.48 4.48 0 0 1-1.04.43l-.2.72a.75.75 0 0 1-.73.56H6.94a.75.75 0 0 1-.73-.56l-.2-.72a4.48 4.48 0 0 1-1.04-.43l-.66.37a.75.75 0 0 1-.9-.13l-.75-.75a.75.75 0 0 1-.13-.9l.37-.66a4.48 4.48 0 0 1-.43-1.04l-.72-.2a.75.75 0 0 1-.56-.73V7.47a.75.75 0 0 1 .56-.73l.72-.2c.11-.36.26-.71.43-1.04l-.37-.66a.75.75 0 0 1 .13-.9l.75-.75a.75.75 0 0 1 .9-.13l.66.37c.33-.17.68-.31 1.04-.43l.2-.72a.75.75 0 0 1 .73-.56H8Zm-.53 3.22a2.5 2.5 0 1 0 1.06 4.88 2.5 2.5 0 0 0-1.06-4.88Z" />
                </svg>
              }
              onClick={() => toggleSettingsDialog(true)}
              title={`Settings (${mod}+,)`}
            />
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z" />
                </svg>
              }
              onClick={() => toggleSidebar()}
              title={`Collapse sidebar (${mod}+B)`}
            />
          </div>
        </div>

        {/* Projects section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 2px',
            }}
          >
            <label
              style={{
                fontSize: sf(11),
                color: theme.fgMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Projects
            </label>
            <IconButton
              icon={
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
                </svg>
              }
              onClick={() => handleAddProject()}
              title="Add project"
              size="sm"
            />
          </div>

          {projects.map((project) => (
            <div
              key={project.id}
              role="button"
              tabIndex={0}
              data-project-id={project.id}
              onClick={() => setEditingProject(project)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingProject(project);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 6px',
                borderRadius: '6px',
                background: isProjectMissing(project.id)
                  ? `color-mix(in srgb, ${theme.warning} 8%, ${theme.bgInput})`
                  : theme.bgInput,
                fontSize: sf(11),
                cursor: 'pointer',
                border:
                  sidebarFocused && sidebarFocusedProjectId === project.id
                    ? `1.5px solid var(--border-focus)`
                    : '1.5px solid transparent',
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: project.color,
                  flexShrink: '0',
                }}
              />
              <div style={{ flex: '1', minWidth: '0', overflow: 'hidden' }}>
                <div
                  style={{
                    color: theme.fg,
                    fontWeight: '500',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {project.name}
                </div>
                <div
                  style={{
                    color: isProjectMissing(project.id) ? theme.warning : theme.fgSubtle,
                    fontSize: sf(10),
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {isProjectMissing(project.id)
                    ? 'Folder not found'
                    : abbreviatePath(project.path)}
                </div>
              </div>
              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveProject(project.id);
                }}
                title="Remove project"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: theme.fgSubtle,
                  cursor: 'pointer',
                  fontSize: sf(12),
                  lineHeight: '1',
                  padding: '0 2px',
                  flexShrink: '0',
                }}
              >
                &times;
              </button>
            </div>
          ))}

          {projects.length === 0 && (
            <span style={{ fontSize: sf(10), color: theme.fgSubtle, padding: '0 2px' }}>
              No projects linked yet.
            </span>
          )}
        </div>

        <div style={{ height: '1px', background: theme.border }} />

        {/* New task / Link project button */}
        {projects.length > 0 ? (
          <button
            className="icon-btn"
            onClick={() => toggleNewTaskDialog(true)}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              padding: '8px 14px',
              color: theme.fgMuted,
              cursor: 'pointer',
              fontSize: sf(12),
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
            </svg>
            New Task
          </button>
        ) : (
          <button
            className="icon-btn"
            onClick={() => pickAndAddProject()}
            style={{
              background: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              padding: '8px 14px',
              color: theme.fgMuted,
              cursor: 'pointer',
              fontSize: sf(12),
              fontWeight: '500',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              width: '100%',
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
        )}

        {/* Tasks grouped by project */}
        <div
          ref={taskListRef}
          tabIndex={0}
          onKeyDown={(e) => {
            if (!sidebarFocused) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              const focusedProjectId = sidebarFocusedProjectId;
              if (focusedProjectId) {
                const project = projects.find((p) => p.id === focusedProjectId);
                if (project) setEditingProject(project);
                return;
              }
              const taskId = sidebarFocusedTaskId;
              if (taskId) {
                setActiveTask(taskId);
                unfocusSidebar();
                setTaskFocusedPanel(taskId, getTaskFocusedPanel(taskId));
              }
            }
          }}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1px',
            flex: '1',
            overflow: 'auto',
            outline: 'none',
          }}
        >
          {projects.map((project) => {
            const projectTasks = groupedTasks.grouped[project.id] ?? [];
            if (projectTasks.length === 0) return null;
            return (
              <React.Fragment key={project.id}>
                <span
                  style={{
                    fontSize: sf(10),
                    color: theme.fgSubtle,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginTop: '8px',
                    marginBottom: '4px',
                    padding: '0 2px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  <div
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: project.color,
                      flexShrink: '0',
                    }}
                  />
                  {project.name} ({projectTasks.length})
                </span>
                {projectTasks.map((taskId) => (
                  <TaskRow
                    key={taskId}
                    taskId={taskId}
                    globalIndex={globalIndex}
                    dragFromIndex={dragFromIndex}
                    dropTargetIndex={dropTargetIndex}
                  />
                ))}
              </React.Fragment>
            );
          })}

          {/* Orphaned tasks (no matching project) */}
          {groupedTasks.orphaned.length > 0 && (
            <>
              <span
                style={{
                  fontSize: sf(10),
                  color: theme.fgSubtle,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginTop: '8px',
                  marginBottom: '4px',
                  padding: '0 2px',
                }}
              >
                Other ({groupedTasks.orphaned.length})
              </span>
              {groupedTasks.orphaned.map((taskId) => (
                <TaskRow
                  key={taskId}
                  taskId={taskId}
                  globalIndex={globalIndex}
                  dragFromIndex={dragFromIndex}
                  dropTargetIndex={dropTargetIndex}
                />
              ))}
            </>
          )}

          {collapsedTasks.length > 0 && (
            <>
              <span
                style={{
                  fontSize: sf(10),
                  color: theme.fgSubtle,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginTop: '8px',
                  marginBottom: '4px',
                  padding: '0 2px',
                }}
              >
                Collapsed ({collapsedTasks.length})
              </span>
              {collapsedTasks.map((taskId) => {
                const task = tasks[taskId];
                if (!task) return null;
                return (
                  <div
                    key={taskId}
                    className="task-item"
                    role="button"
                    tabIndex={0}
                    onClick={() => uncollapseTask(taskId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        uncollapseTask(taskId);
                      }
                    }}
                    title="Click to restore"
                    style={{
                      padding: '7px 10px',
                      borderRadius: '6px',
                      background: 'transparent',
                      color: theme.fgSubtle,
                      fontSize: sf(12),
                      fontWeight: '400',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      opacity: '0.6',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      border: '1.5px solid transparent',
                    }}
                  >
                    <StatusDot status={getTaskDotStatus(taskId)} size="sm" />
                    {task.directMode && (
                      <span
                        style={{
                          fontSize: sf(10),
                          fontWeight: '600',
                          padding: '1px 5px',
                          borderRadius: '3px',
                          background: `color-mix(in srgb, ${theme.warning} 12%, transparent)`,
                          color: theme.warning,
                          flexShrink: '0',
                          lineHeight: '1.5',
                        }}
                      >
                        {task.branchName}
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {task.name}
                    </span>
                  </div>
                );
              })}
            </>
          )}

          {dropTargetIndex === taskOrder.length && <div className="drop-indicator" />}
        </div>

        {/* Connect / Disconnect Phone button */}
        <button
          onClick={() => setShowConnectPhone(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            margin: '4px 8px',
            background: 'transparent',
            border: `1px solid ${connected ? theme.success : theme.border}`,
            borderRadius: '8px',
            color: accent,
            fontSize: sf(12),
            cursor: 'pointer',
            flexShrink: '0',
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke={accent}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
          {connected ? 'Phone Connected' : 'Connect Phone'}
        </button>

        <SidebarFooter />

        <ConnectPhoneModal open={showConnectPhone} onClose={() => setShowConnectPhone(false)} />

        {/* Edit project dialog */}
        <EditProjectDialog project={editingProject} onClose={() => setEditingProject(null)} />

        {/* Confirm remove project dialog */}
        <ConfirmDialog
          open={confirmRemove !== null}
          title="Remove project?"
          message={`This project has ${confirmRemoveTaskCount} open task(s). Removing it will also close all tasks, delete their worktrees and branches.`}
          confirmLabel="Remove all"
          danger
          onConfirm={() => {
            const id = confirmRemove;
            if (id) removeProjectWithTasks(id);
            setConfirmRemove(null);
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      </div>
      {/* Resize handle */}
      <div
        className={`resize-handle resize-handle-h${resizing ? ' dragging' : ''}`}
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
}

interface TaskRowProps {
  taskId: string;
  globalIndex: (taskId: string) => number;
  dragFromIndex: number | null;
  dropTargetIndex: number | null;
}

function TaskRow({ taskId, globalIndex: getGlobalIndex, dragFromIndex, dropTargetIndex }: TaskRowProps) {
  const task = useStore((s) => s.tasks[taskId]);
  const activeTaskId = useStore((s) => s.activeTaskId);
  const sidebarFocused = useStore((s) => s.sidebarFocused);
  const sidebarFocusedTaskId = useStore((s) => s.sidebarFocusedTaskId);
  const [appeared, setAppeared] = useState(false);

  if (!task) return null;

  const idx = getGlobalIndex(taskId);

  return (
    <>
      {dropTargetIndex === idx && <div className="drop-indicator" />}
      <div
        className={`task-item${task.closingStatus === 'removing' ? ' task-item-removing' : appeared ? '' : ' task-item-appearing'}`}
        onAnimationEnd={(e) => {
          if ((e as React.AnimationEvent).animationName === 'taskItemAppear') setAppeared(true);
        }}
        data-task-index={idx}
        onClick={() => {
          setActiveTask(taskId);
          focusSidebar();
        }}
        style={{
          padding: '7px 10px',
          borderRadius: '6px',
          background: 'transparent',
          color: activeTaskId === taskId ? theme.fg : theme.fgMuted,
          fontSize: sf(12),
          fontWeight: activeTaskId === taskId ? '500' : '400',
          cursor: dragFromIndex !== null ? 'grabbing' : 'pointer',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: dragFromIndex === idx ? '0.4' : '1',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          border:
            sidebarFocused && sidebarFocusedTaskId === taskId
              ? `1.5px solid var(--border-focus)`
              : '1.5px solid transparent',
        }}
      >
        <StatusDot status={getTaskDotStatus(taskId)} size="sm" />
        {task.directMode && (
          <span
            style={{
              fontSize: sf(10),
              fontWeight: '600',
              padding: '1px 5px',
              borderRadius: '3px',
              background: `color-mix(in srgb, ${theme.warning} 12%, transparent)`,
              color: theme.warning,
              flexShrink: '0',
              lineHeight: '1.5',
            }}
          >
            {task.branchName}
          </span>
        )}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.name}</span>
      </div>
    </>
  );
}
