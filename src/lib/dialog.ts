// Dialog — wraps Tauri dialog plugin.

import { confirm as tauriConfirm, open as tauriOpen } from '@tauri-apps/plugin-dialog';

interface ConfirmOptions {
  title?: string;
  kind?: 'info' | 'warning' | 'error';
  okLabel?: string;
  cancelLabel?: string;
}

export async function confirm(message: string, options?: ConfirmOptions): Promise<boolean> {
  return tauriConfirm(message, {
    title: options?.title,
    kind: options?.kind,
    okLabel: options?.okLabel,
    cancelLabel: options?.cancelLabel,
  });
}

interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
}

export async function openDialog(options?: OpenDialogOptions): Promise<string | string[] | null> {
  const result = await tauriOpen({
    directory: options?.directory,
    multiple: options?.multiple,
  });
  return result;
}
