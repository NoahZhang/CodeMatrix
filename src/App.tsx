import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { useState, useEffect, useRef, useCallback, Component, ReactNode } from 'react';
import { invoke } from './lib/ipc';
import { listen } from './lib/ipc';
import { appWindow } from './lib/window';
import { confirm } from './lib/dialog';
import { theme } from './lib/theme';
import {
  useStore,
  getStore,
  loadAgents,
  loadState,
  saveState,
  toggleNewTaskDialog,
  toggleSidebar,
  toggleArena,
  moveActiveTask,
  getGlobalScale,
  adjustGlobalScale,
  resetGlobalScale,
  resetFontScale,
  startTaskStatusPolling,
  stopTaskStatusPolling,
  navigateRow,
  navigateColumn,
  setPendingAction,
  toggleHelpDialog,
  toggleSettingsDialog,
  sendActivePrompt,
  spawnShellForTask,
  closeShell,
  clearNotification,
  setWindowState,
  createTerminal,
  closeTerminal,
  setNewTaskDropUrl,
  validateProjectPaths,
  setPlanContent,
} from './store/store';
import { isGitHubUrl } from './lib/github-url';
import type { PersistedWindowState } from './store/types';
import { registerShortcut, initShortcuts } from './lib/shortcuts';
import { setupAutosave } from './store/autosave';
import { isMac, mod } from './lib/platform';
import { createCtrlWheelZoomHandler } from './lib/wheelZoom';
import { WindowTitleBar } from './components/WindowTitleBar';
import { Sidebar } from './components/Sidebar';
import { TilingLayout } from './components/TilingLayout';
import { WindowResizeHandles } from './components/WindowResizeHandles';
import { HelpDialog } from './components/HelpDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { NewTaskDialog } from './components/NewTaskDialog';

const MIN_WINDOW_DIMENSION = 100;

function DropOverlay() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: '0',
        background: 'rgba(0, 0, 0, 0.65)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        zIndex: 9999,
        pointerEvents: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 16 16"
        fill={theme.accent}
        style={{ opacity: 0.9 }}
      >
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
      </svg>
      <span
        style={{
          color: theme.fg,
          fontSize: '16px',
          fontWeight: 600,
          fontFamily: "var(--font-ui)",
        }}
      >
        Drop GitHub link to create task
      </span>
      <span
        style={{
          color: theme.fgMuted,
          fontSize: '12px',
          fontFamily: "var(--font-ui)",
        }}
      >
        A new task will be created with the link in the prompt
      </span>
    </div>
  );
}

// React error boundary (class component required)
interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            background: theme.bg,
            color: theme.fg,
            fontFamily: "var(--font-ui, 'Sora', sans-serif)",
          }}
        >
          <div style={{ fontSize: '18px', fontWeight: 600, color: theme.error }}>
            Something went wrong
          </div>
          <div
            style={{
              maxWidth: '500px',
              textAlign: 'center',
              color: theme.fgMuted,
              wordBreak: 'break-word',
            }}
          >
            {String(this.state.error)}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              background: theme.bgElevated,
              border: `1px solid ${theme.border}`,
              color: theme.fg,
              padding: '8px 24px',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function extractGitHubUrl(dt: DataTransfer): string | null {
  const uriList = dt.getData('text/uri-list');
  if (uriList) {
    const firstUrl = uriList
      .split('\n')
      .find((l) => !l.startsWith('#'))
      ?.trim();
    if (firstUrl && isGitHubUrl(firstUrl)) return firstUrl;
  }
  const text = dt.getData('text/plain')?.trim();
  if (text && isGitHubUrl(text)) return text;
  return null;
}

function mayContainUrl(dt: DataTransfer): boolean {
  if (dt.types.includes('Files')) return false;
  return dt.types.includes('text/uri-list') || dt.types.includes('text/plain');
}

