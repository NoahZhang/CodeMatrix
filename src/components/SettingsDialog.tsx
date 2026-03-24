import { useMemo } from 'react';
import { Dialog } from './Dialog';
import { getAvailableTerminalFonts, getTerminalFontFamily, LIGATURE_FONTS } from '../lib/fonts';
import { LOOK_PRESETS } from '../lib/look';
import { theme } from '../lib/theme';
import {
  useStore,
  setTerminalFont,
  setThemePreset,
  setAutoTrustFolders,
  setShowPlans,
  setInactiveColumnOpacity,
  setEditorCommand,
} from '../store/store';
import { CustomAgentEditor } from './CustomAgentEditor';
import { mod } from '../lib/platform';
import type { TerminalFont } from '../lib/fonts';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const terminalFont = useStore((s) => s.terminalFont);
  const themePreset = useStore((s) => s.themePreset);
  const autoTrustFolders = useStore((s) => s.autoTrustFolders);
  const showPlans = useStore((s) => s.showPlans);
  const inactiveColumnOpacity = useStore((s) => s.inactiveColumnOpacity);
  const editorCommand = useStore((s) => s.editorCommand);

  const fonts = useMemo<TerminalFont[]>(() => {
    const available = getAvailableTerminalFonts();
    // Always include the currently selected font so it stays visible even if detection misses it
    if (available.includes(terminalFont)) return available;
    return [terminalFont, ...available];
  }, [terminalFont]);

  return (
    <Dialog
      open={props.open}
      onClose={props.onClose}
      width="640px"
      zIndex={1100}
      panelStyle={{ maxWidth: 'calc(100vw - 32px)', padding: '24px', gap: '18px' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <h2
            style={{
              margin: '0',
              fontSize: '16px',
              color: theme.fg,
              fontWeight: '600',
            }}
          >
            Settings
          </h2>
          <span style={{ fontSize: '12px', color: theme.fgSubtle }}>
            Customize your workspace. Shortcut:{' '}
            <kbd
              style={{
                background: theme.bgInput,
                border: `1px solid ${theme.border}`,
                borderRadius: '4px',
                padding: '1px 6px',
                fontFamily: "'JetBrains Mono', monospace",
                color: theme.fgMuted,
              }}
            >
              {mod}+,
            </kbd>
          </span>
        </div>
        <button
          onClick={() => props.onClose()}
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            fontSize: '11px',
            color: theme.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: '600',
          }}
        >
          Theme
        </div>
        <div className="settings-theme-grid">
          {LOOK_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`settings-theme-card${themePreset === preset.id ? ' active' : ''}`}
              onClick={() => setThemePreset(preset.id)}
            >
              <span className="settings-theme-title">{preset.label}</span>
              <span className="settings-theme-desc">{preset.description}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            fontSize: '11px',
            color: theme.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: '600',
          }}
        >
          Behavior
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            padding: '8px 12px',
            borderRadius: '8px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
          }}
        >
          <input
            type="checkbox"
            checked={autoTrustFolders}
            onChange={(e) => setAutoTrustFolders(e.currentTarget.checked)}
            style={{ accentColor: theme.accent, cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '13px', color: theme.fg }}>Auto-trust folders</span>
            <span style={{ fontSize: '11px', color: theme.fgSubtle }}>
              Automatically accept trust and permission dialogs from agents
            </span>
          </div>
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            cursor: 'pointer',
            padding: '8px 12px',
            borderRadius: '8px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
          }}
        >
          <input
            type="checkbox"
            checked={showPlans}
            onChange={(e) => setShowPlans(e.currentTarget.checked)}
            style={{ accentColor: theme.accent, cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '13px', color: theme.fg }}>Show plans</span>
            <span style={{ fontSize: '11px', color: theme.fgSubtle }}>
              Display Claude Code plan files in a tab next to Notes
            </span>
          </div>
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            fontSize: '11px',
            color: theme.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: '600',
          }}
        >
          Editor
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span style={{ fontSize: '13px', color: theme.fg, whiteSpace: 'nowrap' }}>
              Editor command
            </span>
            <input
              type="text"
              value={editorCommand}
              onChange={(e) => setEditorCommand(e.currentTarget.value)}
              placeholder="e.g. code, cursor, zed, subl"
              style={{
                flex: '1',
                background: theme.taskPanelBg,
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                padding: '6px 10px',
                color: theme.fg,
                fontSize: '13px',
                fontFamily: "'JetBrains Mono', monospace",
                outline: 'none',
              }}
            />
          </label>
          <span style={{ fontSize: '11px', color: theme.fgSubtle }}>
            CLI command to open worktree folders. Click the path bar in a task to open it.
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            fontSize: '11px',
            color: theme.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: '600',
          }}
        >
          Focus Dimming
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '8px 12px',
            borderRadius: '8px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: '13px', color: theme.fg }}>Inactive column opacity</span>
            <span
              style={{
                fontSize: '12px',
                color: theme.fgMuted,
                fontFamily: "'JetBrains Mono', monospace",
                minWidth: '36px',
                textAlign: 'right',
              }}
            >
              {Math.round(inactiveColumnOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="30"
            max="100"
            step="5"
            value={inactiveColumnOpacity * 100}
            onChange={(e) => setInactiveColumnOpacity(Number(e.currentTarget.value) / 100)}
            style={{
              width: '100%',
              accentColor: theme.accent,
              cursor: 'pointer',
            }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '10px',
              color: theme.fgSubtle,
            }}
          >
            <span>More dimmed</span>
            <span>No dimming</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            fontSize: '11px',
            color: theme.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: '600',
          }}
        >
          Custom Agents
        </div>
        <CustomAgentEditor />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            fontSize: '11px',
            color: theme.fgMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: '600',
          }}
        >
          Terminal Font
        </div>
        <div className="settings-font-grid">
          {fonts.map((font) => (
            <button
              key={font}
              type="button"
              className={`settings-font-card${terminalFont === font ? ' active' : ''}`}
              onClick={() => setTerminalFont(font)}
            >
              <span className="settings-font-name">{font}</span>
              <span
                className="settings-font-preview"
                style={{ fontFamily: getTerminalFontFamily(font) }}
              >
                AaBb 0Oo1Il →
              </span>
            </button>
          ))}
        </div>
        {LIGATURE_FONTS.has(terminalFont) && (
          <span style={{ fontSize: '11px', color: theme.fgSubtle }}>
            This font includes ligatures which may impact rendering performance.
          </span>
        )}
      </div>
    </Dialog>
  );
}
