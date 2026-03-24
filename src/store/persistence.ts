import { invoke } from '../lib/ipc';
import { getStore, setStore } from './store';
import { randomPastelColor } from './projects';
import { markAgentSpawned } from './taskStatus';
import { getLocalDateKey } from '../lib/date';
import type {
  Agent,
  Task,
  PersistedState,
  PersistedTask,
  PersistedWindowState,
  Project,
} from './types';
import type { AgentDef } from '../ipc/types';
import { DEFAULT_TERMINAL_FONT, isTerminalFont } from '../lib/fonts';
import { isLookPreset } from '../lib/look';
import { syncTerminalCounter } from './terminals';

export async function saveState(): Promise<void> {
  const s = getStore();
  const persisted: PersistedState = {
    projects: s.projects.map((p) => ({ ...p })),
    lastProjectId: s.lastProjectId,
    lastAgentId: s.lastAgentId,
    taskOrder: [...s.taskOrder],
    collapsedTaskOrder: [...s.collapsedTaskOrder],
    tasks: {},
    activeTaskId: s.activeTaskId,
    sidebarVisible: s.sidebarVisible,
    fontScales: { ...s.fontScales },
    panelSizes: { ...s.panelSizes },
    globalScale: s.globalScale,
    completedTaskDate: s.completedTaskDate,
    completedTaskCount: s.completedTaskCount,
    mergedLinesAdded: s.mergedLinesAdded,
    mergedLinesRemoved: s.mergedLinesRemoved,
    terminalFont: s.terminalFont,
    themePreset: s.themePreset,
    windowState: s.windowState ? { ...s.windowState } : undefined,
    autoTrustFolders: s.autoTrustFolders,
    showPlans: s.showPlans,
    inactiveColumnOpacity: s.inactiveColumnOpacity,
    editorCommand: s.editorCommand || undefined,
    customAgents: s.customAgents.length > 0 ? [...s.customAgents] : undefined,
  };

  for (const taskId of s.taskOrder) {
    const task = s.tasks[taskId];
    if (!task) continue;
    const firstAgent = task.agentIds[0] ? s.agents[task.agentIds[0]] : null;
    persisted.tasks[taskId] = {
      id: task.id,
      name: task.name,
      projectId: task.projectId,
      branchName: task.branchName,
      worktreePath: task.worktreePath,
      notes: task.notes,
      lastPrompt: task.lastPrompt,
      shellCount: task.shellAgentIds.length,
      agentDef: firstAgent?.def ?? null,
      directMode: task.directMode,
      skipPermissions: task.skipPermissions,
      githubUrl: task.githubUrl,
      savedInitialPrompt: task.savedInitialPrompt,
    };
  }

  for (const taskId of s.collapsedTaskOrder) {
    const task = s.tasks[taskId];
    if (!task) continue;
    const firstAgent = task.agentIds[0] ? s.agents[task.agentIds[0]] : null;
    persisted.tasks[taskId] = {
      id: task.id,
      name: task.name,
      projectId: task.projectId,
      branchName: task.branchName,
      worktreePath: task.worktreePath,
      notes: task.notes,
      lastPrompt: task.lastPrompt,
      shellCount: task.shellAgentIds.length,
      agentDef: firstAgent?.def ?? task.savedAgentDef ?? null,
      directMode: task.directMode,
      skipPermissions: task.skipPermissions,
      githubUrl: task.githubUrl,
      savedInitialPrompt: task.savedInitialPrompt,
      collapsed: true,
    };
  }

  for (const id of s.taskOrder) {
    const terminal = s.terminals[id];
    if (!terminal) continue;
    if (!persisted.terminals) persisted.terminals = {};
    persisted.terminals[id] = { id: terminal.id, name: terminal.name };
  }

  await invoke('save_app_state', { json: JSON.stringify(persisted) }).catch((e) =>
    console.warn('Failed to save state:', e),
  );
}

function isStringNumberRecord(v: unknown): v is Record<string, number> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (val) => typeof val === 'number' && Number.isFinite(val),
  );
}

function parsePersistedWindowState(v: unknown): PersistedWindowState | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const raw = v as Record<string, unknown>;
  const { x, y, width, height, maximized } = raw;
  if (
    typeof x !== 'number' || !Number.isFinite(x) ||
    typeof y !== 'number' || !Number.isFinite(y) ||
    typeof width !== 'number' || !Number.isFinite(width) || width <= 0 ||
    typeof height !== 'number' || !Number.isFinite(height) || height <= 0 ||
    typeof maximized !== 'boolean'
  ) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), maximized };
}

