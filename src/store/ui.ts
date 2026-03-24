import { getStore, setStore } from './store';
import type { TerminalFont } from '../lib/fonts';
import type { LookPreset } from '../lib/look';
import type { PersistedWindowState } from './types';

// --- Font Scale (per-panel) ---

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.0;
const SCALE_STEP = 0.1;

export function getFontScale(panelId: string): number {
  return getStore().fontScales[panelId] ?? 1;
}

export function adjustFontScale(panelId: string, delta: 1 | -1): void {
  const current = getFontScale(panelId);
  const next =
    Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, current + delta * SCALE_STEP)) * 10) / 10;
  setStore((s) => {
    s.fontScales[panelId] = next;
  });
}

export function resetFontScale(panelId: string): void {
  if (panelId.includes(':')) {
    setStore((s) => {
      s.fontScales[panelId] = 1.0;
    });
  } else {
    setStore((s) => {
      const prefix = panelId + ':';
      for (const key of Object.keys(s.fontScales)) {
        if (key === panelId || key.startsWith(prefix)) s.fontScales[key] = 1.0;
      }
    });
  }
}

// --- Global Scale ---

export function getGlobalScale(): number {
  return getStore().globalScale;
}

export function adjustGlobalScale(delta: 1 | -1): void {
  const current = getStore().globalScale;
  const next =
    Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, current + delta * SCALE_STEP)) * 10) / 10;
  setStore((s) => {
    s.globalScale = next;
  });
}

export function resetGlobalScale(): void {
  setStore((s) => {
    s.globalScale = 1;
  });
}

// --- Panel Sizes ---

export function getPanelSize(key: string): number | undefined {
  return getStore().panelSizes[key];
}

export function setPanelSizes(entries: Record<string, number>): void {
  setStore((s) => {
    for (const [key, value] of Object.entries(entries)) {
      s.panelSizes[key] = value;
    }
  });
}

// --- Sidebar ---

export function toggleSidebar(): void {
  setStore((s) => {
    s.sidebarVisible = !s.sidebarVisible;
  });
}

export function setTerminalFont(terminalFont: TerminalFont): void {
  setStore((s) => {
    s.terminalFont = terminalFont;
  });
}

export function setThemePreset(themePreset: LookPreset): void {
  setStore((s) => {
    s.themePreset = themePreset;
  });
}

export function setAutoTrustFolders(autoTrustFolders: boolean): void {
  setStore((s) => {
    s.autoTrustFolders = autoTrustFolders;
  });
}

export function setShowPlans(showPlans: boolean): void {
  setStore((s) => {
    s.showPlans = showPlans;
  });
}

export function setInactiveColumnOpacity(opacity: number): void {
  setStore((s) => {
    s.inactiveColumnOpacity =
      Math.round(Math.max(0.3, Math.min(1.0, opacity)) * 100) / 100;
  });
}

export function setEditorCommand(command: string): void {
  setStore((s) => {
    s.editorCommand = command;
  });
}

export function toggleArena(show?: boolean): void {
  setStore((s) => {
    s.showArena = show ?? !s.showArena;
  });
}

export function setWindowState(windowState: PersistedWindowState): void {
  const current = getStore().windowState;
  if (
    current &&
    current.x === windowState.x &&
    current.y === windowState.y &&
    current.width === windowState.width &&
    current.height === windowState.height &&
    current.maximized === windowState.maximized
  ) {
    return;
  }
  setStore((s) => {
    s.windowState = windowState;
  });
}
