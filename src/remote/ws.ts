import { useSyncExternalStore } from 'react';
import { getToken, clearToken } from './auth';
import type { ServerMessage, RemoteAgent } from './protocol';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

// --- Module-level state (external store for React) ---

let _agents: RemoteAgent[] = [];
let _status: ConnectionStatus = 'disconnected';

const agentSubscribers = new Set<() => void>();
const statusSubscribers = new Set<() => void>();

function notifyAgents() {
  agentSubscribers.forEach((fn) => fn());
}
function notifyStatus() {
  statusSubscribers.forEach((fn) => fn());
}

function setAgents(updater: RemoteAgent[] | ((prev: RemoteAgent[]) => RemoteAgent[])) {
  _agents = typeof updater === 'function' ? updater(_agents) : updater;
  notifyAgents();
}

function setStatus(value: ConnectionStatus) {
  _status = value;
  notifyStatus();
}

// --- React hooks for consuming state ---

export function useAgents(): RemoteAgent[] {
  return useSyncExternalStore(
    (cb) => {
      agentSubscribers.add(cb);
      return () => {
        agentSubscribers.delete(cb);
      };
    },
    () => _agents,
  );
}

export function useStatus(): ConnectionStatus {
  return useSyncExternalStore(
    (cb) => {
      statusSubscribers.add(cb);
      return () => {
        statusSubscribers.delete(cb);
      };
    },
    () => _status,
  );
}

// --- Output/scrollback listeners ---

type OutputListener = (data: string) => void;
type ScrollbackListener = (data: string, cols: number) => void;
const outputListeners = new Map<string, Set<OutputListener>>();
const scrollbackListeners = new Map<string, Set<ScrollbackListener>>();

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connect(): void {
  // Allow reconnect when existing socket is closing (not just null)
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws = null;
  }

  const token = getToken();
  if (!token) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;

  setStatus('connecting');
  ws = new WebSocket(url);

  ws.onopen = () => {
    // Authenticate via first message instead of URL query to avoid
    // token leaking in proxy logs or browser history.
    send({ type: 'auth', token });
    setStatus('connected');
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Re-subscribe to agents with active listeners (lost on disconnect)
    for (const [agentId, set] of outputListeners) {
      if (set.size > 0) send({ type: 'subscribe', agentId });
    }
  };

  ws.onmessage = (event) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }

    switch (msg.type) {
      case 'agents':
        setAgents(msg.list);
        break;

      case 'output': {
        const listeners = outputListeners.get(msg.agentId);
        listeners?.forEach((fn) => fn(msg.data));
        break;
      }

      case 'scrollback': {
        const listeners = scrollbackListeners.get(msg.agentId);
        listeners?.forEach((fn) => fn(msg.data, msg.cols));
        break;
      }

      case 'status':
        setAgents((prev) =>
          prev.map((a) =>
            a.agentId === msg.agentId ? { ...a, status: msg.status, exitCode: msg.exitCode } : a,
          ),
        );
        break;
    }
  };

  ws.onclose = (event) => {
    ws = null;
    setStatus('disconnected');
    // 4001 = server rejected auth — token is stale, reload to re-auth
    if (event.code === 4001) {
      clearToken();
      window.location.reload();
      return;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
  setStatus('disconnected');
}

export function send(msg: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function subscribeAgent(agentId: string): void {
  send({ type: 'subscribe', agentId });
}

export function unsubscribeAgent(agentId: string): void {
  send({ type: 'unsubscribe', agentId });
}

export function onOutput(agentId: string, fn: OutputListener): () => void {
  let listeners = outputListeners.get(agentId);
  if (!listeners) {
    listeners = new Set();
    outputListeners.set(agentId, listeners);
  }
  listeners.add(fn);
  return () => {
    const set = outputListeners.get(agentId);
    set?.delete(fn);
    if (set?.size === 0) outputListeners.delete(agentId);
  };
}

export function onScrollback(agentId: string, fn: ScrollbackListener): () => void {
  let listeners = scrollbackListeners.get(agentId);
  if (!listeners) {
    listeners = new Set();
    scrollbackListeners.set(agentId, listeners);
  }
  listeners.add(fn);
  return () => {
    const set = scrollbackListeners.get(agentId);
    set?.delete(fn);
    if (set?.size === 0) scrollbackListeners.delete(agentId);
  };
}

export function sendInput(agentId: string, data: string): void {
  send({ type: 'input', agentId, data });
}

export function sendKill(agentId: string): void {
  send({ type: 'kill', agentId });
}
