import { useState } from 'react';
import { getArenaStore } from './store';
import type { BattleCompetitor } from './types';

interface CommitDialogProps {
  target: BattleCompetitor;
  hasCommitted: boolean;
  onCommitAndMerge: (message: string) => void;
  onDiscardAndMerge: () => void;
  onCancel: () => void;
}

export function CommitDialog({ target, hasCommitted, onCommitAndMerge, onDiscardAndMerge, onCancel }: CommitDialogProps) {
  const promptSnippet = (() => {
    const p = getArenaStore().prompt;
    return p.slice(0, 50) + (p.length > 50 ? '...' : '');
  })();

  const [commitMsg, setCommitMsg] = useState(
    () => `arena: ${target.name} — ${promptSnippet}`,
  );

  return (
    <div className="arena-commit-overlay" onClick={() => onCancel()}>
      <div className="arena-commit-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="arena-commit-title">{target.name} has uncommitted changes</div>
        <label className="arena-commit-label">
          Commit message
          <input
            className="arena-commit-input"
            type="text"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && commitMsg.trim()) onCommitAndMerge(commitMsg);
            }}
            autoFocus
          />
        </label>
        <div className="arena-commit-actions">
          <button
            className="arena-merge-btn"
            disabled={!commitMsg.trim()}
            onClick={() => onCommitAndMerge(commitMsg)}
          >
            Commit &amp; Merge
          </button>
          {hasCommitted && (
            <button className="arena-close-btn" onClick={() => onDiscardAndMerge()}>
              Discard uncommitted &amp; Merge
            </button>
          )}
          <button className="arena-close-btn" onClick={() => onCancel()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
