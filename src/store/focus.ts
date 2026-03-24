import { getStore, setStore } from './store';
import { setActiveTask } from './navigation';

// Imperative focus registry: components register focus callbacks on mount
const focusRegistry = new Map<string, () => void>();
const actionRegistry = new Map<string, () => void>();

export function registerFocusFn(key: string, fn: () => void): void {
  focusRegistry.set(key, fn);
}

export function unregisterFocusFn(key: string): void {
  focusRegistry.delete(key);
}

export function triggerFocus(key: string): void {
  focusRegistry.get(key)?.();
}

export function registerAction(key: string, fn: () => void): void {
  actionRegistry.set(key, fn);
}

export function unregisterAction(key: string): void {
  actionRegistry.delete(key);
}

export function triggerAction(key: string): void {
  actionRegistry.get(key)?.();
}

function buildGrid(panelId: string): string[][] {
  const s = getStore();
  const task = s.tasks[panelId];
  if (task) {
    const grid: string[][] = [['title'], ['notes', 'changed-files'], ['shell-toolbar']];
    if (task.shellAgentIds.length > 0) {
      grid.push(task.shellAgentIds.map((_, i) => `shell:${i}`));
    }
    grid.push(['ai-terminal']);
    grid.push(['prompt']);
    return grid;
  }

  return [['title'], ['terminal']];
}

function defaultPanelFor(panelId: string): string {
  return getStore().tasks[panelId] ? 'ai-terminal' : 'terminal';
}

interface GridPos {
  row: number;
  col: number;
}

function findInGrid(grid: string[][], cell: string): GridPos | null {
  for (let row = 0; row < grid.length; row++) {
    const col = grid[row].indexOf(cell);
    if (col !== -1) return { row, col };
  }
  return null;
}

export function getTaskFocusedPanel(taskId: string): string {
  return getStore().focusedPanel[taskId] ?? defaultPanelFor(taskId);
}

export function setTaskFocusedPanel(taskId: string, panel: string): void {
  setStore((s) => {
    s.focusedPanel[taskId] = panel;
    s.sidebarFocused = false;
    s.placeholderFocused = false;
  });
  triggerFocus(`${taskId}:${panel}`);
  scrollTaskIntoView(taskId);
}

function scrollTaskIntoView(taskId: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  });
}

export function focusSidebar(): void {
  setStore((s) => {
    s.sidebarFocused = true;
    s.placeholderFocused = false;
    s.sidebarFocusedTaskId = s.activeTaskId;
    s.sidebarFocusedProjectId = null;
  });
  triggerFocus('sidebar');
}

export function unfocusSidebar(): void {
  setStore((s) => {
    s.sidebarFocused = false;
    s.sidebarFocusedProjectId = null;
    s.sidebarFocusedTaskId = null;
  });
}

export function focusPlaceholder(button?: 'add-task' | 'add-terminal'): void {
  const target = button ?? getStore().placeholderFocusedButton;
  setStore((s) => {
    s.placeholderFocused = true;
    s.sidebarFocused = false;
    if (button) s.placeholderFocusedButton = button;
  });
  triggerFocus(`placeholder:${target}`);
}

export function unfocusPlaceholder(): void {
  setStore((s) => {
    s.placeholderFocused = false;
  });
}

export function setSidebarFocusedProjectId(id: string | null): void {
  setStore((s) => {
    s.sidebarFocusedProjectId = id;
  });
}

function focusTaskPanel(taskId: string, panel: string): void {
  setStore((s) => {
    s.focusedPanel[taskId] = panel;
    s.sidebarFocused = false;
    s.placeholderFocused = false;
  });
  setActiveTask(taskId);
  triggerFocus(`${taskId}:${panel}`);
}

export function navigateRow(direction: 'up' | 'down'): void {
  const s = getStore();
  if (s.showNewTaskDialog || s.showHelpDialog || s.showSettingsDialog) return;

  if (s.placeholderFocused) {
    const btn = direction === 'up' ? 'add-task' : 'add-terminal';
    setStore((s) => {
      s.placeholderFocusedButton = btn;
    });
    triggerFocus(`placeholder:${btn}`);
    return;
  }

  if (s.sidebarFocused) {
    const { taskOrder, projects, sidebarFocusedProjectId, sidebarFocusedTaskId } = s;

    if (sidebarFocusedProjectId !== null) {
      const projectIdx = projects.findIndex((p) => p.id === sidebarFocusedProjectId);
      if (direction === 'up') {
        if (projectIdx > 0) {
          setStore((s) => {
            s.sidebarFocusedProjectId = projects[projectIdx - 1].id;
          });
        }
      } else {
        if (projectIdx < projects.length - 1) {
          setStore((s) => {
            s.sidebarFocusedProjectId = projects[projectIdx + 1].id;
          });
        } else if (taskOrder.length > 0) {
          setStore((s) => {
            s.sidebarFocusedProjectId = null;
            s.sidebarFocusedTaskId = taskOrder[0];
          });
        }
      }
      return;
    }

    if (taskOrder.length === 0 && projects.length === 0) return;
    const currentIdx = sidebarFocusedTaskId ? taskOrder.indexOf(sidebarFocusedTaskId) : -1;
    if (direction === 'up') {
      if (currentIdx <= 0 && projects.length > 0) {
        setStore((s) => {
          s.sidebarFocusedTaskId = null;
          s.sidebarFocusedProjectId = projects[projects.length - 1].id;
        });
      } else if (currentIdx > 0) {
        setStore((s) => {
          s.sidebarFocusedTaskId = taskOrder[currentIdx - 1];
        });
      }
    } else {
      if (taskOrder.length === 0) return;
      const nextIdx = Math.min(taskOrder.length - 1, currentIdx + 1);
      setStore((s) => {
        s.sidebarFocusedTaskId = taskOrder[nextIdx];
      });
    }
    return;
  }

  const taskId = s.activeTaskId;
  if (!taskId) return;

  const grid = buildGrid(taskId);
  const current = getTaskFocusedPanel(taskId);
  const pos = findInGrid(grid, current);
  if (!pos) return;

  const nextRow = direction === 'up' ? pos.row - 1 : pos.row + 1;
  if (nextRow < 0 || nextRow >= grid.length) return;

  const col = Math.min(pos.col, grid[nextRow].length - 1);
  setTaskFocusedPanel(taskId, grid[nextRow][col]);
}

