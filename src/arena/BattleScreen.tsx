import { useState, useEffect, useRef, useCallback } from 'react';
import { TerminalView } from '../components/TerminalView';
import { ChangedFilesList } from '../components/ChangedFilesList';
import { DiffViewerDialog } from '../components/DiffViewerDialog';
import { fireAndForget } from '../lib/ipc';
import { showNotification } from '../store/notification';
import { IPC } from '../lib/channels';
import {
  useArenaStore,
  getArenaStore,
  markBattleCompetitorExited,
  allBattleFinished,
  setPhase,
  setTerminalOutput,
} from './store';
import { formatDuration } from './utils';
import type { ChangedFile } from '../ipc/types';

/** Format elapsed ms for a live timer — whole seconds above 60s to avoid jitter */
function formatElapsed(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return formatDuration(ms);
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

/** Replace {prompt} in the command template with the escaped prompt.
 *  The template uses double-quote context, so escape characters meaningful
 *  inside double quotes: ", $, `, and \. Note: ! (history expansion) is a
 *  bash-only feature and not special in POSIX /bin/sh double quotes. */
function buildCommand(template: string, prompt: string): { command: string; args: string[] } {
  const escapedPrompt = prompt
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  const fullCommand = template.replace(/\{prompt\}/g, escapedPrompt);
  return { command: '/bin/sh', args: ['-c', fullCommand] };
}

export function BattleScreen() {
  const [elapsed, setElapsed] = useState<Record<string, number>>({});
  const [diffFile, setDiffFile] = useState<ChangedFile | null>(null);
  const [diffWorktree, setDiffWorktree] = useState('');

  const battle = useArenaStore((s) => s.battle);
  const prompt = useArenaStore((s) => s.prompt);

  // Store buffer serializers keyed by competitor id
  const bufferSerializers = useRef(new Map<string, () => string>());

  // Tick every 100ms to update running timers
  useEffect(() => {
    const timer = setInterval(() => {
      const state = getArenaStore();
      const now = Date.now();
      const next: Record<string, number> = {};
      for (const c of state.battle) {
        if (c.status === 'running') {
          next[c.agentId] = now - c.startTime;
        } else if (c.endTime !== null) {
          next[c.agentId] = c.endTime - c.startTime;
        }
      }
      setElapsed(next);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  // Auto-transition to results when all competitors finish
  useEffect(() => {
    if (!allBattleFinished()) return;
    const timeout = setTimeout(() => {
      // Capture terminal output before transitioning (terminals get disposed on unmount)
      const state = getArenaStore();
      for (const c of state.battle) {
        const getBuffer = bufferSerializers.current.get(c.id);
        if (getBuffer) setTerminalOutput(c.id, getBuffer());
      }
      setPhase('results');
    }, 1500);
    return () => clearTimeout(timeout);
  }, [battle]);

  const handleStop = useCallback((agentId: string) => {
    fireAndForget(IPC.KillAgent, { agentId }, () => {
      showNotification('Failed to stop agent');
    });
  }, []);

  function handleFileClick(worktreePath: string, file: ChangedFile) {
    setDiffWorktree(worktreePath);
    setDiffFile(file);
  }

  return (
    <>
      <div className="arena-battle">
        {battle.map((competitor, index) => {
          const { command, args } = buildCommand(competitor.command, prompt);
          const agentId = competitor.agentId;
          const cwd = competitor.worktreePath ?? '/tmp';

          return (
            <div key={competitor.id} style={{ display: 'contents' }}>
              {index > 0 && <div className="arena-vs-badge">VS</div>}
              <div className="arena-battle-panel" data-arena={index}>
                <div className="arena-battle-panel-header">
                  <span className="arena-battle-panel-name">{competitor.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      className="arena-battle-panel-timer"
                      data-done={competitor.status === 'exited' ? 'true' : undefined}
                    >
                      {formatElapsed(elapsed[agentId] ?? 0)}
                    </span>
                    {competitor.status === 'running' && (
                      <button
                        className="arena-stop-btn"
                        onClick={() => handleStop(agentId)}
                        title="Stop"
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                          <rect x="3" y="3" width="10" height="10" rx="1" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ flex: '1', overflow: 'hidden' }}>
                  <TerminalView
                    taskId={competitor.id}
                    agentId={agentId}
                    command={command}
                    args={args}
                    cwd={cwd}
                    onExit={(info) => markBattleCompetitorExited(agentId, info.exit_code)}
                    onBufferReady={(getBuffer) => bufferSerializers.current.set(competitor.id, getBuffer)}
                  />
                </div>
                {competitor.worktreePath && (
                  <div className="arena-battle-panel-files">
                    <ChangedFilesList
                      worktreePath={cwd}
                      isActive={true}
                      onFileClick={(file) => handleFileClick(cwd, file)}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <DiffViewerDialog
        file={diffFile}
        worktreePath={diffWorktree}
        onClose={() => setDiffFile(null)}
      />
    </>
  );
}
