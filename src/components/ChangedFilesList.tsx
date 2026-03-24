import { useState, useMemo, useEffect, useCallback } from 'react';
import { invoke } from '../lib/ipc';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { getStatusColor } from '../lib/status-colors';
import type { ChangedFile } from '../ipc/types';

interface ChangedFilesListProps {
  worktreePath: string;
  isActive?: boolean;
  onFileClick?: (file: ChangedFile) => void;
  ref?: React.Ref<HTMLDivElement>;
  /** Project root for branch-based fallback when worktree doesn't exist */
  projectRoot?: string;
  /** Branch name for branch-based fallback when worktree doesn't exist */
  branchName?: string | null;
}

export function ChangedFilesList(props: ChangedFilesListProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const list = files;
      if (list.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(list.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < list.length) {
          props.onFileClick?.(list[selectedIndex]);
        }
      }
    },
    [files, selectedIndex, props.onFileClick],
  );

  // Poll every 5s, matching the git status polling interval.
  // Falls back to branch-based diff when worktree path doesn't exist.
  useEffect(() => {
    const path = props.worktreePath;
    const projectRoot = props.projectRoot;
    const branchName = props.branchName;
    if (!props.isActive) return;
    let cancelled = false;
    let inFlight = false;
    let usingBranchFallback = false;

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      try {
        // Try worktree-based fetch first
        if (path && !usingBranchFallback) {
          try {
            const result = await invoke<ChangedFile[]>('get_changed_files', {
              worktreePath: path,
            });
            if (!cancelled) setFiles(result);
            return;
          } catch {
            // Worktree may not exist — try branch fallback below
          }
        }

        // Branch-based fallback: static data, no need to re-poll
        if (!usingBranchFallback && projectRoot && branchName) {
          usingBranchFallback = true;
          try {
            const result = await invoke<ChangedFile[]>('get_changed_files_from_branch', {
              projectRoot,
              branchName,
            });
            if (!cancelled) setFiles(result);
          } catch {
            // Branch may no longer exist
          }
        }
      } finally {
        inFlight = false;
      }
    }

    void refresh();
    const timer = setInterval(() => {
      if (!usingBranchFallback) void refresh();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [props.worktreePath, props.projectRoot, props.branchName, props.isActive]);

  const totalAdded = useMemo(() => files.reduce((s, f) => s + f.lines_added, 0), [files]);
  const totalRemoved = useMemo(() => files.reduce((s, f) => s + f.lines_removed, 0), [files]);
  const uncommittedCount = useMemo(() => files.filter((f) => !f.committed).length, [files]);

  /** For each file, compute the display filename and an optional disambiguating directory. */
  const fileDisplays = useMemo(() => {
    const list = files;

    // Count how many times each filename appears
    const nameCounts = new Map<string, number>();
    const parsed = list.map((f) => {
      const sep = f.path.lastIndexOf('/');
      const name = sep >= 0 ? f.path.slice(sep + 1) : f.path;
      const dir = sep >= 0 ? f.path.slice(0, sep) : '';
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      return { name, dir, fullPath: f.path };
    });

    // For duplicates, find the shortest disambiguating parent suffix
    return parsed.map((p) => {
      if ((nameCounts.get(p.name) ?? 0) <= 1 || !p.dir) {
        return { name: p.name, disambig: '', fullPath: p.fullPath };
      }
      // Find all entries with the same filename
      const siblings = parsed.filter((s) => s.name === p.name && s.fullPath !== p.fullPath);
      const parts = p.dir.split('/');
      // Walk from the immediate parent upward until unique
      for (let depth = 1; depth <= parts.length; depth++) {
        const suffix = parts.slice(parts.length - depth).join('/');
        const isUnique = siblings.every((s) => {
          const sParts = s.dir.split('/');
          const sSuffix = sParts.slice(sParts.length - depth).join('/');
          return sSuffix !== suffix;
        });
        if (isUnique) {
          return { name: p.name, disambig: suffix + '/', fullPath: p.fullPath };
        }
      }
      // Fallback: show full directory
      return { name: p.name, disambig: p.dir + '/', fullPath: p.fullPath };
    });
  }, [files]);

  return (
    <div
      ref={props.ref as React.RefObject<HTMLDivElement>}
      className="focusable-panel"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: sf(11),
        outline: 'none',
      }}
    >
      <div style={{ flex: '1', overflow: 'auto', padding: '4px 0' }}>
        {files.map((file, i) => (
          <div
            key={file.path}
            className="file-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 8px',
              whiteSpace: 'nowrap',
              cursor: props.onFileClick ? 'pointer' : 'default',
              borderRadius: '3px',
              opacity: file.committed ? '0.45' : '1',
              background: selectedIndex === i ? theme.bgHover : 'transparent',
            }}
            onClick={() => {
              setSelectedIndex(i);
              props.onFileClick?.(file);
            }}
          >
            <span
              style={{
                color: getStatusColor(file.status),
                fontWeight: '600',
                width: '12px',
                textAlign: 'center',
                flexShrink: '0',
              }}
            >
              {file.status}
            </span>
            <span
              style={{
                flex: '1',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                display: 'flex',
                gap: '4px',
                alignItems: 'baseline',
              }}
              title={file.path}
            >
              <span style={{ color: theme.fg }}>{fileDisplays[i].name}</span>
              {fileDisplays[i].disambig && (
                <span style={{ color: theme.fgMuted, fontSize: sf(10) }}>
                  {fileDisplays[i].disambig}
                </span>
              )}
            </span>
            {(file.lines_added > 0 || file.lines_removed > 0) && (
              <>
                <span style={{ color: theme.success, flexShrink: '0' }}>
                  +{file.lines_added}
                </span>
                <span style={{ color: theme.error, flexShrink: '0' }}>
                  -{file.lines_removed}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
      {files.length > 0 && (
        <div
          style={{
            padding: '4px 8px',
            borderTop: `1px solid ${theme.border}`,
            color: theme.fgMuted,
            flexShrink: '0',
          }}
        >
          {files.length} files, <span style={{ color: theme.success }}>+{totalAdded}</span>{' '}
          <span style={{ color: theme.error }}>-{totalRemoved}</span>
          {uncommittedCount > 0 && uncommittedCount < files.length && (
            <>
              {' '}
              <span style={{ color: theme.warning }}>({uncommittedCount} uncommitted)</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
