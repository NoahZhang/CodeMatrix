import { useMemo } from 'react';
import { useAgents, useStatus } from './ws';
import type { RemoteAgent } from './protocol';

interface AgentListProps {
  onSelect: (agentId: string, taskName: string) => void;
}

export function AgentList(props: AgentListProps) {
  const agents = useAgents();
  const status = useStatus();

  const running = useMemo(() => agents.filter((a) => a.status === 'running').length, [agents]);
  const total = useMemo(() => agents.length, [agents]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0b0f14',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px 12px',
          borderBottom: '1px solid #223040',
          background: '#12181f',
        }}
      >
        <span style={{ fontSize: '17px', fontWeight: '600', color: '#d7e4f0' }}>CodeMatrix</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background:
                status === 'connected'
                  ? '#2fd198'
                  : status === 'connecting'
                    ? '#ffc569'
                    : '#ff5f73',
            }}
          />
          <span style={{ fontSize: '13px', color: '#678197' }}>
            {running}/{total}
          </span>
        </div>
      </div>

      {/* Connection status banner */}
      {status !== 'connected' && (
        <div
          style={{
            padding: '8px 16px',
            background: status === 'connecting' ? '#78350f' : '#7f1d1d',
            color: status === 'connecting' ? '#fde68a' : '#fca5a5',
            fontSize: '13px',
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {status === 'connecting' ? 'Reconnecting...' : 'Disconnected — check your network'}
        </div>
      )}

      {/* Agent cards */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        }}
      >
        {agents.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              color: '#678197',
              paddingTop: '60px',
              fontSize: '14px',
            }}
          >
            {status === 'connected' ? <span>No active agents</span> : <span>Connecting...</span>}
          </div>
        )}

        {/* Experimental notice */}
        <div
          style={{
            padding: '8px 12px',
            background: '#11182080',
            border: '1px solid #223040',
            borderRadius: '12px',
            fontSize: '12px',
            color: '#9bb0c3',
            textAlign: 'center',
            lineHeight: '1.5',
          }}
        >
          This is an experimental feature.{' '}
          <a
            href="https://github.com/NoahZhang/CodeMatrix/issues"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#2ec8ff' }}
          >
            Report bugs
          </a>
        </div>

        {agents.map((agent: RemoteAgent) => (
          <div
            key={agent.agentId}
            onClick={() => props.onSelect(agent.agentId, agent.taskName)}
            style={{
              background: '#0f141b',
              border: '1px solid #223040',
              borderRadius: '12px',
              padding: '14px 16px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              touchAction: 'manipulation',
              transition: 'background 0.16s ease',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  minWidth: 0,
                  flex: 1,
                }}
              >
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: agent.status === 'running' ? '#2fd198' : '#678197',
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#d7e4f0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {agent.taskName}
                </span>
              </div>
              <span
                style={{
                  fontSize: '12px',
                  color: agent.status === 'running' ? '#2fd198' : '#678197',
                  flexShrink: 0,
                }}
              >
                {agent.status}
              </span>
            </div>

            <div
              style={{
                fontSize: '11px',
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                color: '#678197',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {agent.agentId}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