export function navigateColumn(direction: 'left' | 'right'): void {
  const s = getStore();
  if (s.showNewTaskDialog || s.showHelpDialog || s.showSettingsDialog) return;

  const taskId = s.activeTaskId;

  if (s.placeholderFocused) {
    if (direction === 'left') {
      unfocusPlaceholder();
      const lastTaskId = s.taskOrder[s.taskOrder.length - 1];
      if (lastTaskId) {
        setActiveTask(lastTaskId);
        setTaskFocusedPanel(lastTaskId, getTaskFocusedPanel(lastTaskId));
      } else if (s.sidebarVisible) {
        focusSidebar();
      }
    }
    return;
  }

  if (s.sidebarFocused) {
    if (direction === 'right') {
      const targetTaskId = s.sidebarFocusedTaskId ?? taskId;
      if (targetTaskId) {
        if (targetTaskId !== s.activeTaskId) setActiveTask(targetTaskId);
        unfocusSidebar();
        setTaskFocusedPanel(targetTaskId, getTaskFocusedPanel(targetTaskId));
      }
    }
    return;
  }

  if (!taskId) return;

  const grid = buildGrid(taskId);
  const current = getTaskFocusedPanel(taskId);
  const pos = findInGrid(grid, current);
  if (!pos) return;

  const row = grid[pos.row];
  const nextCol = direction === 'left' ? pos.col - 1 : pos.col + 1;

  if (nextCol >= 0 && nextCol < row.length) {
    setTaskFocusedPanel(taskId, row[nextCol]);
    return;
  }

  const { taskOrder } = s;
  const taskIdx = taskOrder.indexOf(taskId);
  const isCurrentTerminal = !s.tasks[taskId];

  if (direction === 'left') {
    if (taskIdx === 0) {
      if (s.sidebarVisible) focusSidebar();
      return;
    }
    const prevTaskId = taskOrder[taskIdx - 1];
    if (prevTaskId) {
      if (isCurrentTerminal && s.tasks[prevTaskId]) {
        focusTaskPanel(prevTaskId, getTaskFocusedPanel(prevTaskId));
      } else if (!s.tasks[prevTaskId]) {
        focusTaskPanel(prevTaskId, defaultPanelFor(prevTaskId));
      } else {
        const prevGrid = buildGrid(prevTaskId);
        const prevPos = findInGrid(prevGrid, current);
        const targetRow = prevPos ? prevPos.row : pos.row;
        const safeRow = Math.min(targetRow, prevGrid.length - 1);
        const lastCol = prevGrid[safeRow].length - 1;
        focusTaskPanel(prevTaskId, prevGrid[safeRow][lastCol]);
      }
    }
  } else {
    const nextTaskId = taskOrder[taskIdx + 1];
    if (nextTaskId) {
      if (isCurrentTerminal && s.tasks[nextTaskId]) {
        focusTaskPanel(nextTaskId, getTaskFocusedPanel(nextTaskId));
      } else if (!s.tasks[nextTaskId]) {
        focusTaskPanel(nextTaskId, defaultPanelFor(nextTaskId));
      } else {
        const nextGrid = buildGrid(nextTaskId);
        const nextPos = findInGrid(nextGrid, current);
        const targetRow = nextPos ? nextPos.row : pos.row;
        const safeRow = Math.min(targetRow, nextGrid.length - 1);
        focusTaskPanel(nextTaskId, nextGrid[safeRow][0]);
      }
    } else {
      focusPlaceholder('add-task');
    }
  }
}

export function setPendingAction(
  action: { type: 'close' | 'merge' | 'push'; taskId: string } | null,
): void {
  setStore((s) => {
    s.pendingAction = action;
  });
}

export function clearPendingAction(): void {
  setStore((s) => {
    s.pendingAction = null;
  });
}

export function toggleHelpDialog(show?: boolean): void {
  setStore((s) => {
    s.showHelpDialog = show ?? !s.showHelpDialog;
  });
}

export function toggleSettingsDialog(show?: boolean): void {
  setStore((s) => {
    s.showSettingsDialog = show ?? !s.showSettingsDialog;
  });
}

export function sendActivePrompt(): void {
  const taskId = getStore().activeTaskId;
  if (!taskId) return;
  triggerAction(`${taskId}:send-prompt`);
}
