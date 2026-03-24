import { invoke } from '../lib/ipc';
import { setStore } from './store';

interface ServerResult {
  url: string;
  wifiUrl: string | null;
  tailscaleUrl: string | null;
  token: string;
  port: number;
}

let stopGeneration = 0;

export async function startRemoteAccess(port?: number): Promise<ServerResult> {
  const result = await invoke<ServerResult>('start_remote_server', port ? { port } : {});
  setStore((s) => {
    s.remoteAccess = {
      enabled: true,
      token: result.token,
      port: result.port,
      url: result.url,
      wifiUrl: result.wifiUrl,
      tailscaleUrl: result.tailscaleUrl,
      connectedClients: 0,
    };
  });
  return result;
}

export async function stopRemoteAccess(): Promise<void> {
  stopGeneration++;
  await invoke('stop_remote_server');
  setStore((s) => {
    s.remoteAccess = {
      enabled: false,
      token: null,
      port: 7777,
      url: null,
      wifiUrl: null,
      tailscaleUrl: null,
      connectedClients: 0,
    };
  });
}

export async function refreshRemoteStatus(): Promise<void> {
  const gen = stopGeneration;
  const result = await invoke<{
    running: boolean;
    connectedClients: number;
    url?: string;
    wifiUrl?: string;
    tailscaleUrl?: string;
    token?: string;
    port?: number;
  }>('get_remote_status');

  if (gen !== stopGeneration) return;

  if (result.running) {
    setStore((s) => {
      s.remoteAccess = {
        enabled: true,
        connectedClients: result.connectedClients,
        url: result.url ?? null,
        wifiUrl: result.wifiUrl ?? null,
        tailscaleUrl: result.tailscaleUrl ?? null,
        token: result.token ?? null,
        port: result.port ?? 7777,
      };
    });
  } else {
    setStore((s) => {
      s.remoteAccess.enabled = false;
      s.remoteAccess.connectedClients = 0;
    });
  }
}
