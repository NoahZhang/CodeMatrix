import { theme } from '../lib/theme';

interface BranchPrefixFieldProps {
  branchPrefix: string;
  branchPreview: string;
  projectPath: string | undefined;
  onPrefixChange: (prefix: string) => void;
}

export function BranchPrefixField({
  branchPrefix,
  branchPreview,
  projectPath,
  onPrefixChange,
}: BranchPrefixFieldProps) {
  return (
    <div
      data-nav-field="branch-prefix"
      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <label style={{ fontSize: '11px', color: theme.fgSubtle, whiteSpace: 'nowrap' }}>
          Branch prefix
        </label>
        <input
          className="input-field"
          type="text"
          value={branchPrefix}
          onChange={(e) => onPrefixChange(e.currentTarget.value)}
          placeholder="task"
          style={{
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            padding: '4px 8px',
            color: theme.fg,
            fontSize: '12px',
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
            width: '120px',
          }}
        />
      </div>
      {branchPreview && projectPath && (
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
            {branchPreview}
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
            {projectPath}/.worktrees/{branchPreview}
          </span>
        </div>
      )}
    </div>
  );
}
