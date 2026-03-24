import { useMemo } from 'react';
import {
  getCompletedTasksTodayCount,
  getMergedLineTotals,
  toggleHelpDialog,
  toggleArena,
} from '../store/store';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';
import { alt, mod } from '../lib/platform';

export function SidebarFooter() {
  const completedTasksToday = useMemo(() => getCompletedTasksTodayCount(), []);
  const mergedLines = useMemo(() => getMergedLineTotals(), []);

  return (
    <>
      <div
        style={{
          borderTop: `1px solid ${theme.border}`,
          paddingTop: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          flexShrink: '0',
        }}
      >
        <span
          style={{
            fontSize: sf(10),
            color: theme.fgSubtle,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Progress
        </span>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            padding: '8px 10px',
            fontSize: sf(11),
            color: theme.fgMuted,
          }}
        >
          <span>Completed today</span>
          <span
            style={{
              color: theme.fg,
              fontWeight: '600',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {completedTasksToday}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            padding: '8px 10px',
            fontSize: sf(11),
            color: theme.fgMuted,
          }}
        >
          <span>Merged to main/master</span>
          <span
            style={{
              color: theme.fg,
              fontWeight: '600',
              fontVariantNumeric: 'tabular-nums',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ color: theme.success }}>+{mergedLines.added.toLocaleString()}</span>
            <span style={{ color: theme.error }}>-{mergedLines.removed.toLocaleString()}</span>
          </span>
        </div>
        <button
          onClick={() => toggleArena(true)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            background: 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            padding: '8px 14px',
            fontSize: sf(12),
            color: theme.fgMuted,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: '500',
            marginTop: '6px',
          }}
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
            <path d="M3 3L13 13M9 12L12 9" />
            <path d="M13 3L3 13M4 9L7 12" />
          </svg>
          Arena
        </button>
      </div>

      {/* Tips */}
      <div
        onClick={() => toggleHelpDialog(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleHelpDialog(true);
          }
        }}
        tabIndex={0}
        role="button"
        style={{
          borderTop: `1px solid ${theme.border}`,
          paddingTop: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          flexShrink: '0',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            fontSize: sf(10),
            color: theme.fgSubtle,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Tips
        </span>
        <span
          style={{
            fontSize: sf(11),
            color: theme.fgMuted,
            lineHeight: '1.4',
          }}
        >
          <kbd
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              borderRadius: '3px',
              padding: '1px 4px',
              fontSize: sf(10),
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {alt} + Arrows
          </kbd>{' '}
          to navigate panels
        </span>
        <span
          style={{
            fontSize: sf(11),
            color: theme.fgMuted,
            lineHeight: '1.4',
          }}
        >
          <kbd
            style={{
              background: theme.bgInput,
              border: `1px solid ${theme.border}`,
              borderRadius: '3px',
              padding: '1px 4px',
              fontSize: sf(10),
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {mod} + /
          </kbd>{' '}
          for all shortcuts
        </span>
      </div>
    </>
  );
}
