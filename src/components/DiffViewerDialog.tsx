import { useState, useEffect, useRef } from 'react';
import { Dialog } from './Dialog';
import { invoke } from '../lib/ipc';
import { IPC } from '../lib/channels';
import { theme } from '../lib/theme';
import { isBinaryDiff } from '../lib/diff-parser';
import { getStatusColor } from '../lib/status-colors';
import { openFileInEditor } from '../lib/shell';
import { MonacoDiffEditor } from './MonacoDiffEditor';
import type { ChangedFile, FileDiffResult } from '../ipc/types';

interface DiffViewerDialogProps {
  file: ChangedFile | null;
  worktreePath: string;
  onClose: () => void;
  /** Project root for branch-based fallback when worktree doesn't exist */
  projectRoot?: string;
  /** Branch name for branch-based fallback when worktree doesn't exist */
  branchName?: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  '?': 'Untracked',
};

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  dockerfile: 'dockerfile',
  lua: 'lua',
  cpp: 'cpp',
  c: 'c',
  h: 'c',
  hpp: 'cpp',
};

function detectLang(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const basename = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (basename === 'dockerfile') return 'dockerfile';
  if (basename === 'makefile') return 'makefile';
  return EXT_TO_LANG[ext] ?? 'plaintext';
}

export function DiffViewerDialog({ file, worktreePath, onClose, projectRoot, branchName }: DiffViewerDialogProps) {
  const [oldContent, setOldContent] = useState('');
  const [newContent, setNewContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [binary, setBinary] = useState(false);
  const [sideBySide, setSideBySide] = useState(true);
  const [hasChanges, setHasChanges] = useState(true);
  const [metadataOnly, setMetadataOnly] = useState(false);

  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    if (!file) return;

    const thisGen = ++fetchGenerationRef.current;

    setLoading(true);
    setError('');
    setBinary(false);
    setOldContent('');
    setNewContent('');
    setHasChanges(true);
    setMetadataOnly(false);

    const worktreePromise = worktreePath
      ? invoke<FileDiffResult>(IPC.GetFileDiff, { worktreePath, filePath: file.path })
      : Promise.reject(new Error('no worktree'));

    worktreePromise
      .catch((err: unknown) => {
        if (projectRoot && branchName) {
          return invoke<FileDiffResult>(IPC.GetFileDiffFromBranch, {
            projectRoot,
            branchName,
            filePath: file.path,
          });
        }
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not load diff: ${msg}`);
      })
      .then((result) => {
        if (thisGen !== fetchGenerationRef.current) return;
        if (isBinaryDiff(result.diff)) {
          setBinary(true);
        } else {
          setOldContent(result.oldContent);
          setNewContent(result.newContent);
          const contentDiffers = result.oldContent !== result.newContent;
          setHasChanges(result.diff !== '' || contentDiffers);
          setMetadataOnly(result.diff !== '' && !contentDiffers);
        }
      })
      .catch((err) => {
        if (thisGen !== fetchGenerationRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (thisGen === fetchGenerationRef.current) setLoading(false);
      });
  }, [file, worktreePath, projectRoot, branchName]);

  return (
    <Dialog
      open={file !== null}
      onClose={onClose}
      width="90vw"
      panelStyle={{
        height: '85vh',
        maxWidth: '1400px',
        overflow: 'hidden',
        padding: '0',
        gap: '0',
      }}
    >
      {file && (
        <>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '16px 20px',
              borderBottom: `1px solid ${theme.border}`,
              flexShrink: '0',
            }}
          >
            <span
              style={{
                fontSize: '11px',
                fontWeight: '600',
                padding: '2px 8px',
                borderRadius: '4px',
                color: getStatusColor(file.status),
                background: 'rgba(255,255,255,0.06)',
              }}
            >
              {STATUS_LABELS[file.status] ?? file.status}
            </span>
            <span
              style={{
                flex: '1',
                fontSize: '13px',
                fontFamily: "'JetBrains Mono', monospace",
                color: theme.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {file.path}
            </span>

            {/* Split / Unified toggle */}
            <div
              style={{
                display: 'flex',
                gap: '2px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: '6px',
                padding: '2px',
              }}
            >
              <button
                onClick={() => setSideBySide(true)}
                style={{
                  background: sideBySide ? 'rgba(255,255,255,0.10)' : 'transparent',
                  border: 'none',
                  color: sideBySide ? theme.fg : theme.fgMuted,
                  fontSize: '11px',
                  padding: '3px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Split
              </button>
              <button
                onClick={() => setSideBySide(false)}
                style={{
                  background: !sideBySide ? 'rgba(255,255,255,0.10)' : 'transparent',
                  border: 'none',
                  color: !sideBySide ? theme.fg : theme.fgMuted,
                  fontSize: '11px',
                  padding: '3px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Unified
              </button>
            </div>

            <button
              onClick={() => openFileInEditor(worktreePath, file.path)}
              disabled={!worktreePath}
              style={{
                background: 'transparent',
                border: 'none',
                color: theme.fgMuted,
                cursor: worktreePath ? 'pointer' : 'default',
                opacity: worktreePath ? '1' : '0.3',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '4px',
              }}
              title="Open in editor"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.5 2a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-3a.75.75 0 0 1 1.5 0v3A3 3 0 0 1 12.5 16h-9A3 3 0 0 1 0 12.5v-9A3 3 0 0 1 3.5 0h3a.75.75 0 0 1 0 1.5h-3ZM10 .75a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V2.56L8.53 8.53a.75.75 0 0 1-1.06-1.06L13.44 1.5H10.75A.75.75 0 0 1 10 .75Z" />
              </svg>
            </button>

            <button
              onClick={() => onClose()}
              style={{
                background: 'transparent',
                border: 'none',
                color: theme.fgMuted,
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '4px',
              }}
              title="Close"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div
            style={{
              flex: '1',
              overflow: 'hidden',
            }}
          >
            {loading && (
              <div style={{ padding: '40px', textAlign: 'center', color: theme.fgMuted }}>
                Loading diff...
              </div>
            )}

            {error && (
              <div style={{ padding: '40px', textAlign: 'center', color: theme.error }}>
                {error}
              </div>
            )}

            {binary && (
              <div style={{ padding: '40px', textAlign: 'center', color: theme.fgMuted }}>
                Binary file — cannot display diff
              </div>
            )}

            {!loading && !error && !binary && !hasChanges && (
              <div style={{ padding: '40px', textAlign: 'center', color: theme.fgMuted }}>
                No changes
              </div>
            )}

            {!loading && !error && !binary && metadataOnly && (
              <div style={{ padding: '40px', textAlign: 'center', color: theme.fgMuted }}>
                File metadata changed (permissions/mode) — no content differences
              </div>
            )}

            {!loading && !error && !binary && hasChanges && !metadataOnly && (
              <MonacoDiffEditor
                oldContent={oldContent}
                newContent={newContent}
                language={detectLang(file.path)}
                sideBySide={sideBySide}
              />
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
