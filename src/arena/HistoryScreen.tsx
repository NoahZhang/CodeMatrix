import { useState, useEffect } from 'react';
import { useArenaStore, getArenaStore, setPhase, loadBattleFromHistory, deleteHistoryMatch } from './store';
import { saveArenaHistory } from './persistence';
import { formatDuration } from './utils';
import { confirm } from '../lib/dialog';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTimeMs(ms: number | null): string {
  if (ms === null) return 'DNF';
  return formatDuration(ms);
}

function renderStars(rating: number | null): string {
  if (rating === null) return '';
  const clamped = Math.max(0, Math.min(5, Math.floor(rating)));
  return '\u2605'.repeat(clamped) + '\u2606'.repeat(5 - clamped);
}

export function HistoryScreen() {
  const [worktreeStatus, setWorktreeStatus] = useState<Record<string, boolean>>({});
  const [deleting, setDeleting] = useState<string | null>(null);

  const historyItems = useArenaStore((s) => s.history);
  const previousPhase = useArenaStore((s) => s.previousPhase);

  useEffect(() => {
    void checkWorktrees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkWorktrees() {
    const state = getArenaStore();
    const entries = await Promise.all(
      state.history.map(async (match) => {
        for (const c of match.competitors) {
          if (c.worktreePath && !c.merged) {
            try {
              const exists = await invoke<boolean>(IPC.CheckPathExists, { path: c.worktreePath });
              if (exists) return [match.id, true] as const;
            } catch {
              // Treat IPC failure as not existing
            }
          }
        }
        return [match.id, false] as const;
      }),
    );
    setWorktreeStatus(Object.fromEntries(entries));
  }

  function handleRowClick(match: (typeof historyItems)[0]) {
    loadBattleFromHistory(match);
  }

  async function handleDelete(e: React.MouseEvent, matchId: string) {
    e.stopPropagation();
    const ok = await confirm('Delete this match? Any remaining worktrees will be removed.');
    if (!ok) return;
    setDeleting(matchId);
    try {
      await deleteHistoryMatch(matchId);
      void saveArenaHistory();
      setWorktreeStatus((prev) => {
        const { [matchId]: _, ...next } = prev;
        return next;
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="arena-history">
      <div className="arena-config-actions">
        <button
          className="arena-close-btn"
          onClick={() => setPhase(previousPhase ?? 'config')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back
        </button>
      </div>

      {historyItems.length > 0 ? (
        historyItems.map((match) => (
          <div
            key={match.id}
            className="arena-history-row"
            data-has-worktrees={worktreeStatus[match.id] ? '' : undefined}
            onClick={() => handleRowClick(match)}
            style={{ cursor: 'pointer' }}
          >
            <div className="arena-history-row-top">
              <span>{formatDate(match.date)}</span>
              <div className="arena-history-row-actions">
                {worktreeStatus[match.id] && (
                  <span className="arena-history-badge">View Results</span>
                )}
                <button
                  className="arena-history-delete-btn"
                  disabled={deleting === match.id}
                  onClick={(e) => void handleDelete(e, match.id)}
                  title="Delete match and clean up worktrees"
                >
                  {deleting === match.id ? (
                    <span>...</span>
                  ) : (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div className="arena-history-row-prompt">{match.prompt}</div>
            <div className="arena-history-row-competitors">
              {match.competitors
                .map((c) => {
                  const stars = renderStars(c.rating);
                  const time = formatTimeMs(c.timeMs);
                  return `${c.name} ${time}${stars ? ` ${stars}` : ''}`;
                })
                .join('  \u00B7  ')}
            </div>
          </div>
        ))
      ) : (
        <div className="arena-history-empty">No matches yet. Go fight!</div>
      )}
    </div>
  );
}
