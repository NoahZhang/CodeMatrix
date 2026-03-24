import { getStore, setStore, updateWindowTitle } from './store';
import { showNotification } from './notification';
import { pickAndAddProject } from './projects';
import { reorderTask } from './tasks';

export function setActiveTask(id: string): void {
  const s = getStore();
  const task = s.tasks[id];
  const terminal = s.terminals[id];
  if (!task && !terminal) return;
  setStore((s) => {
    s.activeTaskId = id;
    s.activeAgentId = task?.agentIds[0] ?? null;
  });
  updateWindowTitle(task?.name ?? terminal?.name);
}

export function setActiveAgent(agentId: string): void {
  setStore((s) => {
    s.activeAgentId = agentId;
  });
}

export function navigateTask(direction: 'left' | 'right'): void {
  const { taskOrder, activeTaskId } = getStore();
  if (taskOrder.length === 0) return;
  const idx = activeTaskId ? taskOrder.indexOf(activeTaskId) : -1;
  const next =
    direction === 'left' ? Math.max(0, idx - 1) : Math.min(taskOrder.length - 1, idx + 1);
  setActiveTask(taskOrder[next]);
}

export function navigateAgent(direction: 'up' | 'down'): void {
  const { activeTaskId, activeAgentId, tasks } = getStore();
  if (!activeTaskId) return;
  const task = tasks[activeTaskId];
  if (!task) return;
  const idx = activeAgentId ? task.agentIds.indexOf(activeAgentId) : -1;
  const next =
    direction === 'up' ? Math.max(0, idx - 1) : Math.min(task.agentIds.length - 1, idx + 1);
  setStore((s) => {
    s.activeAgentId = task.agentIds[next];
  });
}

export function moveActiveTask(direction: 'left' | 'right'): void {
  const { taskOrder, activeTaskId } = getStore();
  if (!activeTaskId || taskOrder.length < 2) return;
  const idx = taskOrder.indexOf(activeTaskId);
  if (idx === -1) return;
  const target = direction === 'left' ? idx - 1 : idx + 1;
  if (target < 0 || target >= taskOrder.length) return;
  reorderTask(idx, target);
}

export function toggleNewTaskDialog(show?: boolean): void {
  const s = getStore();
  const shouldShow = show ?? !s.showNewTaskDialog;
  if (shouldShow && s.projects.length === 0) {
    showNotification('Add a project first');
    pickAndAddProject();
    return;
  }
  setStore((s) => {
    if (!shouldShow) {
      s.newTaskDropUrl = null;
      s.newTaskPrefillPrompt = null;
    }
    s.showNewTaskDialog = shouldShow;
  });
}
