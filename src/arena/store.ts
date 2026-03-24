import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';
import type {
  ArenaStore,
  ArenaPhase,
  ArenaCompetitor,
  ArenaPreset,
  ArenaMatch,
  BattleCompetitor,
} from './types';

export const MAX_COMPETITORS = 4;
export const MIN_COMPETITORS = 2;

function makeEmptyCompetitor(): ArenaCompetitor {
  return { id: crypto.randomUUID(), name: '', command: '' };
}

export const useArenaStore = create<ArenaStore>()(
  immer((_set) => ({
    phase: 'config',
    previousPhase: null,
    competitors: [makeEmptyCompetitor(), makeEmptyCompetitor()],
    prompt: '',
    cwd: '',
    presets: [],
    history: [],
    battle: [],
    selectedHistoryMatch: null,
    battleSaved: false,
  })),
);

/** Read-only snapshot (no hook, for use outside React components) */
export function getArenaStore(): ArenaStore {
  return useArenaStore.getState();
}

function setArenaStore(recipe: (draft: ArenaStore) => void): void {
  useArenaStore.setState(recipe);
}

// --- Phase ---

export function setPhase(phase: ArenaPhase): void {
  setArenaStore((s) => {
    if (phase === 'history') {
      s.previousPhase = s.phase;
    }
    s.phase = phase;
  });
}

// --- Competitors ---

export function updateCompetitor(
  id: string,
  update: Partial<Pick<ArenaCompetitor, 'name' | 'command'>>,
): void {
  setArenaStore((s) => {
    const c = s.competitors.find((c) => c.id === id);
    if (c) Object.assign(c, update);
  });
}

export function addCompetitor(): void {
  const state = getArenaStore();
  if (state.competitors.length >= MAX_COMPETITORS) return;
  setArenaStore((s) => {
    s.competitors.push(makeEmptyCompetitor());
  });
}

export function removeCompetitor(id: string): void {
  const state = getArenaStore();
  if (state.competitors.length <= MIN_COMPETITORS) return;
  setArenaStore((s) => {
    s.competitors = s.competitors.filter((c) => c.id !== id);
  });
}

// --- Prompt ---

export function setPrompt(prompt: string): void {
  setArenaStore((s) => {
    s.prompt = prompt;
  });
}

export function setCwd(cwd: string): void {
  setArenaStore((s) => {
    s.cwd = cwd;
  });
}

// --- Battle ---

export function startBattle(competitors: BattleCompetitor[]): void {
  setArenaStore((s) => {
    s.battle = competitors;
    s.phase = 'countdown';
  });
}

export function markBattleCompetitorExited(agentId: string, exitCode: number | null): void {
  setArenaStore((s) => {
    const c = s.battle.find((c) => c.agentId === agentId);
    if (c) {
      c.status = 'exited';
      c.endTime = Date.now();
      c.exitCode = exitCode;
    }
  });
}

export function allBattleFinished(): boolean {
  const state = getArenaStore();
  return state.battle.length > 0 && state.battle.every((c) => c.status === 'exited');
}

// --- Terminal output ---

export function setTerminalOutput(competitorId: string, output: string): void {
  setArenaStore((s) => {
    const c = s.battle.find((c) => c.id === competitorId);
    if (c) c.terminalOutput = output;
  });
}

// --- Merge ---

export function markBranchMerged(competitorId: string): void {
  setArenaStore((s) => {
    const c = s.battle.find((c) => c.id === competitorId);
    if (c) c.merged = true;
  });
}

// --- Battle saved ---

export function setBattleSaved(saved: boolean): void {
  setArenaStore((s) => {
    s.battleSaved = saved;
  });
}

// --- Worktree cleanup ---

export async function cleanupBattleWorktrees(): Promise<void> {
  const state = getArenaStore();
  if (!state.cwd) return;
  if (state.battleSaved) return; // Preserved for history viewing
  for (const c of state.battle) {
    // Skip already-merged competitors — mergeTask with cleanup:true already removed the worktree/branch
    if (c.branchName && !c.merged) {
      try {
        await invoke(IPC.RemoveArenaWorktree, {
          projectRoot: state.cwd,
          branchName: c.branchName,
        });
      } catch (e) {
        console.warn('Failed to remove arena worktree:', c.branchName, e);
      }
    }
  }
}

// --- History ---

export function addMatchToHistory(match: ArenaMatch): void {
  setArenaStore((s) => {
    s.history.unshift(match);
  });
}

export function setSelectedHistoryMatch(match: ArenaMatch | null): void {
  setArenaStore((s) => {
    s.selectedHistoryMatch = match;
  });
}

