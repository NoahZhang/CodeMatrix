import { useMemo, useState, useEffect } from 'react';
import { ChangedFilesList } from '../components/ChangedFilesList';
import { DiffViewerDialog } from '../components/DiffViewerDialog';
import { CommitDialog } from './CommitDialog';
import { useMergeWorkflow } from './merge';
import {
  useArenaStore,
  getArenaStore,
  addMatchToHistory,
  updateHistoryRating,
  resetForNewMatch,
  resetForRematch,
  setPhase,
  setBattleSaved,
  returnToHistory,
} from './store';
import { saveArenaHistory } from './persistence';
import { formatDuration } from './utils';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';
import { useStore, toggleNewTaskDialog, toggleArena, setNewTaskPrefillPrompt } from '../store/store';
import type { ArenaMatch } from './types';
import type { ChangedFile } from '../ipc/types';

function formatTime(startTime: number, endTime: number | null): string {
  if (endTime === null) return 'DNF';
  return formatDuration(endTime - startTime);
}

function rankLabel(index: number): string {
  return ['1st', '2nd', '3rd', '4th'][index] ?? `${index + 1}th`;
}

export function ResultsScreen() {
  const battle = useArenaStore((s) => s.battle);
  const prompt = useArenaStore((s) => s.prompt);
  const cwd = useArenaStore((s) => s.cwd);
  const selectedHistoryMatch = useArenaStore((s) => s.selectedHistoryMatch);
  const battleSaved = useArenaStore((s) => s.battleSaved);
  const projects = useStore((s) => s.projects);

  const isHistoryView = selectedHistoryMatch !== null;

  const projectLabel = useMemo(() => {
    if (!cwd) return null;
    const project = projects.find((p) => p.path === cwd);
    return project?.name ?? cwd.split('/').pop() ?? null;
  }, [cwd, projects]);

  // When viewing from history, pre-populate ratings from saved match
  function initialRatings(): Record<string, number> {
    if (!selectedHistoryMatch) return {};
    const result: Record<string, number> = {};
    selectedHistoryMatch.competitors.forEach((c, i) => {
      if (c.rating !== null && battle[i]) {
        result[battle[i].id] = c.rating;
      }
    });
    return result;
  }

  const [ratings, setRatings] = useState<Record<string, number>>(() => initialRatings());
  const [diffFile, setDiffFile] = useState<ChangedFile | null>(null);
  const [diffWorktree, setDiffWorktree] = useState('');
  const [diffBranch, setDiffBranch] = useState<string | null>(null);
  const [expandedOutputs, setExpandedOutputs] = useState<Record<string, boolean>>({});

  const merge = useMergeWorkflow();

  useEffect(() => {
    merge.loadWorktreeStatuses();
    // Auto-save results for new battles (not when viewing from history)
    if (!isHistoryView && !battleSaved) saveResults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openCompareTask() {
    const competitors = sorted;

    // Gather changed files from each competitor's worktree
    const sections: string[] = [];
    for (let i = 0; i < competitors.length; i++) {
      const c = competitors[i];
      const timeStr = c.endTime !== null ? formatDuration(c.endTime - c.startTime) : 'DNF';
      const exitStr = c.exitCode !== null && c.exitCode !== 0 ? ` | exit code ${c.exitCode}` : '';

      let filesStr = '  (no project worktree)';
      if (c.worktreePath) {
        try {
          const files = await invoke<ChangedFile[]>(IPC.GetChangedFiles, {
            worktreePath: c.worktreePath,
          });
          if (files.length > 0) {
            filesStr = files
              .map((f) => `  - ${f.path} (+${f.lines_added}, -${f.lines_removed})`)
              .join('\n');
          } else {
            filesStr = '  (no changes)';
          }
        } catch {
          filesStr = '  (could not read changes)';
        }
      }

      sections.push(
        `## Approach ${i + 1}: ${c.name} (${timeStr}${exitStr})\n` +
          (c.worktreePath ? `Worktree: ${c.worktreePath}\n` : '') +
          `Changed files:\n${filesStr}`,
      );
    }

    const state = getArenaStore();
    const fullPrompt =
      `Compare the following different AI-generated approaches to this task. ` +
      `These are ${competitors.length} independent implementations of the same prompt, ` +
      `each in its own worktree.\n\n` +
      `# Original task\n${prompt}\n\n` +
      sections.join('\n\n---\n\n') +
      `\n\n---\n\n` +
      `Read the changed files from each worktree and compare the approaches. ` +
      `Focus on correctness, code quality, and trade-offs between them.`;

    const projectId = projects.find((p) => p.path === state.cwd)?.id ?? null;
    setNewTaskPrefillPrompt(fullPrompt, projectId);
    toggleArena(false);
    toggleNewTaskDialog(true);
  }

  const sorted = useMemo(
    () =>
      [...battle].sort((a, b) => {
        const aFailed = a.exitCode !== null && a.exitCode !== 0;
        const bFailed = b.exitCode !== null && b.exitCode !== 0;
        if (aFailed !== bFailed) return aFailed ? 1 : -1;
        const aTime = a.endTime !== null ? a.endTime - a.startTime : Infinity;
        const bTime = b.endTime !== null ? b.endTime - b.startTime : Infinity;
        return aTime - bTime;
      }),
    [battle],
  );

  function setRating(competitorId: string, stars: number) {
    setRatings((prev) => ({ ...prev, [competitorId]: stars }));

    // Persist rating to history — use selectedHistoryMatch for history views,
    // or the most recent history entry for fresh battles
    const state = getArenaStore();
    const match =
      state.selectedHistoryMatch ?? (state.battleSaved ? state.history[0] : null);
    if (match) {
      const idx = state.battle.findIndex((b) => b.id === competitorId);
      if (idx !== -1) {
        updateHistoryRating(match.id, idx, stars);
        void saveArenaHistory();
      }
    }
  }

  function saveResults() {
    const state = getArenaStore();
    if (state.battle.length === 0) return;
    const match: ArenaMatch = {
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      prompt: state.prompt,
      cwd: state.cwd || null,
      competitors: [...state.battle].map((b) => ({
        name: b.name,
        command: b.command,
        timeMs: b.endTime !== null ? b.endTime - b.startTime : null,
        exitCode: b.exitCode,
        rating: ratings[b.id] ?? null,
        worktreePath: b.worktreePath ?? null,
        branchName: b.branchName ?? null,
        merged: b.merged ?? false,
        terminalOutput: b.terminalOutput ?? null,
      })),
    };
    addMatchToHistory(match);
    void saveArenaHistory();
    setBattleSaved(true);
  }

  function handleFileClick(worktreePath: string, branchName: string | null, file: ChangedFile) {
    setDiffWorktree(worktreePath);
    setDiffBranch(branchName);
    setDiffFile(file);
  }

  return (
    <div className="arena-results">
      <div className="arena-results-prompt" title={prompt}>
        {prompt}
      </div>
      <div className="arena-results-grid">
        {sorted.map((competitor, index) => {
          const originalIdx = battle.findIndex((b) => b.id === competitor.id);
          return (
            <div
              key={competitor.id}
              className="arena-result-column"
              data-arena={originalIdx}
              data-rank={index === 0 ? '1' : undefined}
            >
              <div className="arena-result-column-rank" data-rank={String(index + 1)}>
                {rankLabel(index)}
              </div>
              <div className="arena-result-column-name">{competitor.name}</div>
              <div className="arena-result-column-time">
                {formatTime(competitor.startTime, competitor.endTime)}
              </div>
              {competitor.exitCode !== null && competitor.exitCode !== 0 && (
                <div className="arena-result-column-exit">exit {competitor.exitCode}</div>
              )}

              {/* Terminal output */}
              {competitor.terminalOutput && (
                <div className="arena-result-column-output">
                  <button
                    className="arena-output-toggle"
                    onClick={() =>
                      setExpandedOutputs((prev) => ({
                        ...prev,
                        [competitor.id]: !prev[competitor.id],
                      }))
                    }
                  >
                    <span
                      className="arena-output-toggle-icon"
                      data-expanded={expandedOutputs[competitor.id] ? 'true' : undefined}
                    >
                      &#9654;
                    </span>
                    Terminal output
                  </button>
                  {expandedOutputs[competitor.id] && (
                    <pre className="arena-output-pre">{competitor.terminalOutput}</pre>
                  )}
                </div>
              )}

              {/* Changed files */}
              {(competitor.worktreePath || competitor.branchName) && (
                <div className="arena-result-column-files">
                  <span className="arena-section-label">Changed files</span>
                  <div className="arena-result-column-files-list">
                    <ChangedFilesList
                      worktreePath={competitor.worktreePath ?? ''}
                      isActive={true}
                      projectRoot={cwd || undefined}
                      branchName={competitor.branchName}
                      onFileClick={(file) =>
                        handleFileClick(
                          competitor.worktreePath ?? '',
                          competitor.branchName,
                          file,
                        )
                      }
                    />
                  </div>
                </div>
              )}

              {/* Star rating */}
              <div className="arena-result-column-rating">
                <span className="arena-result-rating-label">Rate how it performed</span>
                <div className="arena-result-column-stars">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      className="arena-star-btn"
                      data-filled={(ratings[competitor.id] ?? 0) >= star ? 'true' : undefined}
                      onClick={() => setRating(competitor.id, star)}
                      title={`${star} star${star > 1 ? 's' : ''}`}
                    >
                      <svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 1.3l1.8 3.6 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 5.5l4-.6L8 1.3z" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>

              {/* Merge into main */}
              {competitor.branchName && merge.hasChanges(competitor.id) && (
                <div className="arena-result-column-merge">
                  {merge.mergedId === competitor.id ? (
                    <span className="arena-merge-badge">Merged</span>
                  ) : (
                    <button
                      className="arena-merge-btn"
                      disabled={merge.merging || merge.mergedId !== null}
                      onClick={() => merge.handleMergeClick(competitor)}
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
                        <circle cx="4" cy="4" r="2" />
                        <circle cx="12" cy="4" r="2" />
                        <circle cx="8" cy="13" r="2" />
                        <path d="M4 6v1c0 2 4 4 4 4M12 6v1c0 2-4 4-4 4" />
                      </svg>
                      {merge.merging ? 'Merging...' : 'Merge into main'}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {merge.mergeError && <div className="arena-merge-error">{merge.mergeError}</div>}

      {projectLabel && (
        <div className="arena-results-project">
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
            <path d="M2 4l6-2 6 2v8l-6 2-6-2z" />
            <path d="M8 2v12" />
          </svg>
          {projectLabel}
        </div>
      )}

      <div className="arena-config-actions">
        <button className="arena-close-btn" onClick={() => void openCompareTask()}>
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
            <path d="M3 3h4v10H3zM9 3h4v10H9zM5 6H3M5 8H3M5 10H3M11 6H9M11 8H9M11 10H9" />
          </svg>
          Compare All
        </button>
        {!isHistoryView && (
          <>
            <button className="arena-close-btn" onClick={() => void resetForRematch()}>
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
                <path d="M2 8a6 6 0 0 1 10.2-4.3" />
                <path d="M14 8a6 6 0 0 1-10.2 4.3" />
                <path d="M12 1v3h-3" />
                <path d="M4 15v-3h3" />
              </svg>
              Rematch
            </button>
            <button className="arena-close-btn" onClick={() => void resetForNewMatch()}>
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
                <path d="M8 3v10M3 8h10" />
              </svg>
              New Match
            </button>
            <button className="arena-close-btn" onClick={() => setPhase('history')}>
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
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4.5V8l2.5 2.5" />
              </svg>
              History
            </button>
          </>
        )}
        {isHistoryView && (
          <button className="arena-close-btn" onClick={returnToHistory}>
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
            Back to History
          </button>
        )}
      </div>

      <DiffViewerDialog
        file={diffFile}
        worktreePath={diffWorktree}
        projectRoot={cwd || undefined}
        branchName={diffBranch}
        onClose={() => setDiffFile(null)}
      />

      {merge.commitTarget && (
        <CommitDialog
          target={merge.commitTarget}
          hasCommitted={!!merge.worktreeStatus[merge.commitTarget.id]?.hasCommitted}
          onCommitAndMerge={(msg) => void merge.commitAndMerge(msg)}
          onDiscardAndMerge={() => void merge.discardAndMerge()}
          onCancel={merge.dismissCommitDialog}
        />
      )}
    </div>
  );
}
