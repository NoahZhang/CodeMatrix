import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog } from './Dialog';
import {
  updateProject,
  PASTEL_HUES,
  isProjectMissing,
  relinkProject,
  removeProjectWithTasks,
} from '../store/store';
import { sanitizeBranchPrefix, toBranchName } from '../lib/branch-name';
import { theme } from '../lib/theme';
import type { Project, TerminalBookmark } from '../store/types';

interface EditProjectDialogProps {
  project: Project | null;
  onClose: () => void;
}

function hueFromColor(color: string): number {
  const match = color.match(/hsl\((\d+)/);
  return match ? Number(match[1]) : 0;
}

export function EditProjectDialog({ project, onClose }: EditProjectDialogProps) {
  const [name, setName] = useState('');
  const [selectedHue, setSelectedHue] = useState(0);
  const [branchPrefix, setBranchPrefix] = useState('task');
  const [deleteBranchOnClose, setDeleteBranchOnClose] = useState(true);
  const [defaultDirectMode, setDefaultDirectMode] = useState(false);
  const [bookmarks, setBookmarks] = useState<TerminalBookmark[]>([]);
  const [newCommand, setNewCommand] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  // Sync signals when project prop changes
  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setSelectedHue(hueFromColor(project.color));
    setBranchPrefix(sanitizeBranchPrefix(project.branchPrefix ?? 'task'));
    setDeleteBranchOnClose(project.deleteBranchOnClose ?? true);
    setDefaultDirectMode(project.defaultDirectMode ?? false);
    setBookmarks(project.terminalBookmarks ? [...project.terminalBookmarks] : []);
    setNewCommand('');
    requestAnimationFrame(() => nameRef.current?.focus());
  }, [project]);

  const addBookmark = useCallback(() => {
    const cmd = newCommand.trim();
    if (!cmd) return;
    const bookmark: TerminalBookmark = {
      id: crypto.randomUUID(),
      command: cmd,
    };
    setBookmarks((prev) => [...prev, bookmark]);
    setNewCommand('');
  }, [newCommand]);

  function removeBookmark(id: string) {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }

  const canSave = name.trim().length > 0;

  function handleSave() {
    if (!canSave || !project) return;
    const sanitizedPrefix = sanitizeBranchPrefix(branchPrefix);
    updateProject(project.id, {
      name: name.trim(),
      color: `hsl(${selectedHue}, 70%, 75%)`,
      branchPrefix: sanitizedPrefix,
      deleteBranchOnClose: deleteBranchOnClose,
      defaultDirectMode: defaultDirectMode,
      terminalBookmarks: bookmarks,
    });
    onClose();
  }

  return (
    <Dialog
      open={project !== null}
      onClose={onClose}
      width="480px"
      panelStyle={{ gap: '20px' }}
    >
      {project && (
        <>
          <h2
            style={{
              margin: '0',
              fontSize: '16px',
              color: theme.fg,
              fontWeight: '600',
            }}
          >
            Edit Project
          </h2>

          {/* Path */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <div
              style={{
                fontSize: '12px',
                color: theme.fgSubtle,
                fontFamily: "'JetBrains Mono', monospace",
                flex: '1',
                minWidth: '0',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {project.path}
            </div>
            <button
              type="button"
              onClick={() => relinkProject(project.id)}
              style={{
                padding: '3px 10px',
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                color: theme.fgMuted,
                cursor: 'pointer',
                fontSize: '11px',
                flexShrink: '0',
              }}
            >
              Change
            </button>
          </div>

          {isProjectMissing(project.id) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 14px',
                borderRadius: '8px',
                background: `color-mix(in srgb, ${theme.warning} 10%, transparent)`,
                border: `1px solid color-mix(in srgb, ${theme.warning} 30%, transparent)`,
                color: theme.warning,
                fontSize: '12px',
              }}
            >
              <span style={{ flex: '1' }}>This folder no longer exists.</span>
              <button
                type="button"
                onClick={async () => {
                  const ok = await relinkProject(project.id);
                  if (ok) onClose();
                }}
                style={{
                  padding: '5px 12px',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  color: theme.fg,
                  cursor: 'pointer',
                  fontSize: '12px',
                  flexShrink: '0',
                }}
              >
                Re-link
              </button>
              <button
                type="button"
                onClick={async () => {
                  await removeProjectWithTasks(project.id);
                  onClose();
                }}
                style={{
                  padding: '5px 12px',
                  background: 'transparent',
                  border: `1px solid color-mix(in srgb, ${theme.error} 40%, transparent)`,
                  borderRadius: '6px',
                  color: theme.error,
                  cursor: 'pointer',
                  fontSize: '12px',
                  flexShrink: '0',
                }}
              >
                Remove
              </button>
            </div>
          )}

          {/* Name */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label
              style={{
                fontSize: '11px',
                color: theme.fgMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Name
            </label>
            <input
              ref={nameRef}
              className="input-field"
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) handleSave();
              }}
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
          </div>

          {/* Branch prefix */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label
              style={{
                fontSize: '11px',
                color: theme.fgMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Branch prefix
            </label>
            <input
              className="input-field"
              type="text"
              value={branchPrefix}
              onChange={(e) => setBranchPrefix(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) handleSave();
              }}
              placeholder="task"
              style={{
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
                borderRadius: '8px',
                padding: '10px 14px',
                color: theme.fg,
                fontSize: '13px',
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
              }}
            />
            {branchPrefix.trim() && (
              <div
                style={{
                  fontSize: '11px',
                  fontFamily: "'JetBrains Mono', monospace",
                  color: theme.fgSubtle,
                  padding: '2px 2px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  style={{ flexShrink: '0' }}
                >
                  <path d="M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6.25 7.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 7.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 0h5.5a2.5 2.5 0 0 0 2.5-2.5v-.5a.75.75 0 0 0-1.5 0v.5a1 1 0 0 1-1 1H5a3.25 3.25 0 1 0 0 6.5h6.25a.75.75 0 0 0 0-1.5H5a1.75 1.75 0 1 1 0-3.5Z" />
                </svg>
                {sanitizeBranchPrefix(branchPrefix)}/{toBranchName('example-branch-name')}
              </div>
            )}
          </div>

          {/* Color palette */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label
              style={{
                fontSize: '11px',
                color: theme.fgMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Color
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {PASTEL_HUES.map((hue) => {
                const color = `hsl(${hue}, 70%, 75%)`;
                const isSelected = selectedHue === hue;
                return (
                  <button
                    key={hue}
                    type="button"
                    onClick={() => setSelectedHue(hue)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: color,
                      border: isSelected ? `2px solid ${theme.fg}` : '2px solid transparent',
                      outline: isSelected ? `2px solid ${theme.accent}` : 'none',
                      outlineOffset: '1px',
                      cursor: 'pointer',
                      padding: '0',
                      flexShrink: '0',
                    }}
                    title={`Hue ${hue}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Merge cleanup preference */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: theme.fg,
            }}
          >
            <input
              type="checkbox"
              checked={deleteBranchOnClose}
              onChange={(e) => setDeleteBranchOnClose(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            Always delete branch and worklog on merge
          </label>

          {/* Default direct mode preference */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              cursor: 'pointer',
              fontSize: '13px',
              color: theme.fg,
            }}
          >
            <input
              type="checkbox"
              checked={defaultDirectMode}
              onChange={(e) => setDefaultDirectMode(e.currentTarget.checked)}
              style={{ cursor: 'pointer' }}
            />
            Default to working directly on main branch
          </label>

          {/* Command Bookmarks */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label
              style={{
                fontSize: '11px',
                color: theme.fgMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Command Bookmarks
            </label>
            {bookmarks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {bookmarks.map((bookmark) => (
                  <div
                    key={bookmark.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 8px',
                      background: theme.bgInput,
                      borderRadius: '6px',
                      border: `1px solid ${theme.border}`,
                    }}
                  >
                    <span
                      style={{
                        flex: '1',
                        fontSize: '11px',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: theme.fgSubtle,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {bookmark.command}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeBookmark(bookmark.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: theme.fgSubtle,
                        cursor: 'pointer',
                        padding: '2px',
                        lineHeight: '1',
                        flexShrink: '0',
                      }}
                      title="Remove bookmark"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                className="input-field"
                type="text"
                value={newCommand}
                onChange={(e) => setNewCommand(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addBookmark();
                  }
                }}
                placeholder="e.g. npm run dev"
                style={{
                  flex: '1',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: theme.fg,
                  fontSize: '12px',
                  fontFamily: "'JetBrains Mono', monospace",
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={addBookmark}
                disabled={!newCommand.trim()}
                style={{
                  padding: '8px 14px',
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '8px',
                  color: newCommand.trim() ? theme.fg : theme.fgSubtle,
                  cursor: newCommand.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '12px',
                  flexShrink: '0',
                }}
              >
                Add
              </button>
            </div>
          </div>

          {/* Buttons */}
          <div
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
              onClick={() => onClose()}
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
              type="button"
              className="btn-primary"
              disabled={!canSave}
              onClick={handleSave}
              style={{
                padding: '9px 20px',
                background: theme.accent,
                border: 'none',
                borderRadius: '8px',
                color: theme.accentText,
                cursor: canSave ? 'pointer' : 'not-allowed',
                fontSize: '13px',
                fontWeight: '500',
                opacity: canSave ? '1' : '0.4',
              }}
            >
              Save
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
