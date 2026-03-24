import { useState } from 'react';
import { addCustomAgent, removeCustomAgent } from '../store/store';
import { useStore } from '../store/store';
import { theme } from '../lib/theme';
import type { AgentDef } from '../ipc/types';

export function CustomAgentEditor() {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [resumeArgs, setResumeArgs] = useState('');
  const [skipArgs, setSkipArgs] = useState('');

  const customAgents = useStore((s) => s.customAgents);

  function handleAdd() {
    const n = name.trim();
    const cmd = command.trim();
    if (!n || !cmd) return;

    const id = n
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const agent: AgentDef = {
      id: `custom-${id}`,
      name: n,
      command: cmd,
      args: [],
      resume_args: resumeArgs.trim() ? resumeArgs.trim().split(/\s+/) : [],
      skip_permissions_args: skipArgs.trim() ? skipArgs.trim().split(/\s+/) : [],
      description: `Custom agent: ${n}`,
    };
    addCustomAgent(agent);
    setName('');
    setCommand('');
    setResumeArgs('');
    setSkipArgs('');
    setShowForm(false);
  }

  const inputStyle: React.CSSProperties = {
    padding: '8px 10px',
    background: theme.bgInput,
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    color: theme.fg,
    fontSize: '12px',
    width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {customAgents.map((agent) => (
        <div
          key={agent.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderRadius: '8px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '13px', color: theme.fg }}>{agent.name}</span>
            <span
              style={{
                fontSize: '11px',
                color: theme.fgSubtle,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {agent.command}
            </span>
          </div>
          <button
            type="button"
            onClick={() => removeCustomAgent(agent.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: theme.fgMuted,
              cursor: 'pointer',
              fontSize: '16px',
              padding: '0 4px',
            }}
          >
            &times;
          </button>
        </div>
      ))}

      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          style={{
            padding: '8px 12px',
            background: 'transparent',
            border: `1px dashed ${theme.border}`,
            borderRadius: '8px',
            color: theme.fgMuted,
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          + Add custom agent
        </button>
      )}

      {showForm && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            borderRadius: '8px',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
          }}
        >
          <input
            type="text"
            placeholder="Name (e.g. OpenCode)"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Command (e.g. opencode)"
            value={command}
            onChange={(e) => setCommand(e.currentTarget.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Resume args (optional, space-separated)"
            value={resumeArgs}
            onChange={(e) => setResumeArgs(e.currentTarget.value)}
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Skip permissions args (optional, space-separated)"
            value={skipArgs}
            onChange={(e) => setSkipArgs(e.currentTarget.value)}
            style={inputStyle}
          />
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              style={{
                padding: '6px 14px',
                background: 'transparent',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                color: theme.fgMuted,
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              style={{
                padding: '6px 14px',
                background: theme.accent,
                border: 'none',
                borderRadius: '6px',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '12px',
                opacity: name.trim() && command.trim() ? 1 : 0.5,
              }}
            >
              Add Agent
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
