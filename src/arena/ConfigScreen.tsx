import { useState } from 'react';
import {
  useArenaStore,
  getArenaStore,
  updateCompetitor,
  addCompetitor,
  removeCompetitor,
  setPrompt,
  setCwd,
  canFight,
  startBattle,
  setPhase,
  applyPreset,
  saveCurrentAsPreset,
  deletePreset,
} from './store';
import { useStore } from '../store/store';
import { getProject } from '../store/store';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';
import { saveArenaPresets } from './persistence';
import { ProjectSelect } from '../components/ProjectSelect';
import { MAX_COMPETITORS, MIN_COMPETITORS } from './store';
import type { BattleCompetitor } from './types';

/** Built-in tool presets — click to fill the next empty competitor slot */
const TOOL_PRESETS: Array<{ name: string; command: string }> = [
  { name: 'Claude', command: 'claude -p "{prompt}" --dangerously-skip-permissions' },
  { name: 'Codex', command: 'codex exec --full-auto "{prompt}"' },
  { name: 'Gemini', command: 'gemini -p "{prompt}" --yolo' },
  { name: 'Copilot', command: 'copilot -p "{prompt}" --yolo' },
  { name: 'Aider', command: 'aider -m "{prompt}" --yes' },
  { name: 'OpenCode', command: 'opencode -p "{prompt}"' },
];

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

