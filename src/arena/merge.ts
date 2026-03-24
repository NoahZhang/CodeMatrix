import { useState, useCallback } from 'react';
import { getArenaStore, markBranchMerged } from './store';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';
import type { BattleCompetitor } from './types';

type WorktreeStatus = { hasCommitted: boolean; hasUncommitted: boolean };

/** Creates merge workflow state and handlers for the results screen */
export function useMergeWorkflow() {
  const [mergedId, setMergedId] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [worktreeStatus, setWorktreeStatus] = useState<Record<string, WorktreeStatus>>({});
  const [commitTarget, setCommitTarget] = useState<BattleCompetitor | null>(null);

  const loadWorktreeStatuses = useCallback((): void => {
    const state = getArenaStore();
    for (const c of state.battle) {
      if (!c.worktreePath) continue;
      invoke<{ has_committed_changes: boolean; has_uncommitted_changes: boolean }>(
        IPC.GetWorktreeStatus,
        { worktreePath: c.worktreePath },
      )
        .then((status) => {
          if (status.has_committed_changes || status.has_uncommitted_changes) {
            setWorktreeStatus((prev) => ({
              ...prev,
              [c.id]: {
                hasCommitted: status.has_committed_changes,
                hasUncommitted: status.has_uncommitted_changes,
              },
            }));
          }
        })
        .catch((e) => console.warn('Failed to get worktree status:', c.id, e));
    }
  }, []);

  const hasChanges = useCallback(
    (id: string): boolean => {
      const s = worktreeStatus[id];
      return !!s && (s.hasCommitted || s.hasUncommitted);
    },
    [worktreeStatus],
  );

  async function doMerge(competitor: BattleCompetitor): Promise<void> {
    if (!competitor.worktreePath || !competitor.branchName) return;
    setMerging(true);
    setMergeError(null);
    try {
      const state = getArenaStore();
      const status = await invoke<{ main_ahead_count: number; conflicting_files: string[] }>(
        IPC.CheckMergeStatus,
        { worktreePath: competitor.worktreePath },
      );
      if (status.conflicting_files.length > 0) {
        setMergeError(`Conflicts in: ${status.conflicting_files.join(', ')}`);
        return;
      }
      const promptSnippet =
        state.prompt.slice(0, 60) + (state.prompt.length > 60 ? '...' : '');
      await invoke(IPC.MergeTask, {
        projectRoot: state.cwd,
        branchName: competitor.branchName,
        squash: true,
        message: `arena: merge ${competitor.name} — ${promptSnippet}`,
        cleanup: true,
      });
      setMergedId(competitor.id);
      markBranchMerged(competitor.id);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : String(e));
    } finally {
      setMerging(false);
    }
  }

  const handleMergeClick = useCallback(
    (competitor: BattleCompetitor): void => {
      const status = worktreeStatus[competitor.id];
      if (status?.hasUncommitted) {
        setCommitTarget(competitor);
      } else {
        void doMerge(competitor);
      }
    },
    [worktreeStatus],
  );

  async function commitAndMerge(message: string): Promise<void> {
    if (!commitTarget?.worktreePath) return;
    const competitor = commitTarget;
    setCommitTarget(null);
    setMerging(true);
    setMergeError(null);
    try {
      await invoke(IPC.CommitAll, {
        worktreePath: competitor.worktreePath,
        message,
      });
      await doMerge(competitor);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : String(e));
      setMerging(false);
    }
  }

  async function discardAndMerge(): Promise<void> {
    if (!commitTarget?.worktreePath) return;
    const competitor = commitTarget;
    setCommitTarget(null);
    setMerging(true);
    setMergeError(null);
    try {
      await invoke(IPC.DiscardUncommitted, { worktreePath: competitor.worktreePath });
      await doMerge(competitor);
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : String(e));
      setMerging(false);
    }
  }

  return {
    mergedId,
    merging,
    mergeError,
    worktreeStatus,
    commitTarget,
    hasChanges,
    handleMergeClick,
    commitAndMerge,
    discardAndMerge,
    loadWorktreeStatuses,
    dismissCommitDialog: () => setCommitTarget(null),
  };
}
