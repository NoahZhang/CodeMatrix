import { invoke } from '../lib/ipc';
import { getStore, setStore, updateWindowTitle, cleanupPanelEntries } from './store';
import { clearAgentActivity } from './taskStatus';
import { triggerFocus, getTaskFocusedPanel } from './focus';
import type { Terminal } from './types';

let terminalCounter = 0;
let lastCreateTime = 0;

const REMOVE_ANIMATION_MS = 300;

export function createTerminal(): void {
  const now = Date.now();
  if (now - lastCreateTime < 300) return;
  lastCreateTime = now;

  terminalCounter++;
  const id = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const name = `Terminal ${terminalCounter}`;

  const terminal: Terminal = { id, name, agentId };

  setStore((s) => {
    s.terminals[id] = terminal;
    s.taskOrder.push(id);
    s.focusedPanel[id] = 'terminal';
    s.activeTaskId = id;
    s.activeAgentId = null;
    s.sidebarFocused = false;
  });

  updateWindowTitle(name);

  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'end', behavior: 'instant' });
  });
}

export async function closeTerminal(terminalId: string): Promise<void> {
  const terminal = getStore().terminals[terminalId];
  if (!terminal || terminal.closingStatus === 'removing' || terminal.closingStatus === 'closing')
    return;

  setStore((s) => {
    if (s.terminals[terminalId]) {
      s.terminals[terminalId].closingStatus = 'closing';
    }
  });

  await invoke('kill_agent', { agentId: terminal.agentId }).catch(() => {});
  clearAgentActivity(terminal.agentId);

  const s = getStore();
  const idx = s.taskOrder.indexOf(terminalId);

  if (s.activeTaskId === terminalId) {
    const order = s.taskOrder;
    const neighborIdx = idx > 0 ? idx - 1 : idx + 1;
    const neighbor = order[neighborIdx] ?? null;
    setStore((s) => {
      s.activeTaskId = neighbor;
      const neighborTask = neighbor ? s.tasks[neighbor] : null;
      s.activeAgentId = neighborTask?.agentIds[0] ?? null;
    });
  }

  setStore((s) => {
    if (s.terminals[terminalId]) {
      s.terminals[terminalId].closingStatus = 'removing';
    }
  });

  setTimeout(() => {
    setStore((s) => {
      delete s.terminals[terminalId];
      delete s.agents[terminal.agentId];
      cleanupPanelEntries(s, terminalId);

      if (s.activeTaskId === terminalId) {
        s.activeTaskId = s.taskOrder[0] ?? null;
        const firstTask = s.activeTaskId ? s.tasks[s.activeTaskId] : null;
        s.activeAgentId = firstTask?.agentIds[0] ?? null;
      }
    });

    const newStore = getStore();
    const activeId = newStore.activeTaskId;
    if (activeId) {
      const activeTask = newStore.tasks[activeId];
      const activeTerminal = newStore.terminals[activeId];
      updateWindowTitle(activeTask?.name ?? activeTerminal?.name);
      const panel = getTaskFocusedPanel(activeId);
      requestAnimationFrame(() => triggerFocus(`${activeId}:${panel}`));
    } else {
      updateWindowTitle(undefined);
    }
  }, REMOVE_ANIMATION_MS);
}

export function updateTerminalName(terminalId: string, name: string): void {
  setStore((s) => {
    if (s.terminals[terminalId]) {
      s.terminals[terminalId].name = name;
    }
  });
  if (getStore().activeTaskId === terminalId) {
    updateWindowTitle(name);
  }
}

export function syncTerminalCounter(): void {
  const s = getStore();
  let max = 0;
  for (const id of s.taskOrder) {
    const t = s.terminals[id];
    if (!t) continue;
    const match = t.name.match(/^Terminal (\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  terminalCounter = max;
}
