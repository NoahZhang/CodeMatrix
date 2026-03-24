// Zustand store — replaces SolidJS createStore.
// Uses immer middleware for produce-style mutations.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { DEFAULT_TERMINAL_FONT } from '../lib/fonts';
import { getLocalDateKey } from '../lib/date';
import type { AppStore, PanelId, PendingAction } from './types';

// --- Zustand store ---

export const useStore = create<AppStore>()(
  immer((_set) => ({
    projects: [],
    lastProjectId: null,
    lastAgentId: null,
    taskOrder: [],
    collapsedTaskOrder: [],
    tasks: {},
    terminals: {},
    agents: {},
    activeTaskId: null,
    activeAgentId: null,
    availableAgents: [],
    customAgents: [],
    showNewTaskDialog: false,
    sidebarVisible: true,
    fontScales: {},
    panelSizes: {},
    globalScale: 1,
    taskGitStatus: {},
    focusedPanel: {},
    sidebarFocused: false,
    sidebarFocusedProjectId: null,
    sidebarFocusedTaskId: null,
    placeholderFocused: false,
    placeholderFocusedButton: 'add-task',
    showHelpDialog: false,
    showSettingsDialog: false,
    pendingAction: null,
    notification: null,
    completedTaskDate: getLocalDateKey(),
    completedTaskCount: 0,
    mergedLinesAdded: 0,
    mergedLinesRemoved: 0,
    terminalFont: DEFAULT_TERMINAL_FONT,
    themePreset: 'minimal',
    windowState: null,
    autoTrustFolders: false,
    showPlans: true,
    inactiveColumnOpacity: 0.6,
    editorCommand: '',
    newTaskDropUrl: null,
    newTaskPrefillPrompt: null,
    missingProjectIds: {},
    remoteAccess: {
      enabled: false,
      token: null,
      port: 7777,
      url: null,
      wifiUrl: null,
      tailscaleUrl: null,
      connectedClients: 0,
    },
    showArena: false,
  })),
);

// --- Helper: read-only snapshot (no hook, for use outside React) ---

export function getStore(): AppStore {
  return useStore.getState();
}

export function setStore(
  recipe: (draft: AppStore) => void,
): void {
  useStore.setState(recipe);
}

// --- Shared helpers ---

/** Remove fontScales, panelSizes, focusedPanel, and taskOrder entries for a given ID.
 *  Call inside an immer callback. Returns the index the item had in taskOrder. */
export function cleanupPanelEntries(s: AppStore, id: string): number {
  const idx = s.taskOrder.indexOf(id);
  delete s.focusedPanel[id];
  const prefix = id + ':';
  for (const key of Object.keys(s.fontScales)) {
    if (key === id || key.startsWith(prefix)) delete s.fontScales[key];
  }
  for (const key of Object.keys(s.panelSizes)) {
    if (key.includes(id)) delete s.panelSizes[key];
  }
  s.taskOrder = s.taskOrder.filter((x) => x !== id);
  s.collapsedTaskOrder = s.collapsedTaskOrder.filter((x) => x !== id);
  return idx;
}

export function updateWindowTitle(_taskName?: string): void {
  // Intentionally no-op: window title text is hidden in the custom/native title bars.
}

// --- Re-exports (barrel) ---
// Components can import everything from './store/store' for convenience.

export type { PanelId, PendingAction };

// tasks.ts
export {
  createTask,
  createDirectTask,
  closeTask,
  retryCloseTask,
  mergeTask,
  pushTask,
  updateTaskName,
  updateTaskNotes,
  sendPrompt,
  setLastPrompt,
  clearInitialPrompt,
  clearPrefillPrompt,
  setPrefillPrompt,
  reorderTask,
  spawnShellForTask,
  runBookmarkInTask,
  closeShell,
  hasDirectModeTask,
  collapseTask,
  uncollapseTask,
  getGitHubDropDefaults,
  setNewTaskDropUrl,
  setNewTaskPrefillPrompt,
  setPlanContent,
} from './tasks';
export type { CreateTaskOptions, CreateDirectTaskOptions } from './tasks';

// agents.ts
export {
  loadAgents,
  addAgentToTask,
  markAgentExited,
  restartAgent,
  switchAgent,
  addCustomAgent,
  removeCustomAgent,
  updateCustomAgent,
} from './agents';

// navigation.ts
export {
  setActiveTask,
  setActiveAgent,
  navigateTask,
  navigateAgent,
  moveActiveTask,
  toggleNewTaskDialog,
} from './navigation';

// focus.ts
export {
  registerFocusFn,
  unregisterFocusFn,
  triggerFocus,
  registerAction,
  unregisterAction,
  triggerAction,
  getTaskFocusedPanel,
  setTaskFocusedPanel,
  focusSidebar,
  unfocusSidebar,
  focusPlaceholder,
  unfocusPlaceholder,
  setSidebarFocusedProjectId,
  navigateRow,
  navigateColumn,
  setPendingAction,
  clearPendingAction,
  toggleHelpDialog,
  toggleSettingsDialog,
  sendActivePrompt,
} from './focus';

// ui.ts
export {
  getFontScale,
  adjustFontScale,
  resetFontScale,
  getGlobalScale,
  adjustGlobalScale,
  resetGlobalScale,
  getPanelSize,
  setPanelSizes,
  toggleSidebar,
  setTerminalFont,
  setThemePreset,
  setAutoTrustFolders,
  setShowPlans,
  setInactiveColumnOpacity,
  setEditorCommand,
  toggleArena,
  setWindowState,
} from './ui';

// persistence.ts
export { saveState, loadState } from './persistence';

// projects.ts
export {
  PASTEL_HUES,
  randomPastelColor,
  getProject,
  addProject,
  removeProject,
  updateProject,
  getProjectBranchPrefix,
  getProjectPath,
  removeProjectWithTasks,
  pickAndAddProject,
  validateProjectPaths,
  relinkProject,
  isProjectMissing,
} from './projects';

// terminals.ts
export { createTerminal, closeTerminal, updateTerminalName, syncTerminalCounter } from './terminals';

// notification.ts
export { showNotification, clearNotification } from './notification';

// completion.ts
export {
  recordTaskCompleted,
  getCompletedTasksTodayCount,
  recordMergedLines,
  getMergedLineTotals,
} from './completion';

// taskStatus.ts
export {
  isAutoTrustSettling,
  stripAnsi,
  onAgentReady,
  offAgentReady,
  normalizeForComparison,
  looksLikeQuestion,
  isTrustQuestionAutoHandled,
  isAgentAskingQuestion,
  markAgentSpawned,
  markAgentOutput,
  getAgentOutputTail,
  isAgentIdle,
  markAgentBusy,
  clearAgentActivity,
  getTaskDotStatus,
  refreshAllTaskGitStatus,
  refreshTaskStatus,
  startTaskStatusPolling,
  rescheduleTaskStatusPolling,
  stopTaskStatusPolling,
} from './taskStatus';
export type { TaskDotStatus } from './taskStatus';

// remote.ts
export { startRemoteAccess, stopRemoteAccess, refreshRemoteStatus } from './remote';

// autosave.ts
export { setupAutosave } from './autosave';
