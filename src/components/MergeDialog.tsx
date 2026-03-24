import { useState, useEffect, useCallback } from 'react';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';
import { useStore, mergeTask, sendPrompt } from '../store/store';
import { ConfirmDialog } from './ConfirmDialog';
import { ChangedFilesList } from './ChangedFilesList';
import { theme } from '../lib/theme';
import type { Task } from '../store/types';
import type { ChangedFile, MergeStatus, WorktreeStatus } from '../ipc/types';

interface MergeDialogProps {
  open: boolean;
  task: Task;
  initialCleanup: boolean;
  onDone: () => void;
  onDiffFileClick: (file: ChangedFile) => void;
}

export function MergeDialog({ open, task, initialCleanup, onDone, onDiffFileClick }: MergeDialogProps) {
  const agents = useStore((s) => s.agents);
  const [mergeError, setMergeError] = useState('');
  const [merging, setMerging] = useState(false);
  const [squash, setSquash] = useState(false);
  const [cleanupAfterMerge, setCleanupAfterMerge] = useState(false);
  const [squashMessage, setSquashMessage] = useState('');
  const [rebasing, setRebasing] = useState(false);
  const [rebaseError, setRebaseError] = useState('');
  const [rebaseSuccess, setRebaseSuccess] = useState(false);

  const [branchLog, setBranchLog] = useState<string | null>(null);
  const [branchLogLoading, setBranchLogLoading] = useState(false);
  const [worktreeStatus, setWorktreeStatus] = useState<WorktreeStatus | null>(null);
  const [worktreeStatusLoading, setWorktreeStatusLoading] = useState(false);
  const [mergeStatus, setMergeStatus] = useState<MergeStatus | null>(null);
  const [mergeStatusLoading, setMergeStatusLoading] = useState(false);

  const fetchBranchLog = useCallback(() => {
    if (!task.worktreePath) return;
    setBranchLogLoading(true);
    invoke<string>(IPC.GetBranchLog, { worktreePath: task.worktreePath })
      .then(setBranchLog)
      .catch(() => setBranchLog(null))
      .finally(() => setBranchLogLoading(false));
  }, [task.worktreePath]);

  const fetchWorktreeStatus = useCallback(() => {
    if (!task.worktreePath) return;
    setWorktreeStatusLoading(true);
    invoke<WorktreeStatus>(IPC.GetWorktreeStatus, { worktreePath: task.worktreePath })
      .then(setWorktreeStatus)
      .catch(() => setWorktreeStatus(null))
      .finally(() => setWorktreeStatusLoading(false));
  }, [task.worktreePath]);

  const fetchMergeStatus = useCallback(() => {
    if (!task.worktreePath) return;
    setMergeStatusLoading(true);
    invoke<MergeStatus>(IPC.CheckMergeStatus, { worktreePath: task.worktreePath })
      .then(setMergeStatus)
      .catch(() => setMergeStatus(null))
      .finally(() => setMergeStatusLoading(false));
  }, [task.worktreePath]);

  const hasConflicts = (mergeStatus?.conflicting_files.length ?? 0) > 0;
  const hasCommittedChangesToMerge = worktreeStatus?.has_committed_changes ?? false;

  useEffect(() => {
    if (open) {
      setCleanupAfterMerge(initialCleanup);
      setSquash(false);
      setSquashMessage('');
      setMergeError('');
      setRebaseError('');
      setRebaseSuccess(false);
      setMerging(false);
      setRebasing(false);
      fetchBranchLog();
      fetchMergeStatus();
      fetchWorktreeStatus();
    }
  }, [open, initialCleanup, fetchBranchLog, fetchMergeStatus, fetchWorktreeStatus]);

  const commits = branchLog
    ? branchLog
        .split('\n')
        .filter((l: string) => l.trim())
        .map((l: string) => {
          const stripped = l.replace(/^- /, '');
          const spaceIdx = stripped.indexOf(' ');
          if (spaceIdx > 0) {
            return {
              hash: stripped.slice(0, spaceIdx),
              msg: stripped.slice(spaceIdx + 1),
            };
          }
          return { hash: '', msg: stripped };
        })
    : [];

  return (
    <ConfirmDialog
      open={open}
      title="Merge into Main"
      width="520px"
      autoFocusCancel
      message={
        <div>
          {worktreeStatus?.has_uncommitted_changes && (
            <div
              style={{
                marginBottom: '12px',
                fontSize: '12px',
                color: theme.warning,
                background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
                fontWeight: '600',
              }}
            >
              Warning: You have uncommitted changes that will NOT be included in this merge.
            </div>
          )}
          {!worktreeStatusLoading && !hasCommittedChangesToMerge && (
            <div
              style={{
                marginBottom: '12px',
                fontSize: '12px',
                color: theme.warning,
                background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
                fontWeight: '600',
              }}
            >
              Nothing to merge: this branch has no committed changes compared to main/master.
            </div>
          )}
          {mergeStatusLoading && (
            <div
              style={{
                marginBottom: '12px',
                fontSize: '12px',
                color: theme.fgMuted,
                padding: '8px 12px',
                borderRadius: '8px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
              }}
            >
              Checking for conflicts with main...
            </div>
          )}
          {!mergeStatusLoading && mergeStatus && mergeStatus.main_ahead_count > 0 && (
            <>
              <div
                style={{
                  marginBottom: '12px',
                  fontSize: '12px',
                  color: hasConflicts ? theme.error : theme.warning,
                  background: hasConflicts
                    ? `color-mix(in srgb, ${theme.error} 8%, transparent)`
                    : `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: hasConflicts
                    ? `1px solid color-mix(in srgb, ${theme.error} 20%, transparent)`
                    : `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
                  fontWeight: '600',
                }}
              >
                {!hasConflicts && (
                  <>
                    Main has {mergeStatus.main_ahead_count} new commit
                    {mergeStatus.main_ahead_count > 1 ? 's' : ''}. Rebase onto main first.
                  </>
                )}
                {hasConflicts && (
                  <>
                    <div>
                      Conflicts detected with main ({mergeStatus.conflicting_files.length} file
                      {mergeStatus.conflicting_files.length > 1 ? 's' : ''}):
                    </div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: '20px', fontWeight: '400' }}>
                      {mergeStatus.conflicting_files.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                    <div style={{ marginTop: '4px', fontWeight: '400' }}>
                      Rebase onto main to resolve conflicts.
                    </div>
                  </>
                )}
              </div>
              <div
                style={{
                  marginBottom: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <button
                  type="button"
                  disabled={rebasing || worktreeStatus?.has_uncommitted_changes}
                  onClick={async () => {
                    setRebasing(true);
                    setRebaseError('');
                    setRebaseSuccess(false);
                    try {
                      await invoke(IPC.RebaseTask, { worktreePath: task.worktreePath });
                      setRebaseSuccess(true);
                      fetchMergeStatus();
                      fetchBranchLog();
                      fetchWorktreeStatus();
                    } catch (err) {
                      setRebaseError(String(err));
                    } finally {
                      setRebasing(false);
                    }
                  }}
                  title={
                    worktreeStatus?.has_uncommitted_changes
                      ? 'Commit or stash changes before rebasing'
                      : 'Rebase onto main'
                  }
                  style={{
                    padding: '6px 14px',
                    background: theme.bgInput,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '8px',
                    color: theme.fg,
                    cursor:
                      rebasing || worktreeStatus?.has_uncommitted_changes
                        ? 'not-allowed'
                        : 'pointer',
                    fontSize: '12px',
                    opacity:
                      rebasing || worktreeStatus?.has_uncommitted_changes ? '0.5' : '1',
                  }}
                >
                  {rebasing ? 'Rebasing...' : 'Rebase onto main'}
                </button>
                {task.agentIds.length > 0 &&
                  agents[task.agentIds[0]]?.status === 'running' && (
                    <button
                      type="button"
                      onClick={() => {
                        const agentId = task.agentIds[0];
                        onDone();
                        sendPrompt(task.id, agentId, 'rebase on main branch').catch((err) => {
                          console.error('Failed to send rebase prompt:', err);
                        });
                      }}
                      title="Close dialog and ask the AI agent to rebase"
                      style={{
                        padding: '6px 14px',
                        background: theme.accent,
                        border: 'none',
                        borderRadius: '8px',
                        color: theme.accentText,
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: '600',
                      }}
                    >
                      Rebase with AI
                    </button>
                  )}
                {rebaseSuccess && (
                  <span style={{ fontSize: '12px', color: theme.success }}>
                    Rebase successful
                  </span>
                )}
                {rebaseError && (
                  <span style={{ fontSize: '12px', color: theme.error }}>{rebaseError}</span>
                )}
              </div>
            </>
          )}
          <p style={{ margin: '0 0 12px' }}>
            Merge <strong>{task.branchName}</strong> into main:
          </p>
          {!branchLogLoading && branchLog && commits.length > 0 && (
            <div
              style={{
                marginBottom: '12px',
                maxHeight: '120px',
                overflowY: 'auto',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: '11px',
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                overflow: 'hidden',
                padding: '4px 0',
              }}
            >
              {commits.map((commit, i) => (
                <div
                  key={commit.hash || i}
                  title={`${commit.hash} ${commit.msg}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '2px 8px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: theme.fg,
                  }}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    style={{ flexShrink: '0' }}
                  >
                    <circle
                      cx="5"
                      cy="5"
                      r="3"
                      fill="none"
                      stroke={theme.accent}
                      strokeWidth="1.5"
                    />
                  </svg>
                  {commit.hash && (
                    <span style={{ color: theme.fgMuted, flexShrink: '0' }}>
                      {commit.hash}
                    </span>
                  )}
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {commit.msg}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div
            style={{
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              overflow: 'hidden',
              maxHeight: '240px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <ChangedFilesList
              worktreePath={task.worktreePath}
              isActive={open}
              onFileClick={onDiffFileClick}
            />
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '12px',
              cursor: 'pointer',
              fontSize: '13px',
              color: theme.fg,
            }}
          >
            <input
              type="checkbox"
              checked={cleanupAfterMerge}
              onChange={(e) => setCleanupAfterMerge(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            Delete branch and worktree after merge
          </label>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: theme.fg,
            }}
          >
            <input
              type="checkbox"
              checked={squash}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setSquash(checked);
                if (checked && !squashMessage) {
                  const log = branchLog ?? '';
                  const msgOnly = log
                    .split('\n')
                    .map((l) => l.replace(/^- [a-f0-9]+ /, '- '))
                    .join('\n');
                  setSquashMessage(msgOnly);
                }
              }}
              style={{ cursor: 'pointer' }}
            />
            Squash commits
          </label>
          {squash && (
            <textarea
              value={squashMessage}
              onChange={(e) => setSquashMessage(e.currentTarget.value)}
              placeholder="Commit message..."
              rows={6}
              style={{
                marginTop: '8px',
                width: '100%',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                padding: '8px 10px',
                color: theme.fg,
                fontSize: '12px',
                fontFamily: "'JetBrains Mono', monospace",
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          )}
          {mergeError && (
            <div
              style={{
                marginTop: '12px',
                fontSize: '12px',
                color: theme.error,
                background: `color-mix(in srgb, ${theme.error} 8%, transparent)`,
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1px solid color-mix(in srgb, ${theme.error} 20%, transparent)`,
              }}
            >
              {mergeError}
            </div>
          )}
        </div>
      }
      confirmDisabled={merging || hasConflicts || !hasCommittedChangesToMerge}
      confirmLoading={merging}
      confirmLabel={merging ? 'Merging...' : squash ? 'Squash Merge' : 'Merge'}
      onConfirm={() => {
        const taskId = task.id;
        setMergeError('');
        setMerging(true);
        void mergeTask(taskId, {
          squash: squash,
          message: squash ? squashMessage || undefined : undefined,
          cleanup: cleanupAfterMerge,
        })
          .then(() => {
            onDone();
          })
          .catch((err) => {
            setMergeError(String(err));
          })
          .finally(() => {
            setMerging(false);
          });
      }}
      onCancel={() => {
        onDone();
        setMergeError('');
        setSquash(false);
        setCleanupAfterMerge(false);
        setSquashMessage('');
        setRebaseError('');
        setRebaseSuccess(false);
      }}
    />
  );
}