interface LegacyPersistedState {
  projectRoot?: string;
  projects?: Project[];
  lastProjectId?: string | null;
  lastAgentId?: string | null;
  taskOrder: string[];
  collapsedTaskOrder?: string[];
  tasks: Record<string, PersistedTask & { projectId?: string }>;
  activeTaskId: string | null;
  sidebarVisible: boolean;
  fontScales?: unknown;
  panelSizes?: unknown;
  globalScale?: unknown;
  completedTaskDate?: unknown;
  completedTaskCount?: unknown;
  mergedLinesAdded?: unknown;
  mergedLinesRemoved?: unknown;
  terminalFont?: unknown;
  themePreset?: unknown;
  windowState?: unknown;
  autoTrustFolders?: unknown;
  showPlans?: unknown;
  inactiveColumnOpacity?: unknown;
  editorCommand?: unknown;
  customAgents?: unknown;
  terminals?: unknown;
}

export async function loadState(): Promise<void> {
  const json = await invoke<string | null>('load_app_state').catch(() => null);
  if (!json) return;

  let raw: LegacyPersistedState;
  try {
    raw = JSON.parse(json);
  } catch {
    console.warn('Failed to parse persisted state');
    return;
  }

  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.taskOrder) || typeof raw.tasks !== 'object') {
    console.warn('Invalid persisted state structure, skipping load');
    return;
  }

  let projects: Project[] = raw.projects ?? [];
  let lastProjectId: string | null = raw.lastProjectId ?? null;
  const lastAgentId: string | null = raw.lastAgentId ?? null;

  for (const p of projects) {
    if (!p.color) p.color = randomPastelColor();
  }

  if (projects.length === 0 && raw.projectRoot) {
    const segments = raw.projectRoot.split('/');
    const name = segments[segments.length - 1] || raw.projectRoot;
    const id = crypto.randomUUID();
    projects = [{ id, name, path: raw.projectRoot, color: randomPastelColor() }];
    lastProjectId = id;
    for (const taskId of raw.taskOrder) {
      const pt = raw.tasks[taskId];
      if (pt && !pt.projectId) pt.projectId = id;
    }
  }

  const restoredRunningAgentIds: string[] = [];
  const today = getLocalDateKey();

  setStore((s) => {
    s.projects = projects;
    s.lastProjectId = lastProjectId;
    s.lastAgentId = lastAgentId;
    s.taskOrder = raw.taskOrder;
    s.activeTaskId = raw.activeTaskId;
    s.sidebarVisible = raw.sidebarVisible;
    s.fontScales = isStringNumberRecord(raw.fontScales) ? raw.fontScales : {};
    s.panelSizes = isStringNumberRecord(raw.panelSizes) ? raw.panelSizes : {};
    s.globalScale = typeof raw.globalScale === 'number' ? raw.globalScale : 1;

    const completedTaskDate = typeof raw.completedTaskDate === 'string' ? raw.completedTaskDate : today;
    const completedTaskCountRaw = raw.completedTaskCount;
    const completedTaskCount =
      typeof completedTaskCountRaw === 'number' && Number.isFinite(completedTaskCountRaw)
        ? Math.max(0, Math.floor(completedTaskCountRaw))
        : 0;
    if (completedTaskDate === today) {
      s.completedTaskDate = completedTaskDate;
      s.completedTaskCount = completedTaskCount;
    } else {
      s.completedTaskDate = today;
      s.completedTaskCount = 0;
    }

    const mergedLinesAddedRaw = raw.mergedLinesAdded;
    const mergedLinesRemovedRaw = raw.mergedLinesRemoved;
    s.mergedLinesAdded =
      typeof mergedLinesAddedRaw === 'number' && Number.isFinite(mergedLinesAddedRaw)
        ? Math.max(0, Math.floor(mergedLinesAddedRaw)) : 0;
    s.mergedLinesRemoved =
      typeof mergedLinesRemovedRaw === 'number' && Number.isFinite(mergedLinesRemovedRaw)
        ? Math.max(0, Math.floor(mergedLinesRemovedRaw)) : 0;

    s.terminalFont = isTerminalFont(raw.terminalFont) ? raw.terminalFont : DEFAULT_TERMINAL_FONT;
    s.themePreset = isLookPreset(raw.themePreset) ? raw.themePreset : 'minimal';
    s.windowState = parsePersistedWindowState(raw.windowState);
    s.autoTrustFolders = typeof raw.autoTrustFolders === 'boolean' ? raw.autoTrustFolders : false;
    s.showPlans = typeof raw.showPlans === 'boolean' ? raw.showPlans : true;

    const rawOpacity = raw.inactiveColumnOpacity;
    s.inactiveColumnOpacity =
      typeof rawOpacity === 'number' && Number.isFinite(rawOpacity) && rawOpacity >= 0.3 && rawOpacity <= 1.0
        ? Math.round(rawOpacity * 100) / 100 : 0.6;

    s.editorCommand = typeof raw.editorCommand === 'string' ? (raw.editorCommand as string).trim() : '';

    if (Array.isArray(raw.customAgents)) {
      s.customAgents = (raw.customAgents as unknown[]).filter(
        (a): a is AgentDef =>
          typeof a === 'object' && a !== null &&
          typeof (a as AgentDef).id === 'string' &&
          typeof (a as AgentDef).name === 'string' &&
          typeof (a as AgentDef).command === 'string',
      );
    }

    for (const ca of s.customAgents) {
      if (!s.availableAgents.some((a) => a.id === ca.id)) {
        s.availableAgents.push(ca);
      }
    }

    for (const taskId of raw.taskOrder) {
      const pt = raw.tasks[taskId];
      if (!pt) continue;

      const agentId = crypto.randomUUID();
      const agentDef = pt.agentDef;

      if (agentDef) {
        const fresh = s.availableAgents.find((a) => a.id === agentDef.id);
        if (fresh) {
          if (!agentDef.resume_args) agentDef.resume_args = fresh.resume_args;
          if (!agentDef.skip_permissions_args) agentDef.skip_permissions_args = fresh.skip_permissions_args;
        }
      }

      const shellAgentIds: string[] = [];
      for (let i = 0; i < pt.shellCount; i++) {
        shellAgentIds.push(crypto.randomUUID());
      }

      const task: Task = {
        id: pt.id,
        name: pt.name,
        projectId: pt.projectId ?? '',
        branchName: pt.branchName,
        worktreePath: pt.worktreePath,
        agentIds: agentDef ? [agentId] : [],
        shellAgentIds,
        notes: pt.notes,
        lastPrompt: pt.lastPrompt,
        directMode: pt.directMode,
        skipPermissions: pt.skipPermissions === true,
        githubUrl: pt.githubUrl,
        savedInitialPrompt: pt.savedInitialPrompt,
      };

      s.tasks[taskId] = task;

      if (agentDef) {
        const agent: Agent = {
          id: agentId,
          taskId,
          def: agentDef,
          resumed: true,
          status: 'running',
          exitCode: null,
          signal: null,
          lastOutput: [],
          generation: 0,
        };
        s.agents[agentId] = agent;
        restoredRunningAgentIds.push(agentId);
      }
    }

    // Restore terminals
    const rawTerminals = (raw.terminals ?? {}) as Record<string, { id: string; name: string }>;
    for (const termId of raw.taskOrder) {
      const pt = rawTerminals[termId];
      if (!pt) continue;
      const agentId = crypto.randomUUID();
      s.terminals[termId] = { id: pt.id, name: pt.name, agentId };
    }

    s.taskOrder = s.taskOrder.filter((id) => s.tasks[id] || s.terminals[id]);

    // Restore collapsed tasks
    const collapsedOrder = raw.collapsedTaskOrder ?? [];
    for (const taskId of collapsedOrder) {
      const pt = raw.tasks[taskId];
      if (!pt || !pt.collapsed) continue;

      const agentDef = pt.agentDef;
      if (agentDef) {
        const fresh = s.availableAgents.find((a) => a.id === agentDef.id);
        if (fresh) {
          if (!agentDef.resume_args) agentDef.resume_args = fresh.resume_args;
          if (!agentDef.skip_permissions_args) agentDef.skip_permissions_args = fresh.skip_permissions_args;
        }
      }

      const task: Task = {
        id: pt.id,
        name: pt.name,
        projectId: pt.projectId ?? '',
        branchName: pt.branchName,
        worktreePath: pt.worktreePath,
        agentIds: [],
        shellAgentIds: [],
        notes: pt.notes,
        lastPrompt: pt.lastPrompt,
        directMode: pt.directMode,
        skipPermissions: pt.skipPermissions === true,
        githubUrl: pt.githubUrl,
        savedInitialPrompt: pt.savedInitialPrompt,
        collapsed: true,
        savedAgentDef: agentDef ?? undefined,
      };

      s.tasks[taskId] = task;
    }
    s.collapsedTaskOrder = collapsedOrder.filter((id) => s.tasks[id]);

    const activeSet = new Set(s.taskOrder);
    s.collapsedTaskOrder = s.collapsedTaskOrder.filter((id) => !activeSet.has(id));

    if (s.activeTaskId && s.tasks[s.activeTaskId]) {
      s.activeAgentId = s.tasks[s.activeTaskId].agentIds[0] ?? null;
    }
  });

  for (const agentId of restoredRunningAgentIds) {
    markAgentSpawned(agentId);
  }

  syncTerminalCounter();
}
