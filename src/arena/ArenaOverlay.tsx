import './arena-shared.css';
import './arena-config.css';
import './arena-countdown.css';
import './arena-battle.css';
import './arena-results.css';
import './arena-history.css';
import { useEffect } from 'react';
import { useArenaStore, resetForNewMatch } from './store';
import { loadArenaPresets, loadArenaHistory } from './persistence';
import { ConfigScreen } from './ConfigScreen';
import { CountdownScreen } from './CountdownScreen';
import { BattleScreen } from './BattleScreen';
import { ResultsScreen } from './ResultsScreen';
import { HistoryScreen } from './HistoryScreen';

interface ArenaOverlayProps {
  onClose: () => void;
}

export function ArenaOverlay({ onClose }: ArenaOverlayProps) {
  const phase = useArenaStore((s) => s.phase);

  useEffect(() => {
    void loadArenaPresets();
    void loadArenaHistory();
  }, []);

  function handleClose() {
    void resetForNewMatch();
    onClose();
  }

  return (
    <div className="arena-overlay">
      <div className="arena-header">
        <div className="arena-title">
          <svg
            width="20"
            height="20"
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
          AI Arena
        </div>
        <button className="arena-close-btn" onClick={handleClose}>
          Close
        </button>
      </div>
      <div className={`arena-body${phase === 'battle' ? ' arena-body-battle' : ''}`}>
        {phase === 'config' && <ConfigScreen />}
        {phase === 'countdown' && <CountdownScreen />}
        {phase === 'battle' && <BattleScreen />}
        {phase === 'results' && <ResultsScreen />}
        {phase === 'history' && <HistoryScreen />}
      </div>
    </div>
  );
}
