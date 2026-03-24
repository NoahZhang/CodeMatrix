import { openDialog } from '../lib/dialog';
import { invoke } from '../lib/ipc';
import { getStore, setStore } from './store';
import { closeTask } from './tasks';
import type { Project } from './types';
import { sanitizeBranchPrefix } from '../lib/branch-name';

export const PASTEL_HUES = [0, 30, 60, 120, 180, 210, 260, 300, 330];

export function randomPastelColor(): string {
  const hue = PASTEL_HUES[Math.floor(Math.random() * PASTEL_HUES.length)];
  return `hsl(${hue}, 70%, 75%)`;
}

export function getProject(projectId: string): Project | undefined {
  return getStore().projects.find((p) => p.id === projectId);
}

export function addProject(name: string, path: string): string {
  const id = crypto.randomUUID();
  const color = randomPastelColor();
  const project: Project = { id, name, path, color };
  setStore((s) => {
    s.projects.push(project);
    s.lastProjectId = id;
  });
  return id;
}

export function removeProject(projectId: string): void {
  const s = getStore();
  const allTaskIds = [...s.taskOrder, ...s.collapsedTaskOrder];
  const hasLinkedTasks = allTaskIds.some((tid) => s.tasks[tid]?.projectId === projectId);
  if (hasLinkedTasks) {
    console.warn(
      'removeProject: skipped — tasks still reference this project. Use removeProjectWithTasks.',
    );
    return;
  }

  setStore((s) => {
    s.projects = s.projects.filter((p) => p.id !== projectId);
    if (s.lastProjectId === projectId) {
      s.lastProjectId = s.projects[0]?.id ?? null;
    }
    delete s.missingProjectIds[projectId];
  });
}

export function updateProject(
  projectId: string,
  updates: Partial<
    Pick<
      Project,
      | 'name'
      | 'color'
      | 'branchPrefix'
      | 'deleteBranchOnClose'
      | 'defaultDirectMode'
      | 'terminalBookmarks'
    >
  >,
): void {
  setStore((s) => {
    const idx = s.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return;
    if (updates.name !== undefined) s.projects[idx].name = updates.name;
    if (updates.color !== undefined) s.projects[idx].color = updates.color;
    if (updates.branchPrefix !== undefined)
      s.projects[idx].branchPrefix = sanitizeBranchPrefix(updates.branchPrefix);
    if (updates.deleteBranchOnClose !== undefined)
      s.projects[idx].deleteBranchOnClose = updates.deleteBranchOnClose;
    if (updates.defaultDirectMode !== undefined)
      s.projects[idx].defaultDirectMode = updates.defaultDirectMode;
    if (updates.terminalBookmarks !== undefined)
      s.projects[idx].terminalBookmarks = updates.terminalBookmarks;
  });
}

export function getProjectBranchPrefix(projectId: string): string {
  const raw = getStore().projects.find((p) => p.id === projectId)?.branchPrefix ?? 'task';
  return sanitizeBranchPrefix(raw);
}

export function getProjectPath(projectId: string): string | undefined {
  return getStore().projects.find((p) => p.id === projectId)?.path;
}

export async function removeProjectWithTasks(projectId: string): Promise<void> {
  const s = getStore();
  const taskIds = s.taskOrder.filter((tid) => s.tasks[tid]?.projectId === projectId);
  const collapsedTaskIds = s.collapsedTaskOrder.filter(
    (tid) => s.tasks[tid]?.projectId === projectId,
  );

  for (const tid of taskIds) {
    await closeTask(tid);
  }
  for (const tid of collapsedTaskIds) {
    await closeTask(tid);
  }

  const s2 = getStore();
  const allTaskIds = [...taskIds, ...collapsedTaskIds];
  const hasRemainingTasks = allTaskIds.some((tid) => s2.tasks[tid]?.projectId === projectId);
  if (hasRemainingTasks) return;

  removeProject(projectId);
}

export async function pickAndAddProject(): Promise<string | null> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (!selected) return null;
  const path = selected as string;
  const segments = path.split('/');
  const name = segments[segments.length - 1] || path;
  return addProject(name, path);
}

export async function validateProjectPaths(): Promise<void> {
  const s = getStore();
  const missing: Record<string, true> = {};
  for (const project of s.projects) {
    try {
      const exists = await invoke<boolean>('check_path_exists', { path: project.path });
      if (!exists) missing[project.id] = true;
    } catch {
      missing[project.id] = true;
    }
  }
  setStore((s) => {
    s.missingProjectIds = missing;
  });
}

export async function relinkProject(projectId: string): Promise<boolean> {
  const selected = await openDialog({ directory: true, multiple: false });
  if (!selected) return false;
  const newPath = selected as string;

  setStore((s) => {
    const idx = s.projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return;
    s.projects[idx].path = newPath;
  });

  const exists = await invoke<boolean>('check_path_exists', { path: newPath });
  if (exists) {
    setStore((s) => {
      delete s.missingProjectIds[projectId];
    });
  }
  return exists;
}

export function isProjectMissing(projectId: string): boolean {
  return projectId in getStore().missingProjectIds;
}
