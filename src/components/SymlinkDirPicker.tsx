import { theme } from '../lib/theme';

interface SymlinkDirPickerProps {
  dirs: string[];
  selectedDirs: Set<string>;
  onToggle: (dir: string) => void;
}

export function SymlinkDirPicker({ dirs, selectedDirs, onToggle }: SymlinkDirPickerProps) {
  return (
    <div
      data-nav-field="symlink-dirs"
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
        Symlink into worktree
      </label>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          padding: '8px 10px',
          background: theme.bgElevated,
          borderRadius: '6px',
          border: `1px solid ${theme.border}`,
        }}
      >
        {dirs.map((dir) => {
          const checked = selectedDirs.has(dir);
          return (
            <label
              key={dir}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '12px',
                fontFamily: "'JetBrains Mono', monospace",
                color: theme.fg,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(dir)}
                style={{ accentColor: theme.accent }}
              />
              {dir}
            </label>
          );
        })}
      </div>
    </div>
  );
}
