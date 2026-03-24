import { useState, useEffect } from 'react';
import { initAuth } from './auth';
import { connect } from './ws';
import { AgentList } from './AgentList';
import { AgentDetail } from './AgentDetail';

export function App() {
  const [authed, setAuthed] = useState(false);
  // Separate view state from detail data so the agentId/taskName state
  // never becomes empty while AgentDetail is still mounted (avoids race
  // where conditional rendering unmounts children *after* props re-evaluate to null).
  const [view, setView] = useState<'list' | 'detail'>('list');
  const [detailAgentId, setDetailAgentId] = useState('');
  const [detailTaskName, setDetailTaskName] = useState('');

  function selectAgent(id: string, name: string) {
    setDetailAgentId(id);
    setDetailTaskName(name);
    setView('detail');
  }

  useEffect(() => {
    const token = initAuth();
    if (token) {
      setAuthed(true);
      connect();
    }
  }, []);

  if (!authed) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#999',
          fontSize: '16px',
          padding: '20px',
          textAlign: 'center',
        }}
      >
        <div>
          <p style={{ marginBottom: '12px' }}>Not authenticated.</p>
          <p style={{ fontSize: '13px', color: '#666' }}>
            Scan the QR code from the CodeMatrix desktop app to connect.
          </p>
        </div>
      </div>
    );
  }

  return view === 'detail' ? (
    <AgentDetail
      agentId={detailAgentId}
      taskName={detailTaskName}
      onBack={() => setView('list')}
    />
  ) : (
    <AgentList onSelect={selectAgent} />
  );
}
