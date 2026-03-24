// Core IPC — wraps Tauri's invoke/event system for frontend-backend communication.

import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Channel<T> — streaming channel for data pushed from the Rust backend.
 * The backend emits events to `channel:{id}` which this class listens to.
 */
export class Channel<T> {
  private _id = crypto.randomUUID();
  private _unlisten: UnlistenFn | null = null;
  onmessage: ((msg: T) => void) | null = null;

  async init(): Promise<void> {
    this._unlisten = await listen<T>(`channel:${this._id}`, (event) => {
      this.onmessage?.(event.payload);
    });
  }

  dispose(): void {
    this._unlisten?.();
    this._unlisten = null;
  }

  get id(): string {
    return this._id;
  }

  toJSON(): { __CHANNEL_ID__: string } {
    return { __CHANNEL_ID__: this._id };
  }
}

/**
 * Invoke a Tauri command and return the result.
 * JSON round-trip serialization ensures Channel instances are replaced with
 * plain { __CHANNEL_ID__: id } objects via toJSON().
 */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const safeArgs = args ? (JSON.parse(JSON.stringify(args)) as Record<string, unknown>) : undefined;
  return tauriInvoke<T>(cmd, safeArgs);
}

/**
 * Invoke a Tauri command without awaiting the result.
 * Logs errors to console and optionally calls onError.
 */
export function fireAndForget(
  cmd: string,
  args?: Record<string, unknown>,
  onError?: (err: unknown) => void,
): void {
  invoke(cmd, args).catch((err: unknown) => {
    console.error(`[IPC] ${cmd} failed:`, err);
    onError?.(err);
  });
}

export { listen };
export type { UnlistenFn };
