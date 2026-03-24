import { useState, useEffect } from 'react';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';
import { closeTask, getProject } from '../store/store';
import { ConfirmDialog } from './ConfirmDialog';
import { theme } from '../lib/theme';
import type { Task } from '../store/types';
import type { WorktreeStatus } from '../ipc/types';

interface CloseTaskDialogProps {
  open: boolean;
  task: Task;
  onDone: () => void;
}

export function CloseTaskDialog({ open, task, onDone }: CloseTaskDialogProps) {
  const [worktreeStatus, setWorktreeStatus] = useState<WorktreeStatus | null>(null);

  useEffect(() => {
    if (!open || task.directMode) {
      setWorktreeStatus(null);
      return;
    }
    let cancelled = false;
    invoke<WorktreeStatus>(IPC.GetWorktreeStatus, { worktreePath: task.worktreePath }).then(
      (result) => {
        if (!cancelled) setWorktreeStatus(result);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, task.directMode, task.worktreePath]);

  return (
    <ConfirmDialog
      open={open}
      title="Close Task"
      message={
        <div>
          {task.directMode && (
            <p style={{ margin: '0' }}>
              This will stop all running agents and shells for this task. No git operations will be
              performed.
            </p>
          )}
          {!task.directMode && (
            <>
              {(worktreeStatus?.has_uncommitted_changes || worktreeStatus?.has_committed_changes) && (
                <div
                  style={{
                    marginBottom: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {worktreeStatus?.has_uncommitted_changes && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: theme.warning,
                        background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
                        fontWeight: '600',
                      }}
                    >
                      Warning: There are uncommitted changes that will be permanently lost.
                    </div>
                  )}
                  {worktreeStatus?.has_committed_changes && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: theme.warning,
                        background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
                        fontWeight: '600',
                      }}
                    >
                      Warning: This branch has commits that have not been merged into main.
                    </div>
                  )}
                </div>
              )}
              {(() => {
                const project = getProject(task.projectId);
                const willDeleteBranch = project?.deleteBranchOnClose ?? true;
                return (
                  <>
                    <p style={{ margin: '0 0 8px' }}>
                      {willDeleteBranch
                        ? 'This action cannot be undone. The following will be permanently deleted:'
                        : 'The worktree will be removed but the branch will be kept:'}
                    </p>
                    <ul
                      style={{
                        margin: '0',
                        paddingLeft: '20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      {willDeleteBranch && (
                        <li>
                          Local feature branch <strong>{task.branchName}</strong>
                        </li>
                      )}
                      <li>
                        Worktree at <strong>{task.worktreePath}</strong>
                      </li>
                      {!willDeleteBranch && (
                        <li style={{ color: theme.fgMuted }}>
                          Branch <strong>{task.branchName}</strong> will be kept
                        </li>
                      )}
                    </ul>
                  </>
                );
              })()}
            </>
          )}
        </div>
      }
      confirmLabel={task.directMode ? 'Close' : 'Delete'}
      danger={!task.directMode}
      onConfirm={() => {
        onDone();
        closeTask(task.id);
      }}
      onCancel={() => onDone()}
    />
  );
}
