// Shell operations — wraps Tauri shell plugin.

import { open as shellOpen } from '@tauri-apps/plugin-shell';

export async function revealItemInDir(filePath: string): Promise<void> {
  await shellOpen(filePath);
}

export async function openFileInEditor(worktreePath: string, filePath: string): Promise<void> {
  // Open the file path in the default application
  const fullPath = `${worktreePath}/${filePath}`;
  await shellOpen(fullPath);
}

export async function openInEditor(editorCommand: string, worktreePath: string): Promise<void> {
  if (!editorCommand) return;
  const { Command } = await import('@tauri-apps/plugin-shell');
  try {
    await Command.create('exec-sh', ['-c', `${editorCommand} "${worktreePath}"`]).execute();
  } catch (e) {
    console.error('Failed to open in editor:', e);
  }
}
