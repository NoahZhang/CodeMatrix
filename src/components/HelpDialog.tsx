import { Dialog } from './Dialog';
import { theme } from '../lib/theme';
import { alt, mod } from '../lib/platform';

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    title: 'Navigation',
    shortcuts: [
      [`${alt} + Up/Down`, 'Move between panels or sidebar tasks'],
      [`${alt} + Left/Right`, 'Navigate within row or across tasks'],
      [`${alt} + Left (from first task)`, 'Focus sidebar'],
      [`${alt} + Right (from sidebar)`, 'Focus active task'],
      ['Enter (in sidebar)', 'Jump to active task panel'],
    ],
  },
  {
    title: 'Task Actions',
    shortcuts: [
      [`${mod} + Enter`, 'Send prompt'],
      [`${mod} + W`, 'Close focused terminal'],
      [`${mod} + Shift + W`, 'Close active task/terminal'],
      [`${mod} + Shift + M`, 'Merge active task'],
      [`${mod} + Shift + P`, 'Push to remote'],
      [`${mod} + Shift + T`, 'New task shell terminal'],
      [`${mod} + Shift + Left/Right`, 'Reorder tasks/terminals'],
    ],
  },
  {
    title: 'App',
    shortcuts: [
      [`${mod} + N`, 'New task'],
      [`${mod} + Shift + D`, 'New standalone terminal'],
      [`${mod} + Shift + A`, 'New task'],
      [`${mod} + B`, 'Toggle sidebar'],
      [`${mod} + ,`, 'Open settings'],
      [`${mod} + 0`, 'Reset zoom'],
      ['Ctrl + Shift + Scroll', 'Resize all panel widths'],
      [`${mod} + / or F1`, 'Toggle this help'],
      ['Escape', 'Close dialogs'],
    ],
  },
];

export function HelpDialog({ open, onClose }: HelpDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} width="480px" panelStyle={{ gap: '20px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h2 style={{ margin: '0', fontSize: '16px', color: theme.fg, fontWeight: '600' }}>
          Keyboard Shortcuts
        </h2>
        <button
          onClick={() => onClose()}
          style={{
            background: 'transparent',
            border: 'none',
            color: theme.fgMuted,
            cursor: 'pointer',
            fontSize: '18px',
            padding: '0 4px',
            lineHeight: '1',
          }}
        >
          &times;
        </button>
      </div>

      {SECTIONS.map((section) => (
        <div key={section.title} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div
            style={{
              fontSize: '11px',
              color: theme.fgMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: '600',
            }}
          >
            {section.title}
          </div>
          {section.shortcuts.map(([key, desc]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 0',
              }}
            >
              <span style={{ color: theme.fgMuted, fontSize: '12px' }}>{desc}</span>
              <kbd
                style={{
                  background: theme.bgInput,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '4px',
                  padding: '2px 8px',
                  fontSize: '11px',
                  color: theme.fg,
                  fontFamily: "'JetBrains Mono', monospace",
                  whiteSpace: 'nowrap',
                }}
              >
                {key}
              </kbd>
            </div>
          ))}
        </div>
      ))}
    </Dialog>
  );
}