function App() {
  const mainRef = useRef<HTMLDivElement>(null);
  const [windowFocused, setWindowFocused] = useState(true);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const dragCounterRef = useRef(0);

  // Subscribe to store slices needed for rendering
  const themePreset = useStore((s) => s.themePreset);
  const sidebarVisible = useStore((s) => s.sidebarVisible);
  const showNewTaskDialogOpen = useStore((s) => s.showNewTaskDialog);
  const showHelpDialogOpen = useStore((s) => s.showHelpDialog);
  const showSettingsDialogOpen = useStore((s) => s.showSettingsDialog);
  const showArena = useStore((s) => s.showArena);
  const notification = useStore((s) => s.notification);
  const inactiveColumnOpacity = useStore((s) => s.inactiveColumnOpacity);



  const readWindowGeometry = useCallback(async (): Promise<Omit<PersistedWindowState, 'maximized'> | null> => {
    const [position, size] = await Promise.all([
      appWindow.outerPosition().catch(() => null),
      appWindow.outerSize().catch(() => null),
    ]);

    if (!position || !size) return null;
    if (size.width < MIN_WINDOW_DIMENSION || size.height < MIN_WINDOW_DIMENSION) return null;
    // Reject absurd sizes (e.g. corrupted state or coordinate-space bugs)
    if (size.width > 10000 || size.height > 10000) return null;

    return {
      x: Math.round(position.x),
      y: Math.round(position.y),
      width: Math.round(size.width),
      height: Math.round(size.height),
    };
  }, []);

  const captureWindowState = useCallback(async (): Promise<void> => {
    const maximized = await appWindow.isMaximized().catch(() => false);
    const current = getStore().windowState;

    if (maximized && current) {
      if (!current.maximized) {
        setWindowState({ ...current, maximized: true });
      }
      return;
    }

    const geometry = await readWindowGeometry();
    if (!geometry) return;

    setWindowState({ ...geometry, maximized });
  }, [readWindowGeometry]);

  // Sync theme preset to <html> for Portal content CSS variables
  useEffect(() => {
    document.documentElement.dataset.look = themePreset;
  }, [themePreset]);

  // Main initialization effect
  useEffect(() => {
    let cleanedUp = false;
    let unlistenFocusChanged: (() => void) | null = null;
    let unlistenResized: (() => void) | null = null;
    let unlistenMoved: (() => void) | null = null;
    let unlistenPlanContent: (() => void) | null = null;
    let unlistenCloseRequested: (() => void) | null = null;
    let cleanupShortcuts: (() => void) | null = null;

    const handlePaste = (e: ClipboardEvent) => {
      const s = getStore();
      if (s.showNewTaskDialog || s.showHelpDialog || s.showSettingsDialog) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable) ||
        el?.closest?.('.xterm')
      ) {
        return;
      }
      const text = e.clipboardData?.getData('text/plain')?.trim();
      if (text && isGitHubUrl(text)) {
        e.preventDefault();
        setNewTaskDropUrl(text);
        toggleNewTaskDialog(true);
      }
    };

    const wheelHandler = createCtrlWheelZoomHandler((delta) => adjustGlobalScale(delta));

    async function init() {
      if (isMac) {
        await appWindow.setTitleBarStyle('overlay').catch((error) => {
          console.warn('Failed to enable macOS overlay titlebar', error);
        });
      } else {
        await appWindow.setDecorations(false).catch((error) => {
          console.warn('Failed to disable native decorations', error);
        });
      }

      // Sync initial state
      const focused = await appWindow.isFocused().catch(() => true);
      if (!cleanedUp) setWindowFocused(focused);

      const maximized = await appWindow.isMaximized().catch(() => false);
      if (!cleanedUp) setWindowMaximized(maximized);

      // Window event listeners
      try {
        unlistenFocusChanged = await appWindow.onFocusChanged((event) => {
          if (!cleanedUp) setWindowFocused(Boolean(event.payload));
        });
      } catch {
        unlistenFocusChanged = null;
      }

      try {
        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        unlistenResized = await appWindow.onResized(() => {
          if (resizeTimer !== undefined) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(async () => {
            resizeTimer = undefined;
            const max = await appWindow.isMaximized().catch(() => false);
            if (!cleanedUp) setWindowMaximized(max);
            await captureWindowState();
          }, 200);
        });
      } catch {
        unlistenResized = null;
      }

      try {
        let moveTimer: ReturnType<typeof setTimeout> | undefined;
        unlistenMoved = await appWindow.onMoved(() => {
          if (moveTimer !== undefined) clearTimeout(moveTimer);
          moveTimer = setTimeout(() => {
            moveTimer = undefined;
            void captureWindowState();
          }, 200);
        });
      } catch {
        unlistenMoved = null;
      }

      // Load agents, state, validate projects
      try {
        await loadAgents();
      } catch (e) {
        console.error('Failed to load agents:', e);
      }
      try {
        await loadState();
      } catch (e) {
        console.error('Failed to load state:', e);
      }
      await validateProjectPaths().catch(console.error);

      // Restore window state
      const saved = getStore().windowState;
      if (saved && saved.width >= MIN_WINDOW_DIMENSION && saved.height >= MIN_WINDOW_DIMENSION) {
        await appWindow.unmaximize().catch(() => {});
        await appWindow.setSize({ width: saved.width, height: saved.height }).catch(() => {});
        await appWindow.setPosition({ x: saved.x, y: saved.y }).catch(() => {});
        if (saved.maximized) {
          await appWindow.maximize().catch(() => {});
        }
        const max = await appWindow.isMaximized().catch(() => false);
        if (!cleanedUp) setWindowMaximized(max);
      }
      await captureWindowState();

      setupAutosave();
      startTaskStatusPolling();

      // Listen for plan content from backend
      try {
        unlistenPlanContent = await listen<{ taskId: string; content: string | null; fileName: string | null }>(
          'plan_content',
          (event) => {
            const msg = event.payload;
            if (msg.taskId && getStore().tasks[msg.taskId]) {
              setPlanContent(msg.taskId, msg.content, msg.fileName);
            }
          },
        );
      } catch {
        unlistenPlanContent = null;
      }

      // Paste handler
      document.addEventListener('paste', handlePaste);

      // Wheel zoom
      mainRef.current?.addEventListener('wheel', wheelHandler, { passive: false });

      // Keyboard shortcuts
      cleanupShortcuts = initShortcuts();

      // Close handler
      let allowClose = false;
      let handlingClose = false;
      unlistenCloseRequested = await appWindow.onCloseRequested(async (event) => {
        await captureWindowState();
        await saveState();

        if (allowClose) return;
        if (handlingClose) {
          event.preventDefault();
          return;
        }

        const runningCount = await invoke<number>('count_running_agents').catch(() => 0);
        if (runningCount <= 0) return;

        event.preventDefault();
        handlingClose = true;
        try {
          const countLabel =
            runningCount === 1
              ? '1 running terminal session'
              : `${runningCount} running terminal sessions`;
          const shouldKill = await confirm(
            `You have ${countLabel}. They can be restored on app restart. Kill them and quit, or keep them alive in the background?`,
            {
              title: 'Running Terminals',
              kind: 'warning',
              okLabel: 'Kill & Quit',
              cancelLabel: 'Keep in Background',
            },
          ).catch(() => false);

          if (shouldKill) {
            await invoke('kill_all_agents').catch(console.error);
            allowClose = true;
            await appWindow.close().catch(console.error);
            return;
          }

          await appWindow.hide().catch(console.error);
        } finally {
          handlingClose = false;
        }
      });

      // Navigation shortcuts
      registerShortcut({ key: 'ArrowUp', alt: true, global: true, handler: () => navigateRow('up') });
      registerShortcut({ key: 'ArrowDown', alt: true, global: true, handler: () => navigateRow('down') });
      registerShortcut({ key: 'ArrowLeft', alt: true, global: true, handler: () => navigateColumn('left') });
      registerShortcut({ key: 'ArrowRight', alt: true, global: true, handler: () => navigateColumn('right') });

      // Task reordering
      registerShortcut({ key: 'ArrowLeft', cmdOrCtrl: true, shift: true, global: true, handler: () => moveActiveTask('left') });
      registerShortcut({ key: 'ArrowRight', cmdOrCtrl: true, shift: true, global: true, handler: () => moveActiveTask('right') });

      // Task actions
      registerShortcut({
        key: 'w',
        cmdOrCtrl: true,
        global: true,
        handler: () => {
          const s = getStore();
          const taskId = s.activeTaskId;
          if (!taskId) return;
          const panel = s.focusedPanel[taskId] ?? '';
          if (panel.startsWith('shell:')) {
            const idx = parseInt(panel.slice(6), 10);
            const shellId = s.tasks[taskId]?.shellAgentIds[idx];
            if (shellId) closeShell(taskId, shellId);
          }
        },
      });
      registerShortcut({
        key: 'W',
        cmdOrCtrl: true,
        shift: true,
        global: true,
        handler: () => {
          const s = getStore();
          const id = s.activeTaskId;
          if (!id) return;
          if (s.terminals[id]) {
            closeTerminal(id);
            return;
          }
          if (s.tasks[id]) setPendingAction({ type: 'close', taskId: id });
        },
      });
      registerShortcut({
        key: 'M',
        cmdOrCtrl: true,
        shift: true,
        global: true,
        handler: () => {
          const s = getStore();
          const id = s.activeTaskId;
          if (id && s.tasks[id]) setPendingAction({ type: 'merge', taskId: id });
        },
      });
      registerShortcut({
        key: 'P',
        cmdOrCtrl: true,
        shift: true,
        global: true,
        handler: () => {
          const s = getStore();
          const id = s.activeTaskId;
          if (id && s.tasks[id]) setPendingAction({ type: 'push', taskId: id });
        },
      });
      registerShortcut({
        key: 'T',
        cmdOrCtrl: true,
        shift: true,
        global: true,
        handler: () => {
          const s = getStore();
          const id = s.activeTaskId;
          if (id && s.tasks[id]) spawnShellForTask(id);
        },
      });
      registerShortcut({ key: 'Enter', cmdOrCtrl: true, global: true, handler: () => sendActivePrompt() });

      // App shortcuts
      registerShortcut({ key: 'D', cmdOrCtrl: true, shift: true, global: true, handler: (e) => { if (!e.repeat) createTerminal(); } });
      registerShortcut({ key: 'n', cmdOrCtrl: true, global: true, handler: () => toggleNewTaskDialog(true) });
      registerShortcut({ key: 'a', cmdOrCtrl: true, shift: true, global: true, handler: () => toggleNewTaskDialog(true) });
      registerShortcut({ key: 'b', cmdOrCtrl: true, handler: () => toggleSidebar() });
      registerShortcut({ key: '/', cmdOrCtrl: true, global: true, dialogSafe: true, handler: () => toggleHelpDialog() });
      registerShortcut({ key: ',', cmdOrCtrl: true, global: true, dialogSafe: true, handler: () => toggleSettingsDialog() });
      registerShortcut({ key: 'F1', global: true, dialogSafe: true, handler: () => toggleHelpDialog() });
      registerShortcut({
        key: 'Escape',
        dialogSafe: true,
        handler: () => {
          const s = getStore();
          if (s.showArena) return;
          if (s.showHelpDialog) { toggleHelpDialog(false); return; }
          if (s.showSettingsDialog) { toggleSettingsDialog(false); return; }
          if (s.showNewTaskDialog) { toggleNewTaskDialog(false); return; }
        },
      });
      registerShortcut({
        key: '0',
        cmdOrCtrl: true,
        handler: () => {
          const taskId = getStore().activeTaskId;
          if (taskId) resetFontScale(taskId);
          resetGlobalScale();
        },
      });
    }

    init().catch(console.error);

    return () => {
      cleanedUp = true;
      document.removeEventListener('paste', handlePaste);
      mainRef.current?.removeEventListener('wheel', wheelHandler);
      unlistenCloseRequested?.();
      cleanupShortcuts?.();
      stopTaskStatusPolling();
      unlistenPlanContent?.();
      unlistenFocusChanged?.();
      unlistenResized?.();
      unlistenMoved?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag & drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer || !mayContainUrl(e.dataTransfer)) return;
    e.preventDefault();
    dragCounterRef.current++;
    if (dragCounterRef.current === 1) setShowDropOverlay(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!showDropOverlay) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, [showDropOverlay]);

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    if (!showDropOverlay) return;
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setShowDropOverlay(false);
    }
  }, [showDropOverlay]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setShowDropOverlay(false);
    if (!e.dataTransfer) return;
    const url = extractGitHubUrl(e.dataTransfer);
    if (!url) return;
    setNewTaskDropUrl(url);
    toggleNewTaskDialog(true);
  }, []);

  const globalScale = getGlobalScale();

  return (
    <AppErrorBoundary>
      <div
        ref={mainRef}
        className="app-shell"
        data-look={themePreset}
        data-window-border={!isMac ? 'true' : 'false'}
        data-window-focused={windowFocused ? 'true' : 'false'}
        data-window-maximized={windowMaximized ? 'true' : 'false'}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          '--inactive-column-opacity': inactiveColumnOpacity,
          width: `${100 / globalScale}vw`,
          height: `${100 / globalScale}vh`,
          transform: `scale(${globalScale})`,
          transformOrigin: '0 0',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          background: theme.bg,
          color: theme.fg,
          fontFamily: "var(--font-ui, 'Sora', sans-serif)",
          fontSize: '13px',
          overflow: 'hidden',
        } as React.CSSProperties}
      >
        {!isMac && <WindowTitleBar />}
        {isMac && <div className="mac-titlebar-spacer" data-tauri-drag-region />}
        <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {sidebarVisible ? (
            <Sidebar />
          ) : (
            <button
              className="icon-btn"
              onClick={() => toggleSidebar()}
              title={`Show sidebar (${mod}+B)`}
              style={{
                width: '24px',
                minWidth: '24px',
                height: 'calc(100% - 12px)',
                margin: '6px 4px 6px 0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: theme.fgSubtle,
                background: 'transparent',
                borderTop: `2px dashed ${theme.border}`,
                borderRight: `2px dashed ${theme.border}`,
                borderBottom: `2px dashed ${theme.border}`,
                borderLeft: 'none',
                borderRadius: '0 12px 12px 0',
                userSelect: 'none',
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          )}
          <TilingLayout />
        </main>
        {!isMac && <WindowResizeHandles />}
        <HelpDialog open={showHelpDialogOpen} onClose={() => toggleHelpDialog(false)} />
        <SettingsDialog open={showSettingsDialogOpen} onClose={() => toggleSettingsDialog(false)} />
        <NewTaskDialog open={showNewTaskDialogOpen} onClose={() => toggleNewTaskDialog(false)} />
        {showArena && <ArenaOverlayStub onClose={() => toggleArena(false)} />}
        {showDropOverlay && <DropOverlay />}
        {notification && (
          <div
            onClick={() => clearNotification()}
            style={{
              position: 'fixed',
              bottom: '24px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: theme.islandBg,
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              padding: '10px 20px',
              color: theme.fg,
              fontSize: '13px',
              zIndex: 2000,
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
              cursor: 'pointer',
            }}
          >
            {notification}
          </div>
        )}
      </div>
    </AppErrorBoundary>
  );
}

// Arena not yet converted (Phase 8) — keep stub
function ArenaOverlayStub({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.fg }}>
      Arena (stub)
    </div>
  );
}

export default App;