export function ConfigScreen() {
  const [presetName, setPresetName] = useState('');
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [fightError, setFightError] = useState<string | null>(null);

  const competitors = useArenaStore((s) => s.competitors);
  const prompt = useArenaStore((s) => s.prompt);
  const cwd = useArenaStore((s) => s.cwd);
  const presets = useArenaStore((s) => s.presets);
  const projects = useStore((s) => s.projects);

  async function handleFight() {
    if (!canFight() || preparing) return;
    setPreparing(true);
    setFightError(null);

    try {
      const state = getArenaStore();
      const filled = state.competitors.filter(
        (c) => c.name.trim() !== '' && c.command.trim() !== '',
      );
      const projectRoot = state.cwd;

      const runId = Date.now();
      const battleCompetitors: BattleCompetitor[] = await Promise.all(
        filled.map(async (c, i) => {
          let worktreePath: string | null = null;
          let branchName: string | null = null;

          if (projectRoot) {
            branchName = `arena/${slug(c.name)}-${runId}-${i}`;
            const result = await invoke<{ path: string; branch: string }>(IPC.CreateArenaWorktree, {
              projectRoot,
              branchName,
              symlinkDirs: ['node_modules'],
            });
            worktreePath = result.path;
          }

          return {
            id: c.id,
            name: c.name,
            command: c.command,
            agentId: crypto.randomUUID(),
            status: 'running' as const,
            startTime: Date.now(),
            endTime: null,
            exitCode: null,
            worktreePath,
            branchName,
          };
        }),
      );

      startBattle(battleCompetitors);
    } catch (e) {
      setFightError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparing(false);
    }
  }

  function handleToolPreset(tool: { name: string; command: string }) {
    const state = getArenaStore();
    // Fill the first empty competitor slot, or add a new one
    const emptySlot = state.competitors.find(
      (c) => c.name.trim() === '' && c.command.trim() === '',
    );
    if (emptySlot) {
      updateCompetitor(emptySlot.id, { name: tool.name, command: tool.command });
    } else if (state.competitors.length < MAX_COMPETITORS) {
      addCompetitor();
      // Fill the newly added slot — read fresh state after addCompetitor
      const fresh = getArenaStore();
      const last = fresh.competitors[fresh.competitors.length - 1];
      updateCompetitor(last.id, { name: tool.name, command: tool.command });
    }
  }

  function handleSavePreset() {
    const name = presetName.trim();
    if (!name) return;
    saveCurrentAsPreset(name);
    void saveArenaPresets();
    setPresetName('');
    setShowPresetSave(false);
  }

  function handleApplyPreset(preset: {
    id: string;
    name: string;
    competitors: Array<{ name: string; command: string }>;
  }) {
    applyPreset(preset);
  }

  function handleDeletePreset(id: string) {
    deletePreset(id);
    void saveArenaPresets();
  }

  return (
    <div className="arena-config">
      {/* Quick add tools */}
      <span className="arena-section-label">Quick add</span>
      <div className="arena-tool-presets">
        {TOOL_PRESETS.map((tool) => (
          <button
            key={tool.name}
            className="arena-tool-preset-btn"
            onClick={() => handleToolPreset(tool)}
            title={tool.command}
          >
            + {tool.name}
          </button>
        ))}
      </div>

      {/* Competitors */}
      <span className="arena-section-label">Competitors</span>
      <div className="arena-competitors-grid">
        {competitors.map((competitor, index) => (
          <div key={competitor.id} className="arena-competitor-card" data-arena={index}>
            <div className="arena-competitor-card-header">
              <span className="arena-competitor-card-number">Competitor {index + 1}</span>
              <button
                className="arena-remove-btn"
                disabled={competitors.length <= MIN_COMPETITORS}
                onClick={() => removeCompetitor(competitor.id)}
                title="Remove competitor"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            </div>
            <input
              className="arena-competitor-input"
              type="text"
              placeholder="Name (e.g. Claude, Codex, Gemini)"
              value={competitor.name}
              onChange={(e) => updateCompetitor(competitor.id, { name: e.currentTarget.value })}
            />
            <input
              className="arena-competitor-input arena-command-input"
              type="text"
              placeholder={'Command — use {prompt} for the arena prompt'}
              value={competitor.command}
              onChange={(e) => updateCompetitor(competitor.id, { command: e.currentTarget.value })}
            />
          </div>
        ))}
      </div>

      {competitors.length < MAX_COMPETITORS && (
        <button className="arena-add-btn" onClick={() => addCompetitor()}>
          + Add Competitor
        </button>
      )}

      {/* Project */}
      <span className="arena-section-label">Project</span>
      <ProjectSelect
        value={projects.find((p) => p.path === cwd)?.id ?? null}
        onChange={(id) => setCwd(id ? (getProject(id)?.path ?? '') : '')}
        placeholder="Select a project..."
      />

      {/* Prompt */}
      <span className="arena-section-label">Prompt</span>
      <textarea
        className="arena-prompt-area"
        placeholder="Enter the coding task prompt that all competitors will receive..."
        value={prompt}
        onChange={(e) => setPrompt(e.currentTarget.value)}
      />

      {fightError && <div className="arena-merge-error">{fightError}</div>}

      {/* Actions */}
      <div className="arena-config-actions">
        <button className="arena-fight-btn" disabled={!canFight() || preparing} onClick={handleFight}>
          <svg
            width="20"
            height="20"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: '6px' }}
          >
            <path d="M3 3L13 13M9 12L12 9" />
            <path d="M13 3L3 13M4 9L7 12" />
          </svg>
          Fight!
        </button>
      </div>

      {/* Presets */}
      <span className="arena-section-label">Saved presets</span>
      {presets.length > 0 &&
        presets.map((preset) => (
          <div key={preset.id} className="arena-preset-row">
            <button className="arena-preset-btn" onClick={() => handleApplyPreset(preset)}>
              {preset.name}
            </button>
            <button
              className="arena-preset-delete-btn"
              onClick={() => handleDeletePreset(preset.id)}
              title="Delete preset"
            >
              x
            </button>
          </div>
        ))}

      {!showPresetSave && (
        <button className="arena-preset-btn" onClick={() => setShowPresetSave(true)}>
          Save current as preset
        </button>
      )}

      {showPresetSave && (
        <div className="arena-preset-row">
          <input
            className="arena-competitor-input"
            type="text"
            placeholder="Preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSavePreset();
              if (e.key === 'Escape') setShowPresetSave(false);
            }}
          />
          <button className="arena-preset-btn" onClick={handleSavePreset}>
            Save
          </button>
          <button className="arena-preset-btn" onClick={() => setShowPresetSave(false)}>
            Cancel
          </button>
        </div>
      )}

      {/* History link */}
      <button className="arena-history-link" onClick={() => setPhase('history')}>
        View match history
      </button>
    </div>
  );
}
