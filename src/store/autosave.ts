import { useStore } from './store';
import { saveState } from './persistence';

/** Set up autosave using Zustand subscribe.
 *  Debounces to 1000ms to avoid thrashing disk. */
export function setupAutosave(): void {
  let timer: number | undefined;
  let lastSnapshot: string | undefined;

  useStore.subscribe((state) => {
    // Build a snapshot of all persisted fields
    const snapshot = JSON.stringify({
      projects: state.projects,
      lastProjectId: state.lastProjectId,
      lastAgentId: state.lastAgentId,
      taskOrder: state.taskOrder,
      collapsedTaskOrder: state.collapsedTaskOrder,
      activeTaskId: state.activeTaskId,
      sidebarVisible: state.sidebarVisible,
      fontScales: state.fontScales,
      panelSizes: state.panelSizes,
      globalScale: state.globalScale,
      completedTaskDate: state.completedTaskDate,
      completedTaskCount: state.completedTaskCount,
      mergedLinesAdded: state.mergedLinesAdded,
      mergedLinesRemoved: state.mergedLinesRemoved,
      terminalFont: state.terminalFont,
      themePreset: state.themePreset,
      windowState: state.windowState,
      autoTrustFolders: state.autoTrustFolders,
      showPlans: state.showPlans,
      inactiveColumnOpacity: state.inactiveColumnOpacity,
      editorCommand: state.editorCommand,
      customAgents: state.customAgents,
      tasks: Object.fromEntries(
        [...state.taskOrder, ...state.collapsedTaskOrder]
          .filter((id) => state.tasks[id])
          .map((id) => {
            const t = state.tasks[id];
            return [
              id,
              {
                notes: t.notes,
                lastPrompt: t.lastPrompt,
                name: t.name,
                directMode: t.directMode,
                savedInitialPrompt: t.savedInitialPrompt,
                collapsed: t.collapsed,
              },
            ];
          }),
      ),
      terminals: Object.fromEntries(
        state.taskOrder
          .filter((id) => state.terminals[id])
          .map((id) => [id, { name: state.terminals[id].name }]),
      ),
    });

    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;

    clearTimeout(timer);
    timer = window.setTimeout(() => saveState(), 1000);
  });
}
