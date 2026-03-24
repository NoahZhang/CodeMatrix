import { useStore } from '../store/store';
import { theme } from '../lib/theme';
import type { AgentDef } from '../ipc/types';

interface AgentSelectorProps {
  agents: AgentDef[];
  selectedAgent: AgentDef | null;
  onSelect: (agent: AgentDef) => void;
}

export function AgentSelector({ agents, selectedAgent, onSelect }: AgentSelectorProps) {
  const themePreset = useStore((s) => s.themePreset);

  return (
    <div data-nav-field="agent" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <label
        style={{
          fontSize: '11px',
          color: theme.fgMuted,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Agent
      </label>
      <div style={{ display: 'flex', gap: '8px' }}>
        {agents.map((agent) => {
          const isSelected = selectedAgent?.id === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              className={`agent-btn ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelect(agent)}
              style={{
                flex: '1',
                padding: '10px 8px',
                background: isSelected ? theme.bgSelected : theme.bgInput,
                border: isSelected ? `1px solid ${theme.accent}` : `1px solid ${theme.border}`,
                borderRadius: '8px',
                color: isSelected
                  ? themePreset === 'graphite' || themePreset === 'minimal'
                    ? '#ffffff'
                    : theme.accentText
                  : theme.fg,
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: isSelected ? '500' : '400',
                textAlign: 'center',
              }}
            >
              {agent.name}
              {agent.available === false && (
                <span
                  style={{
                    fontSize: '10px',
                    color: theme.fgMuted,
                    marginLeft: '4px',
                  }}
                >
                  (not installed)
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
