import { useState, useEffect, useCallback, useRef } from 'react';
import { appWindow } from '../lib/window';

export function WindowTitleBar() {
  const [isFocused, setIsFocused] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);

  const maximizeDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const syncMaximizedState = useCallback(async () => {
    const maximized = await appWindow.isMaximized().catch((error) => {
      console.warn('Failed to query maximize state', error);
      return false;
    });
    setIsMaximized(maximized);
  }, []);

  const debouncedSyncMaximized = useCallback(() => {
    if (maximizeDebounceTimerRef.current !== undefined) clearTimeout(maximizeDebounceTimerRef.current);
    maximizeDebounceTimerRef.current = setTimeout(() => {
      maximizeDebounceTimerRef.current = undefined;
      void syncMaximizedState();
    }, 150);
  }, [syncMaximizedState]);

  useEffect(() => {
    let cleaned = false;
    let unlistenResize: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    void syncMaximizedState();
    void appWindow
      .isFocused()
      .then(setIsFocused)
      .catch((error) => {
        console.warn('Failed to query focus state', error);
      });

    void (async () => {
      try {
        unlistenResize = await appWindow.onResized(() => {
          debouncedSyncMaximized();
        });
        if (cleaned) {
          unlistenResize();
          unlistenResize = null;
        }
      } catch {
        unlistenResize = null;
      }

      try {
        unlistenFocus = await appWindow.onFocusChanged((event) => {
          setIsFocused(Boolean(event.payload));
        });
        if (cleaned) {
          unlistenFocus();
          unlistenFocus = null;
        }
      } catch {
        unlistenFocus = null;
      }
    })();

    return () => {
      cleaned = true;
      if (maximizeDebounceTimerRef.current !== undefined) clearTimeout(maximizeDebounceTimerRef.current);
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, [syncMaximizedState, debouncedSyncMaximized]);

  const handleToggleMaximize = useCallback(async () => {
    await appWindow.toggleMaximize().catch((error) => {
      console.warn('Failed to toggle maximize', error);
    });
    void syncMaximizedState();
  }, [syncMaximizedState]);

  const handleDragStart = useCallback((event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void appWindow.startDragging().catch((error) => {
      console.warn('Failed to start dragging window', error);
    });
  }, []);

  return (
    <div className={`window-titlebar${isFocused ? '' : ' unfocused'}`}>
      <div
        data-tauri-drag-region
        className="window-drag-region"
        onMouseDown={handleDragStart}
        onDoubleClick={() => void handleToggleMaximize()}
      >
        <svg
          className="window-title-icon"
          viewBox="0 0 56 56"
          fill="none"
          stroke="#ffffff"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="10" y1="6" x2="10" y2="50" />
          <line x1="22" y1="6" x2="22" y2="50" />
          <path d="M30 8 H47 V24 H30" />
          <path d="M49 32 H32 V48 H49" />
        </svg>
      </div>
      <div className="window-controls">
        <button
          className="window-control-btn"
          onClick={() => {
            void appWindow.minimize().catch((error) => {
              console.warn('Failed to minimize window', error);
            });
          }}
          aria-label="Minimize window"
          title="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1 5h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="window-control-btn"
          onClick={() => void handleToggleMaximize()}
          aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 1.5h6v6H2z" stroke="currentColor" strokeWidth="1.1" />
              <path d="M1 3.5v5h5" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <rect x="1.5" y="1.5" width="7" height="7" stroke="currentColor" strokeWidth="1.1" />
            </svg>
          )}
        </button>
        <button
          className="window-control-btn close"
          onClick={() => {
            void appWindow.close().catch((error) => {
              console.warn('Failed to close window', error);
            });
          }}
          aria-label="Close window"
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path
              d="M2 2l6 6M8 2 2 8"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
