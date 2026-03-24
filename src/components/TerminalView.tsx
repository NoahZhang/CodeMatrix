import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke, fireAndForget, Channel } from '../lib/ipc';
import { getTerminalFontFamily } from '../lib/fonts';
import { getTerminalTheme } from '../lib/theme';
import { matchesGlobalShortcut } from '../lib/shortcuts';
import { isMac } from '../lib/platform';
import { useStore } from '../store/store';
import { registerTerminal, unregisterTerminal, markDirty } from '../lib/terminalFitManager';
import type { PtyOutput } from '../ipc/types';

// Pre-computed base64 lookup table — avoids atob() intermediate string allocation.
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < 64; i++) {
  B64_LOOKUP['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.charCodeAt(i)] = i;
}

function base64ToUint8Array(b64: string): Uint8Array {
  let end = b64.length;
  while (end > 0 && b64.charCodeAt(end - 1) === 61 /* '=' */) end--;
  const out = new Uint8Array((end * 3) >>> 2);
  let j = 0;
  for (let i = 0; i < end; ) {
    const a = B64_LOOKUP[b64.charCodeAt(i++)];
    const b = i < end ? B64_LOOKUP[b64.charCodeAt(i++)] : 0;
    const c = i < end ? B64_LOOKUP[b64.charCodeAt(i++)] : 0;
    const d = i < end ? B64_LOOKUP[b64.charCodeAt(i++)] : 0;
    const triplet = (a << 18) | (b << 12) | (c << 6) | d;
    out[j++] = (triplet >>> 16) & 0xff;
    if (j < out.length) out[j++] = (triplet >>> 8) & 0xff;
    if (j < out.length) out[j++] = triplet & 0xff;
  }
  return out;
}

export interface TerminalViewProps {
  taskId: string;
  agentId: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  isShell?: boolean;
  onExit?: (exitInfo: {
    exit_code: number | null;
    signal: string | null;
    last_output: string[];
  }) => void;
  onData?: (data: Uint8Array) => void;
  onPromptDetected?: (text: string) => void;
  onReady?: (focusFn: () => void) => void;
  onBufferReady?: (getBuffer: () => string) => void;
  fontSize?: number;
  autoFocus?: boolean;
  initialCommand?: string;
  isFocused?: boolean;
}

// Status parsing only needs recent output. Capping forwarded bytes avoids
// expensive full-chunk decoding during large terminal bursts.
const STATUS_ANALYSIS_MAX_BYTES = 8 * 1024;

export function TerminalView({
  taskId,
  agentId,
  command,
  args,
  cwd,
  env,
  isShell,
  onExit,
  onData,
  onPromptDetected,
  onReady,
  onBufferReady,
  fontSize = 13,
  autoFocus,
  initialCommand,
  isFocused,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Use refs for callbacks so the effect closure always calls latest versions
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onPromptDetectedRef = useRef(onPromptDetected);
  onPromptDetectedRef.current = onPromptDetected;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onBufferReadyRef = useRef(onBufferReady);
  onBufferReadyRef.current = onBufferReady;

  // Store terminal instance in ref for effects that need it
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // Subscribe to store values needed for theme/font updates
  const terminalFont = useStore((s) => s.terminalFont);
  const themePreset = useStore((s) => s.themePreset);

  // Main initialization effect — runs once per agentId
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize,
      fontFamily: getTerminalFontFamily(useStore.getState().terminalFont),
      theme: getTerminalTheme(useStore.getState().themePreset),
      allowProposedApi: true,
      scrollback: 3000,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        try {
          const parsed = new URL(uri);
          if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            window.open(uri, '_blank');
          }
        } catch {
          // Invalid URL, ignore
        }
      }),
    );

    term.open(container);
    onReadyRef.current?.(() => term.focus());
    onBufferReadyRef.current?.(() => {
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i <= buf.length - 1; i++) {
        const line = buf.getLine(i);
        if (line) lines.push(line.translateToString(true));
      }
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      return lines.join('\n');
    });

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true;
      if (matchesGlobalShortcut(e)) return false;

      const isCopy = isMac
        ? e.metaKey && !e.shiftKey && e.key === 'c'
        : e.ctrlKey && e.shiftKey && e.key === 'C';
      const isPaste = isMac
        ? e.metaKey && !e.shiftKey && e.key === 'v'
        : e.ctrlKey && e.shiftKey && e.key === 'V';

      if (isCopy) {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel);
        return false;
      }

      if (isPaste) {
        navigator.clipboard.readText().then((text) => {
          if (text) enqueueInput(text);
        });
        return false;
      }

      return true;
    });

    fitAddon.fit();
    registerTerminal(agentId, container, fitAddon, term);

    if (autoFocus) {
      term.focus();
    }

    // --- Output flow control ---
    let outputRaf: number | undefined;
    let outputQueue: Uint8Array[] = [];
    let outputQueuedBytes = 0;
    let outputWriteInFlight = false;
    let watermark = 0;
    let ptyPaused = false;
    const FLOW_HIGH = 256 * 1024;
    const FLOW_LOW = 32 * 1024;
    let pendingExitPayload: {
      exit_code: number | null;
      signal: string | null;
      last_output: string[];
    } | null = null;

    function emitExit(payload: {
      exit_code: number | null;
      signal: string | null;
      last_output: string[];
    }) {
      term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n');
      onExitRef.current?.(payload);
    }

    function flushOutputQueue() {
      if (outputWriteInFlight || outputQueue.length === 0) return;

      const chunks = outputQueue;
      const totalBytes = outputQueuedBytes;
      outputQueue = [];
      outputQueuedBytes = 0;

      let payload: Uint8Array;
      if (chunks.length === 1) {
        payload = chunks[0];
      } else {
        payload = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          payload.set(chunk, offset);
          offset += chunk.length;
        }
      }

      const statusPayload =
        payload.length > STATUS_ANALYSIS_MAX_BYTES
          ? payload.subarray(payload.length - STATUS_ANALYSIS_MAX_BYTES)
          : payload;

      outputWriteInFlight = true;
      term.write(payload, () => {
        outputWriteInFlight = false;
        watermark = Math.max(watermark - payload.length, 0);

        if (watermark < FLOW_LOW && ptyPaused) {
          ptyPaused = false;
          invoke('resume_agent', { agentId }).catch(() => {
            ptyPaused = false;
          });
        }

        onDataRef.current?.(statusPayload);
        if (outputQueue.length > 0) {
          scheduleOutputFlush();
          return;
        }
        if (pendingExitPayload) {
          const exit = pendingExitPayload;
          pendingExitPayload = null;
          emitExit(exit);
        }
      });
    }

    function scheduleOutputFlush() {
      if (outputRaf !== undefined) return;
      outputRaf = requestAnimationFrame(() => {
        outputRaf = undefined;
        flushOutputQueue();
      });
    }

    function enqueueOutput(chunk: Uint8Array) {
      outputQueue.push(chunk);
      outputQueuedBytes += chunk.length;
      watermark += chunk.length;

      if (watermark > FLOW_HIGH && !ptyPaused) {
        ptyPaused = true;
        invoke('pause_agent', { agentId }).catch(() => {
          ptyPaused = false;
        });
      }

      if (outputQueuedBytes >= 64 * 1024) {
        flushOutputQueue();
      } else {
        scheduleOutputFlush();
      }
    }

    // --- Channel for PTY output ---
    const onOutput = new Channel<PtyOutput>();
    let initialCommandSent = false;
    onOutput.onmessage = (msg) => {
      if (msg.type === 'Data') {
        enqueueOutput(base64ToUint8Array(msg.data));
        if (!initialCommandSent && initialCommand) {
          initialCommandSent = true;
          setTimeout(() => enqueueInput(initialCommand + '\r'), 50);
        }
      } else if (msg.type === 'Exit') {
        pendingExitPayload = msg.data;
        flushOutputQueue();
        if (!outputWriteInFlight && outputQueue.length === 0 && pendingExitPayload) {
          const exit = pendingExitPayload;
          pendingExitPayload = null;
          emitExit(exit);
        }
      }
    };

    // --- Input batching ---
    let inputBuffer = '';
    let pendingInput = '';
    let inputFlushTimer: number | undefined;

    function flushPendingInput() {
      if (!pendingInput) return;
      const data = pendingInput;
      pendingInput = '';
      if (inputFlushTimer !== undefined) {
        clearTimeout(inputFlushTimer);
        inputFlushTimer = undefined;
      }
      fireAndForget('write_to_agent', { agentId, data });
    }

    function enqueueInput(data: string) {
      pendingInput += data;
      if (pendingInput.length >= 2048) {
        flushPendingInput();
        return;
      }
      if (inputFlushTimer !== undefined) return;
      inputFlushTimer = window.setTimeout(() => {
        inputFlushTimer = undefined;
        flushPendingInput();
      }, 8);
    }

    term.onData((data) => {
      if (onPromptDetectedRef.current) {
        for (const ch of data) {
          if (ch === '\r') {
            const trimmed = inputBuffer.trim();
            if (trimmed) onPromptDetectedRef.current?.(trimmed);
            inputBuffer = '';
          } else if (ch === '\x7f') {
            inputBuffer = inputBuffer.slice(0, -1);
          } else if (ch === '\x03' || ch === '\x15') {
            inputBuffer = '';
          } else if (ch === '\x1b') {
            break;
          } else if (ch >= ' ') {
            inputBuffer += ch;
          }
        }
      }
      enqueueInput(data);
    });

    // --- Resize debouncing ---
    let resizeFlushTimer: number | undefined;
    let pendingResize: { cols: number; rows: number } | null = null;
    let lastSentCols = -1;
    let lastSentRows = -1;

    function flushPendingResize() {
      if (!pendingResize) return;
      const { cols, rows } = pendingResize;
      pendingResize = null;
      if (cols === lastSentCols && rows === lastSentRows) return;
      lastSentCols = cols;
      lastSentRows = rows;
      fireAndForget('resize_agent', { agentId, cols, rows });
    }

    term.onResize(({ cols, rows }) => {
      pendingResize = { cols, rows };
      if (resizeFlushTimer !== undefined) return;
      resizeFlushTimer = window.setTimeout(() => {
        resizeFlushTimer = undefined;
        flushPendingResize();
      }, 33);
    });

    // --- WebGL addon ---
    let webglAddon: WebglAddon | undefined;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose();
        webglAddon = undefined;
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL2 not supported — DOM renderer used automatically
    }

    // --- Spawn the PTY process ---
    onOutput.init().then(() => {
      invoke('spawn_agent', {
        args: {
          taskId,
          agentId,
          command,
          args,
          cwd,
          env: env ?? {},
          cols: term.cols,
          rows: term.rows,
          isShell: isShell,
          onOutput,
        },
      }).catch((err) => {
        // eslint-disable-next-line no-control-regex
        const safeErr = String(err).replace(/[\x00-\x1f\x7f]/g, '');
        term.write(`\x1b[31mFailed to spawn: ${safeErr}\x1b[0m\r\n`);
        onExitRef.current?.({
          exit_code: null,
          signal: 'spawn_failed',
          last_output: [`Failed to spawn: ${safeErr}`],
        });
      });
    });

    // --- Cleanup ---
    return () => {
      flushPendingInput();
      flushPendingResize();
      if (inputFlushTimer !== undefined) clearTimeout(inputFlushTimer);
      if (resizeFlushTimer !== undefined) clearTimeout(resizeFlushTimer);
      if (outputRaf !== undefined) cancelAnimationFrame(outputRaf);
      onOutput.dispose();
      webglAddon?.dispose();
      unregisterTerminal(agentId);
      fireAndForget('kill_agent', { agentId });
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update cursor blink based on focus state
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.cursorBlink = isFocused === true;
  }, [isFocused]);

  // Update font size
  useEffect(() => {
    const term = termRef.current;
    if (!term || fontSize === undefined) return;
    term.options.fontSize = fontSize;
    markDirty(agentId);
  }, [fontSize, agentId]);

  // Update terminal font family
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = getTerminalFontFamily(terminalFont);
    markDirty(agentId);
  }, [terminalFont, agentId]);

  // Update terminal theme
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.theme = getTerminalTheme(themePreset);
    markDirty(agentId);
  }, [themePreset, agentId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        padding: '4px 0 0 4px',
        contain: 'strict',
      }}
    />
  );
}
