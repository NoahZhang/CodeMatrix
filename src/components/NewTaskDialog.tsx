import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Dialog } from './Dialog';
import {
  useStore,
  getStore,
  createTask,
  createDirectTask,
  toggleNewTaskDialog,
  loadAgents,
  getProject,
  getProjectPath,
  getProjectBranchPrefix,
  updateProject,
  hasDirectModeTask,
  getGitHubDropDefaults,
  setPrefillPrompt,
} from '../store/store';
import { invoke } from '../lib/ipc';
import { toBranchName, sanitizeBranchPrefix } from '../lib/branch-name';
import { cleanTaskName } from '../lib/clean-task-name';
import { extractGitHubUrl } from '../lib/github-url';
import { theme } from '../lib/theme';
import { AgentSelector } from './AgentSelector';
import { BranchPrefixField } from './BranchPrefixField';
import { ProjectSelect } from './ProjectSelect';
import { SymlinkDirPicker } from './SymlinkDirPicker';
import type { AgentDef } from '../ipc/types';

interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewTaskDialog(props: NewTaskDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentDef | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ignoredDirs, setIgnoredDirs] = useState<string[]>([]);
  const [selectedDirs, setSelectedDirs] = useState<Set<string>>(new Set());
  const [directMode, setDirectMode] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [branchPrefix, setBranchPrefix] = useState('');
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const focusableSelector =
    'textarea:not(:disabled), input:not(:disabled), select:not(:disabled), button:not(:disabled), [tabindex]:not([tabindex="-1"])';

  const navigateDialogFields = useCallback(
    (direction: 'up' | 'down'): void => {
      if (!formRef.current) return;
      const sections = Array.from(formRef.current.querySelectorAll<HTMLElement>('[data-nav-field]'));
      if (sections.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const currentIdx = active ? sections.findIndex((s) => s.contains(active)) : -1;

      let nextIdx: number;
      if (currentIdx === -1) {
        nextIdx = direction === 'down' ? 0 : sections.length - 1;
      } else if (direction === 'down') {
        nextIdx = (currentIdx + 1) % sections.length;
      } else {
        nextIdx = (currentIdx - 1 + sections.length) % sections.length;
      }

      const target = sections[nextIdx];
      const focusable = target.querySelector<HTMLElement>(focusableSelector);
      focusable?.focus();
    },
    [],
  );

  const navigateWithinField = useCallback(
    (direction: 'left' | 'right'): void => {
      if (!formRef.current) return;
      const active = document.activeElement as HTMLElement | null;
      if (!active) return;

      const section = active.closest<HTMLElement>('[data-nav-field]');
      if (!section) return;

      const focusables = Array.from(section.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusables.length <= 1) return;

      const idx = focusables.indexOf(active);
      if (idx === -1) return;

      let nextIdx: number;
      if (direction === 'right') {
        nextIdx = (idx + 1) % focusables.length;
      } else {
        nextIdx = (idx - 1 + focusables.length) % focusables.length;
      }
      focusables[nextIdx].focus();
    },
    [],
  );

  // Initialize state each time the dialog opens
  useEffect(() => {
    if (!props.open) return;

    // Reset signals for a fresh dialog
    setPrompt('');
    setName('');
    setError('');
    setLoading(false);
    setDirectMode(false);
    setSkipPermissions(false);

    void (async () => {
      const storeState = getStore();
      if (storeState.availableAgents.length === 0) {
        await loadAgents();
      }
      const updatedState = getStore();
      const lastAgent = updatedState.lastAgentId
        ? (updatedState.availableAgents.find((a) => a.id === updatedState.lastAgentId) ?? null)
        : null;
      setSelectedAgent(lastAgent ?? updatedState.availableAgents[0] ?? null);

      // Pre-fill from drop data if present
      const dropUrl = updatedState.newTaskDropUrl;
      const fallbackProjectId = updatedState.lastProjectId ?? updatedState.projects[0]?.id ?? null;
      const defaults = dropUrl ? getGitHubDropDefaults(dropUrl) : null;

      if (dropUrl) setPrompt(`review ${dropUrl}`);
      if (defaults) setName(defaults.name);
      setSelectedProjectId(defaults?.projectId ?? fallbackProjectId);

      // Pre-fill from arena comparison prompt
      const prefill = updatedState.newTaskPrefillPrompt;
      if (prefill) {
        setPrompt(prefill.prompt);
        setName('Compare arena results');
        if (prefill.projectId) setSelectedProjectId(prefill.projectId);
      }

      promptRef.current?.focus();
    })();

    // Capture-phase handler for Alt+Arrow to navigate form sections / within fields
    const handleAltArrow = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateDialogFields(e.key === 'ArrowDown' ? 'down' : 'up');
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // Preserve native word-jump (Alt+Arrow) in text inputs
        const tag = (document.activeElement as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        navigateWithinField(e.key === 'ArrowRight' ? 'right' : 'left');
      }
    };
    window.addEventListener('keydown', handleAltArrow, true);

    return () => {
      window.removeEventListener('keydown', handleAltArrow, true);
    };
  }, [props.open, navigateDialogFields, navigateWithinField]);

  // Fetch gitignored dirs when project changes
  useEffect(() => {
    const path = selectedProjectId ? getProjectPath(selectedProjectId) : undefined;
    let cancelled = false;

    if (!path) {
      setIgnoredDirs([]);
      setSelectedDirs(new Set<string>());
      return;
    }

    void (async () => {
      try {
        const dirs = await invoke<string[]>('get_gitignored_dirs', { projectRoot: path });
        if (cancelled) return;
        setIgnoredDirs(dirs);
        setSelectedDirs(new Set(dirs)); // all checked by default
      } catch {
        if (cancelled) return;
        setIgnoredDirs([]);
        setSelectedDirs(new Set<string>());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  // Sync branch prefix when project changes
  useEffect(() => {
    setBranchPrefix(selectedProjectId ? getProjectBranchPrefix(selectedProjectId) : 'task');
  }, [selectedProjectId]);

  // Pre-check direct mode based on project setting
  useEffect(() => {
    if (!selectedProjectId) return;
    const proj = getProject(selectedProjectId);
    setDirectMode(proj?.defaultDirectMode ?? false);
  }, [selectedProjectId]);

  const directModeDisabled = useMemo(() => {
    return selectedProjectId ? hasDirectModeTask(selectedProjectId) : false;
  }, [selectedProjectId]);

  // Disable direct mode if it's disabled for the project
  useEffect(() => {
    if (directModeDisabled) setDirectMode(false);
  }, [directModeDisabled]);

  const effectiveName = useMemo(() => {
    const n = name.trim();
    if (n) return n;
    const p = prompt.trim();
    if (!p) return '';
    // Use first line, clean filler phrases, truncate at ~40 chars on word boundary
    const firstLine = cleanTaskName(p.split('\n')[0]);
    if (firstLine.length <= 40) return firstLine;
    return firstLine.slice(0, 40).replace(/\s+\S*$/, '') || firstLine.slice(0, 40);
  }, [name, prompt]);

  const branchPreview = useMemo(() => {
    const prefix = sanitizeBranchPrefix(branchPrefix);
    return effectiveName ? `${prefix}/${toBranchName(effectiveName)}` : '';
  }, [effectiveName, branchPrefix]);

  const selectedProjectPath = useMemo(() => {
    return selectedProjectId ? getProjectPath(selectedProjectId) : undefined;
  }, [selectedProjectId]);

  const agentSupportsSkipPermissions = useMemo(() => {
    return !!selectedAgent?.skip_permissions_args?.length;
  }, [selectedAgent]);

  const canSubmit = useMemo(() => {
    const hasContent = !!effectiveName;
    return hasContent && !!selectedProjectId && !loading;
  }, [effectiveName, selectedProjectId, loading]);

  const availableAgents = useStore((s) => s.availableAgents);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveName) return;

    if (!selectedAgent) {
      setError('Select an agent');
      return;
    }

    if (!selectedProjectId) {
      setError('Select a project');
      return;
    }

    setLoading(true);
    setError('');

    const p = prompt.trim() || undefined;
    const storeState = getStore();
    const isFromDrop = !!storeState.newTaskDropUrl;
    const prefix = sanitizeBranchPrefix(branchPrefix);
    const ghUrl = (p ? extractGitHubUrl(p) : null) ?? storeState.newTaskDropUrl ?? undefined;
    try {
      // Persist the branch prefix to the project for next time
      updateProject(selectedProjectId, { branchPrefix: prefix });

      let taskId: string;
      if (directMode) {
        const projectPath = getProjectPath(selectedProjectId);
        if (!projectPath) {
          setError('Project path not found');
          return;
        }
        const mainBranch = await invoke<string>('get_main_branch', { projectRoot: projectPath });
        const currentBranch = await invoke<string>('get_current_branch', {
          projectRoot: projectPath,
        });
        if (currentBranch !== mainBranch) {
          setError(
            `Repository is on branch "${currentBranch}", not "${mainBranch}". Please checkout ${mainBranch} first.`,
          );
          return;
        }
        taskId = await createDirectTask({
          name: effectiveName,
          agentDef: selectedAgent,
          projectId: selectedProjectId,
          mainBranch,
          initialPrompt: isFromDrop ? undefined : p,
          githubUrl: ghUrl,
          skipPermissions: agentSupportsSkipPermissions && skipPermissions,
        });
      } else {
        taskId = await createTask({
          name: effectiveName,
          agentDef: selectedAgent,
          projectId: selectedProjectId,
          symlinkDirs: [...selectedDirs],
          initialPrompt: isFromDrop ? undefined : p,
          branchPrefixOverride: prefix,
          githubUrl: ghUrl,
          skipPermissions: agentSupportsSkipPermissions && skipPermissions,
        });
      }
      // Drop flow: prefill prompt without auto-sending
      if (isFromDrop && p) {
        setPrefillPrompt(taskId, p);
      }
      toggleNewTaskDialog(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={props.open} onClose={props.onClose} width="420px" panelStyle={{ gap: '20px' }}>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        <div>
          <h2
            style={{
              margin: '0 0 6px',
              fontSize: '16px',
              color: theme.fg,
              fontWeight: '600',
            }}
          >
            New Task
          </h2>
          <p
            style={{ margin: '0', fontSize: '12px', color: theme.fgMuted, lineHeight: '1.5' }}
          >
            {directMode
              ? 'The AI agent will work directly on your main branch in the project root.'
              : 'Creates a git branch and worktree so the AI agent can work in isolation without affecting your main branch.'}
          </p>
        </div>

        {/* Project selector */}
        <div
          data-nav-field="project"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <label
            style={{
              fontSize: '11px',
              color: theme.fgMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Project
          </label>
          <ProjectSelect value={selectedProjectId} onChange={setSelectedProjectId} />
        </div>

        {/* Prompt input (optional) */}
        <div
          data-nav-field="prompt"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <label
            style={{
              fontSize: '11px',
              color: theme.fgMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Prompt <span style={{ opacity: '0.5', textTransform: 'none' }}>(optional)</span>
          </label>
          <textarea
            ref={promptRef}
            className="input-field"
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                e.stopPropagation();
                if (canSubmit) handleSubmit(e);
              }
            }}
            placeholder="What should the agent work on?"
            rows={3}
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              padding: '10px 14px',
              color: theme.fg,
              fontSize: '13px',
              fontFamily: "'JetBrains Mono', monospace",
              outline: 'none',
              resize: 'vertical',
            }}
          />
        </div>

        <div
          data-nav-field="task-name"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <label
            style={{
              fontSize: '11px',
              color: theme.fgMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Task name{' '}
            <span style={{ opacity: '0.5', textTransform: 'none' }}>
              (optional — derived from prompt)
            </span>
          </label>
          <input
            className="input-field"
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder={effectiveName || 'Add user authentication'}
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              padding: '10px 14px',
              color: theme.fg,
              fontSize: '13px',
              outline: 'none',
            }}
          />
          {directMode && selectedProjectPath && (
            <div
              style={{
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', monospace",
                color: theme.fgSubtle,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                padding: '4px 2px 0',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  style={{ flexShrink: '0' }}
                >
                  <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6.25 7.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 7.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 0h5.5a2.5 2.5 0 0 0 2.5-2.5v-.5a.75.75 0 0 0-1.5 0v.5a1 1 0 0 1-1 1H5a3.25 3.25 0 1 0 0 6.5h6.25a.75.75 0 0 0 0-1.5H5a1.75 1.75 0 1 1 0-3.5Z" />
                </svg>
                main branch (detected on create)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  style={{ flexShrink: '0' }}
                >
                  <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z" />
                </svg>
                {selectedProjectPath}
              </span>
            </div>
          )}
        </div>

        {!directMode && (
          <BranchPrefixField
            branchPrefix={branchPrefix}
            branchPreview={branchPreview}
            projectPath={selectedProjectPath}
            onPrefixChange={setBranchPrefix}
          />
        )}

        <AgentSelector
          agents={availableAgents}
          selectedAgent={selectedAgent}
          onSelect={setSelectedAgent}
        />

        {/* Direct mode toggle */}
        <div
          data-nav-field="direct-mode"
          style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: directModeDisabled ? theme.fgSubtle : theme.fg,
              cursor: directModeDisabled ? 'not-allowed' : 'pointer',
              opacity: directModeDisabled ? '0.5' : '1',
            }}
          >
            <input
              type="checkbox"
              checked={directMode}
              disabled={directModeDisabled}
              onChange={(e) => setDirectMode(e.currentTarget.checked)}
              style={{ accentColor: theme.accent, cursor: 'inherit' }}
            />
            Work directly on main branch
          </label>
          {directModeDisabled && (
            <span style={{ fontSize: '11px', color: theme.fgSubtle }}>
              A direct-mode task already exists for this project
            </span>
          )}
          {directMode && (
            <div
              style={{
                fontSize: '12px',
                color: theme.warning,
                background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                padding: '8px 12px',
                borderRadius: '8px',
                border: `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
              }}
            >
              Changes will be made directly on the main branch without worktree isolation.
            </div>
          )}
        </div>

        {/* Skip permissions toggle */}
        {agentSupportsSkipPermissions && (
          <div
            data-nav-field="skip-permissions"
            style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                color: theme.fg,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={skipPermissions}
                onChange={(e) => setSkipPermissions(e.currentTarget.checked)}
                style={{ accentColor: theme.accent, cursor: 'inherit' }}
              />
              Dangerously skip all confirms
            </label>
            {skipPermissions && (
              <div
                style={{
                  fontSize: '12px',
                  color: theme.warning,
                  background: `color-mix(in srgb, ${theme.warning} 8%, transparent)`,
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: `1px solid color-mix(in srgb, ${theme.warning} 20%, transparent)`,
                }}
              >
                The agent will run without asking for confirmation. It can read, write, and delete
                files, and execute commands without your approval.
              </div>
            )}
          </div>
        )}

        {ignoredDirs.length > 0 && !directMode && (
          <SymlinkDirPicker
            dirs={ignoredDirs}
            selectedDirs={selectedDirs}
            onToggle={(dir) => {
              const next = new Set(selectedDirs);
              if (next.has(dir)) next.delete(dir);
              else next.add(dir);
              setSelectedDirs(next);
            }}
          />
        )}

        {error && (
          <div
            style={{
              fontSize: '12px',
              color: theme.error,
              background: `color-mix(in srgb, ${theme.error} 8%, transparent)`,
              padding: '8px 12px',
              borderRadius: '8px',
              border: `1px solid color-mix(in srgb, ${theme.error} 20%, transparent)`,
            }}
          >
            {error}
          </div>
        )}

        <div
          data-nav-field="footer"
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'flex-end',
            paddingTop: '4px',
          }}
        >
          <button
            type="button"
            className="btn-secondary"
            onClick={() => props.onClose()}
            style={{
              padding: '9px 18px',
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              borderRadius: '8px',
              color: theme.fgMuted,
              cursor: 'pointer',
              fontSize: '13px',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!canSubmit}
            style={{
              padding: '9px 20px',
              background: theme.accent,
              border: 'none',
              borderRadius: '8px',
              color: theme.accentText,
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              opacity: !canSubmit ? '0.4' : '1',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {loading && (
              <span className="inline-spinner" aria-hidden="true" />
            )}
            {loading ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
