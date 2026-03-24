import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import {
  subscribeAgent,
  unsubscribeAgent,
  onOutput,
  onScrollback,
  sendInput,
  useAgents,
  useStatus,
} from './ws';

// Base64 decode (same approach as desktop)
const B64 = new Uint8Array(128);
for (let i = 0; i < 64; i++) {
  B64['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i)] = i;
}

function b64decode(b64: string): Uint8Array {
  let end = b64.length;
  while (end > 0 && b64.charCodeAt(end - 1) === 61) end--;
  const out = new Uint8Array((end * 3) >>> 2);
  let j = 0;
  for (let i = 0; i < end; ) {
    const a = B64[b64.charCodeAt(i++)];
    const b = i < end ? B64[b64.charCodeAt(i++)] : 0;
    const c = i < end ? B64[b64.charCodeAt(i++)] : 0;
    const d = i < end ? B64[b64.charCodeAt(i++)] : 0;
    const triplet = (a << 18) | (b << 12) | (c << 6) | d;
    out[j++] = (triplet >>> 16) & 0xff;
    if (j < out.length) out[j++] = (triplet >>> 8) & 0xff;
    if (j < out.length) out[j++] = triplet & 0xff;
  }
  return out;
}

// Build control characters at runtime via lookup — avoids Vite stripping \r during build
const KEYS: Record<number, string> = {};
[3, 4, 13, 27].forEach((c) => {
  KEYS[c] = String.fromCharCode(c);
});
function key(c: number): string {
  return KEYS[c];
}

interface AgentDetailProps {
  agentId: string;
  taskName: string;
  onBack: () => void;
}

export function AgentDetail(props: AgentDetailProps) {
  const termContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [inputText, setInputText] = useState('');
  const [atBottom, setAtBottom] = useState(true);
  const [termFontSize, setTermFontSize] = useState(10);

  const MIN_FONT = 6;
  const MAX_FONT = 24;

  const agents = useAgents();
  const status = useStatus();

  const agentInfo = useMemo(
    () => agents.find((a) => a.agentId === props.agentId),
    [agents, props.agentId],
  );

  // Dedup guard: multiple event sources (keydown, onInput fallback) can
  // fire handleSend for the same Enter press. The sendId ensures only
  // the latest invocation sends the delayed \r.
  const lastSendIdRef = useRef(0);

  const handleSend = useCallback(() => {
    const text = inputText;
    if (!text) return;
    const id = ++lastSendIdRef.current;
    // Send text and Enter separately — TUI apps (Claude Code, Codex)
    // treat \r inside a pasted block as a literal, not as confirmation.
    sendInput(props.agentId, text);
    setInputText('');
    setTimeout(() => {
      if (lastSendIdRef.current === id) sendInput(props.agentId, key(13));
    }, 50);
  }, [inputText, props.agentId]);

  // Keep a ref to handleSend so the keydown listener always calls the latest version
  const handleSendRef = useRef(handleSend);
  handleSendRef.current = handleSend;

  useEffect(() => {
    const termContainer = termContainerRef.current;
    const inputEl = inputRef.current;
    if (!termContainer) return;

    // Attach native Enter detection directly to the input element.
    // React event delegation + Android IMEs are unreliable for form submit.
    const enterHandler = (e: Event) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' || ke.keyCode === 13) {
        e.preventDefault();
        handleSendRef.current();
      }
    };
    if (inputEl) {
      inputEl.addEventListener('keydown', enterHandler);
    }

    // Disable xterm helper elements that capture touch events over
    // the header/input areas (not needed since disableStdin is true)
    const style = document.createElement('style');
    style.textContent =
      '.xterm-helper-textarea, .xterm-composition-view { pointer-events: none !important; }';
    document.head.appendChild(style);

    const term = new Terminal({
      fontSize: 10,
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      theme: { background: '#0b0f14' },
      scrollback: 5000,
      cursorBlink: false,
      disableStdin: true,
      convertEol: false,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.open(termContainer);
    fitAddon.fit();

    term.onScroll(() => {
      const isBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
      setAtBottom(isBottom);
    });

    const cleanupScrollback = onScrollback(props.agentId, (data, cols) => {
      if (cols > 0) {
        term.resize(cols, term.rows);
      }
      // Clear before writing — on reconnect the server re-sends the full
      // scrollback buffer, so we must avoid duplicate content.
      term.clear();
      const bytes = b64decode(data);
      term.write(bytes, () => term.scrollToBottom());
    });

    const cleanupOutput = onOutput(props.agentId, (data) => {
      const bytes = b64decode(data);
      term.write(bytes);
    });

    subscribeAgent(props.agentId);

    let resizeRaf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => fitAddon.fit());
    });
    observer.observe(termContainer);

    // Refit terminal when soft keyboard opens/closes on mobile
    const onViewportResize = () => fitAddon.fit();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportResize);
    }

    // Manual touch scrolling for mobile — xterm.js doesn't handle this well
    let touchStartY = 0;
    let touchActive = false;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchActive = true;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive || e.touches.length !== 1) return;
      const dy = touchStartY - e.touches[0].clientY;
      const lineHeight = term.options.fontSize ?? 13;
      const lines = Math.trunc(dy / lineHeight);
      if (lines !== 0) {
        term.scrollLines(lines);
        touchStartY = e.touches[0].clientY;
      }
      e.preventDefault();
    };
    const onTouchEnd = () => {
      touchActive = false;
    };
    termContainer.addEventListener('touchstart', onTouchStart, { passive: true });
    termContainer.addEventListener('touchmove', onTouchMove, { passive: false });
    termContainer.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      inputEl?.removeEventListener('keydown', enterHandler);
      style.remove();
      termContainer.removeEventListener('touchstart', onTouchStart);
      termContainer.removeEventListener('touchmove', onTouchMove);
      termContainer.removeEventListener('touchend', onTouchEnd);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      observer.disconnect();
      unsubscribeAgent(props.agentId);
      cleanupScrollback();
      cleanupOutput();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.agentId]);

  function handleQuickAction(data: string) {
    sendInput(props.agentId, data);
  }

  function scrollToBottom() {
    termRef.current?.scrollToBottom();
  }

  const quickActions = useMemo(
    () => [
      { label: 'Enter', data: key(13) },
      { label: '\u2191', data: key(27) + '[A' },
      { label: '\u2193', data: key(27) + '[B' },
      { label: 'Ctrl+C', data: key(3) },
    ],
    [],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0b0f14',
        position: 'relative',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 14px',
          borderBottom: '1px solid #223040',
          flexShrink: 0,
          position: 'relative',
          zIndex: 10,
          background: '#12181f',
        }}
      >
        <button
          onClick={() => props.onBack()}
          style={{
            background: 'none',
            border: 'none',
            color: '#2ec8ff',
            fontSize: '16px',
            cursor: 'pointer',
            padding: '8px 10px',
            touchAction: 'manipulation',
          }}
        >
          &#8592; Back
        </button>
        <span
          style={{
            fontSize: '14px',
            fontWeight: '500',
            color: '#d7e4f0',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {props.taskName}
        </span>
        <div
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: agentInfo?.status === 'running' ? '#2fd198' : '#678197',
          }}
        />
      </div>

      {/* Connection status banner */}
      {status !== 'connected' && (
        <div
          style={{
            padding: '6px 16px',
            background: status === 'connecting' ? '#78350f' : '#7f1d1d',
            color: status === 'connecting' ? '#fde68a' : '#fca5a5',
            fontSize: '12px',
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {status === 'connecting' ? 'Reconnecting...' : 'Disconnected — check your network'}
        </div>
      )}

      {/* Terminal — overflow:hidden clips xterm.js overlays so they don't
           capture touch events over the header/input areas */}
      <div
        ref={termContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          padding: '4px',
          position: 'relative',
          overflow: 'hidden',
        }}
      />

      {/* Scroll to bottom FAB */}
      {!atBottom && (
        <button
          onClick={scrollToBottom}
          style={{
            position: 'absolute',
            bottom: '140px',
            right: '16px',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: '#12181f',
            border: '1px solid #223040',
            color: '#d7e4f0',
            fontSize: '16px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10,
            touchAction: 'manipulation',
          }}
        >
          &#8595;
        </button>
      )}

      {/* Input area */}
      <div
        style={{
          borderTop: '1px solid #223040',
          padding: '8px 10px max(8px, env(safe-area-inset-bottom)) 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          flexShrink: 0,
          background: '#12181f',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* No <form> — it triggers Chrome's autofill heuristics on Android.
             name/id/autocomplete use gibberish so Chrome can't classify the field. */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            ref={inputRef}
            type="text"
            enterKeyHint="send"
            name="xq9k_cmd"
            id="xq9k_cmd"
            autoComplete="xq9k_cmd"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            value={inputText}
            onChange={(e) => {
              const val = e.currentTarget.value;
              // Fallback: some Android IMEs insert newline into the value
              const last = val.charCodeAt(val.length - 1);
              if (last === 10 || last === 13) {
                const clean = val.slice(0, -1);
                setInputText(clean);
                e.currentTarget.value = clean;
                handleSendRef.current();
                return;
              }
              setInputText(val);
            }}
            placeholder="Type command..."
            style={{
              flex: 1,
              background: '#10161d',
              border: '1px solid #223040',
              borderRadius: '12px',
              padding: '10px 14px',
              color: '#d7e4f0',
              fontSize: '14px',
              fontFamily: "'JetBrains Mono', 'Courier New', monospace",
              outline: 'none',
              transition: 'border-color 0.16s ease',
            }}
          />
          <button
            type="button"
            disabled={!inputText.trim()}
            onClick={() => handleSendRef.current()}
            style={{
              background: inputText.trim() ? '#2ec8ff' : '#1a2430',
              border: 'none',
              borderRadius: '50%',
              width: '40px',
              height: '40px',
              color: inputText.trim() ? '#031018' : '#678197',
              cursor: inputText.trim() ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              flexShrink: 0,
              touchAction: 'manipulation',
              transition: 'background 0.15s, color 0.15s',
            }}
            title="Send"
          >
            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 12V2M7 2L3 6M7 2l4 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {quickActions.map((action) => (
            <button
              key={action.label}
              onClick={() => handleQuickAction(action.data)}
              style={{
                background: '#1a2430',
                border: '1px solid #223040',
                borderRadius: '8px',
                padding: '10px 16px',
                color: '#9bb0c3',
                fontSize: '13px',
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                cursor: 'pointer',
                touchAction: 'manipulation',
                transition: 'background 0.16s ease',
              }}
            >
              {action.label}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            <button
              onClick={() => {
                const next = Math.max(MIN_FONT, termFontSize - 1);
                setTermFontSize(next);
                const term = termRef.current;
                if (term) {
                  term.options.fontSize = next;
                  fitAddonRef.current?.fit();
                }
              }}
              disabled={termFontSize <= MIN_FONT}
              style={{
                background: '#1a2430',
                border: '1px solid #223040',
                borderRadius: '8px',
                padding: '10px 14px',
                color: termFontSize <= MIN_FONT ? '#344050' : '#9bb0c3',
                fontSize: '13px',
                fontWeight: '700',
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                cursor: termFontSize <= MIN_FONT ? 'default' : 'pointer',
                touchAction: 'manipulation',
                transition: 'background 0.16s ease',
              }}
              title="Decrease font size"
            >
              A-
            </button>
            <button
              onClick={() => {
                const next = Math.min(MAX_FONT, termFontSize + 1);
                setTermFontSize(next);
                const term = termRef.current;
                if (term) {
                  term.options.fontSize = next;
                  fitAddonRef.current?.fit();
                }
              }}
              disabled={termFontSize >= MAX_FONT}
              style={{
                background: '#1a2430',
                border: '1px solid #223040',
                borderRadius: '8px',
                padding: '10px 14px',
                color: termFontSize >= MAX_FONT ? '#344050' : '#9bb0c3',
                fontSize: '13px',
                fontWeight: '700',
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                cursor: termFontSize >= MAX_FONT ? 'default' : 'pointer',
                touchAction: 'manipulation',
                transition: 'background 0.16s ease',
              }}
              title="Increase font size"
            >
              A+
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