export function updateHistoryRating(
  matchId: string,
  competitorIndex: number,
  rating: number,
): void {
  setArenaStore((s) => {
    const m = s.history.find((m) => m.id === matchId);
    if (m && m.competitors[competitorIndex]) {
      m.competitors[competitorIndex].rating = rating;
    }
  });
}

// --- Presets ---

export function loadPresets(presets: ArenaPreset[]): void {
  setArenaStore((s) => {
    s.presets = presets;
  });
}

export function loadHistory(history: ArenaMatch[]): void {
  setArenaStore((s) => {
    s.history = history;
  });
}

export function loadBattleFromHistory(match: ArenaMatch): void {
  // Use startTime=0 and endTime=duration so (endTime - startTime) yields the
  // correct duration for display and sorting in ResultsScreen.
  const battle: BattleCompetitor[] = match.competitors.map((c, i) => ({
    id: `history-${match.id}-${i}`,
    name: c.name,
    command: c.command,
    agentId: '',
    status: 'exited' as const,
    startTime: 0,
    endTime: c.timeMs,
    exitCode: c.exitCode,
    worktreePath: c.worktreePath,
    branchName: c.branchName,
    merged: c.merged,
    terminalOutput: c.terminalOutput ?? undefined,
  }));
  setArenaStore((s) => {
    s.battle = battle;
    s.cwd = match.cwd ?? '';
    s.prompt = match.prompt;
    s.selectedHistoryMatch = match;
    s.battleSaved = true;
    s.phase = 'results';
  });
}

export function returnToHistory(): void {
  setArenaStore((s) => {
    s.selectedHistoryMatch = null;
    s.battle = [];
    s.phase = 'history';
  });
}

export async function deleteHistoryMatch(matchId: string): Promise<void> {
  const state = getArenaStore();
  const match = state.history.find((m) => m.id === matchId);
  if (!match) return;

  const cwd = match.cwd;
  if (cwd) {
    for (const c of match.competitors) {
      if (c.branchName && !c.merged) {
        try {
          await invoke(IPC.RemoveArenaWorktree, {
            projectRoot: cwd,
            branchName: c.branchName,
          });
        } catch (e) {
          console.warn('Failed to remove history worktree:', c.branchName, e);
        }
      }
    }
  }

  setArenaStore((s) => {
    s.history = s.history.filter((m) => m.id !== matchId);
  });
}

export function applyPreset(preset: ArenaPreset): void {
  const competitors: ArenaCompetitor[] = preset.competitors.map((c) => ({
    id: crypto.randomUUID(),
    name: c.name,
    command: c.command,
  }));
  setArenaStore((s) => {
    s.competitors = competitors;
  });
}

export function saveCurrentAsPreset(name: string): void {
  const state = getArenaStore();
  const preset: ArenaPreset = {
    id: crypto.randomUUID(),
    name,
    competitors: state.competitors
      .filter((c) => c.name.trim() && c.command.trim())
      .map((c) => ({ name: c.name, command: c.command })),
  };
  setArenaStore((s) => {
    s.presets.push(preset);
  });
}

export function deletePreset(id: string): void {
  setArenaStore((s) => {
    s.presets = s.presets.filter((p) => p.id !== id);
  });
}

// --- Reset ---

async function killRunningBattleAgents(): Promise<void> {
  const state = getArenaStore();
  for (const c of state.battle) {
    if (c.status === 'running' && c.agentId) {
      try {
        await invoke(IPC.KillAgent, { agentId: c.agentId });
      } catch {
        /* agent already exited */
      }
    }
  }
}

export async function resetForNewMatch(): Promise<void> {
  await killRunningBattleAgents();
  await cleanupBattleWorktrees();
  setArenaStore((s) => {
    s.battleSaved = false;
    s.phase = 'config';
    s.battle = [];
    s.competitors = [makeEmptyCompetitor(), makeEmptyCompetitor()];
    s.prompt = '';
    s.cwd = '';
    s.selectedHistoryMatch = null;
  });
}

export async function resetForRematch(): Promise<void> {
  await killRunningBattleAgents();
  await cleanupBattleWorktrees();
  setArenaStore((s) => {
    s.battleSaved = false;
    s.phase = 'config';
    s.battle = [];
    s.selectedHistoryMatch = null;
  });
}

// --- Validation ---

export function canFight(): boolean {
  const state = getArenaStore();
  const filled = state.competitors.filter((c) => c.name.trim() !== '' && c.command.trim() !== '');
  return filled.length >= MIN_COMPETITORS && state.prompt.trim() !== '' && state.cwd !== '';
}
