import { useState, useEffect, useRef, useCallback } from 'react';
import { fireAndForget } from '../lib/ipc';
import {
  sendPrompt,
  registerFocusFn,
  unregisterFocusFn,
  registerAction,
  unregisterAction,
  getAgentOutputTail,
  stripAnsi,
  onAgentReady,
  offAgentReady,
  normalizeForComparison,
  looksLikeQuestion,
  isTrustQuestionAutoHandled,
  isAutoTrustSettling,
  isAgentAskingQuestion,
  getTaskFocusedPanel,
  setTaskFocusedPanel,
} from '../store/store';
import { theme } from '../lib/theme';
import { sf } from '../lib/fontScale';

export interface PromptInputHandle {
  getText: () => string;
  setText: (value: string) => void;
}

interface PromptInputProps {
  taskId: string;
  agentId: string;
  initialPrompt?: string;
  prefillPrompt?: string;
  onPrefillConsumed?: () => void;
  onSend?: (text: string) => void;
  inputRef?: (el: HTMLTextAreaElement) => void;
  handle?: (h: PromptInputHandle) => void;
}

// Quiescence: how often to snapshot and how long output must be stable.
const QUIESCENCE_POLL_MS = 500;
const QUIESCENCE_THRESHOLD_MS = 1_500;
// Never auto-send before this (agent still booting).
const AUTOSEND_MIN_WAIT_MS = 500;
// After detecting the agent's prompt, wait this long and re-verify
// it's still visible before sending.
const PROMPT_RECHECK_DELAY_MS = 1_500;
// How many consecutive stability checks must pass before auto-sending.
const PROMPT_STABILITY_CHECKS = 2;
// Give up after this.
const AUTOSEND_MAX_WAIT_MS = 45_000;
// After sending, how long to poll terminal output to confirm the prompt appeared.
const PROMPT_VERIFY_TIMEOUT_MS = 5_000;
const PROMPT_VERIFY_POLL_MS = 250;

/** True when auto-send should be blocked by a question in the output.
 *  Trust-dialog questions are NOT blocking when auto-trust handles them. */
function isQuestionBlockingAutoSend(tail: string): boolean {
  if (!looksLikeQuestion(tail)) return false;
  if (isTrustQuestionAutoHandled(tail)) return false;
  return true;
}

export function PromptInput(props: PromptInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [autoSentInitialPrompt, setAutoSentInitialPrompt] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cleanupAutoSendRef = useRef<(() => void) | undefined>(undefined);
  const sendAbortControllerRef = useRef<AbortController | undefined>(undefined);

  // Keep mutable refs for values needed inside async callbacks / timers
  const textRef = useRef(text);
  textRef.current = text;
  const sendingRef = useRef(sending);
  sendingRef.current = sending;
  const propsRef = useRef(props);
  propsRef.current = props;
  const autoSentRef = useRef(autoSentInitialPrompt);
  autoSentRef.current = autoSentInitialPrompt;

  const questionActive = useCallback(() => isAgentAskingQuestion(props.agentId), [props.agentId]);

  // --- Helpers (stable references via useCallback + refs) ---

  function checkPromptInOutput(agentId: string, prompt: string, preSendTail: string): boolean {
    const snippet = stripAnsi(prompt).slice(0, 40);
    if (!snippet) return true;
    if (stripAnsi(preSendTail).includes(snippet)) return true;
    return stripAnsi(getAgentOutputTail(agentId)).includes(snippet);
  }

  async function promptAppearedInOutput(
    agentId: string,
    prompt: string,
    preSendTail: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    const snippet = stripAnsi(prompt).slice(0, 40);
    if (!snippet) return true;
    if (stripAnsi(preSendTail).includes(snippet)) return true;

    const deadline = Date.now() + PROMPT_VERIFY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal.aborted) return false;
      const tail = stripAnsi(getAgentOutputTail(agentId));
      if (tail.includes(snippet)) return true;
      await new Promise((r) => setTimeout(r, PROMPT_VERIFY_POLL_MS));
    }
    return false;
  }

  const handleSend = useCallback(async (mode: 'manual' | 'auto' = 'manual') => {
    if (sendingRef.current) return;
    const currentProps = propsRef.current;

    if (mode === 'auto') {
      if (isQuestionBlockingAutoSend(getAgentOutputTail(currentProps.agentId))) return;
      if (isAutoTrustSettling(currentProps.agentId)) return;
    } else {
      if (isAgentAskingQuestion(currentProps.agentId)) return;
    }
    cleanupAutoSendRef.current?.();
    cleanupAutoSendRef.current = undefined;

    const val = textRef.current.trim();
    if (!val) {
      if (mode === 'auto') return;
      fireAndForget('write_to_agent', { agentId: currentProps.agentId, data: '\r' });
      return;
    }

    sendAbortControllerRef.current?.abort();
    sendAbortControllerRef.current = new AbortController();
    const { signal } = sendAbortControllerRef.current;

    setSending(true);
    try {
      const preSendTail = getAgentOutputTail(currentProps.agentId);
      await sendPrompt(currentProps.taskId, currentProps.agentId, val);

      if (mode === 'auto') {
        let confirmed = await promptAppearedInOutput(currentProps.agentId, val, preSendTail, signal);
        if (!confirmed && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 1_000));
          confirmed = checkPromptInOutput(currentProps.agentId, val, preSendTail);
        }
        if (!confirmed && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 2_000));
          confirmed = checkPromptInOutput(currentProps.agentId, val, preSendTail);
        }
      }

      if (signal.aborted) return;

      if (currentProps.initialPrompt?.trim()) {
        setAutoSentInitialPrompt(currentProps.initialPrompt.trim());
      }
      currentProps.onSend?.(val);
      setText('');
    } catch (e) {
      console.error('Failed to send prompt:', e);
    } finally {
      setSending(false);
    }
  }, []);

  // --- Auto-send effect (tracks initialPrompt changes) ---
  useEffect(() => {
    cleanupAutoSendRef.current?.();
    cleanupAutoSendRef.current = undefined;

    const ip = props.initialPrompt?.trim();
    if (!ip) return;

    setText(ip);
    if (autoSentRef.current === ip) return;

    const agentId = props.agentId;
    const spawnedAt = Date.now();
    let quiescenceTimer: number | undefined;
    let pendingSendTimer: ReturnType<typeof setTimeout> | undefined;
    let lastRawTail = '';
    let lastNormalized = '';
    let stableSince = Date.now();
    let cancelled = false;

    function cleanup() {
      cancelled = true;
      offAgentReady(agentId);
      if (pendingSendTimer) {
        clearTimeout(pendingSendTimer);
        pendingSendTimer = undefined;
      }
      if (quiescenceTimer !== undefined) {
        clearInterval(quiescenceTimer);
        quiescenceTimer = undefined;
      }
    }
    cleanupAutoSendRef.current = cleanup;

    function trySend() {
      if (cancelled) return;
      if (isAutoTrustSettling(agentId)) return;
      cleanup();
      void handleSend('auto');
    }

    function onReady() {
      if (cancelled) return;
      if (isQuestionBlockingAutoSend(getAgentOutputTail(agentId))) {
        onAgentReady(agentId, onReady);
        return;
      }

      if (!pendingSendTimer) {
        startStabilityChecks();
      }
    }

    function startStabilityChecks() {
      let checksRemaining = PROMPT_STABILITY_CHECKS;
      const elapsed = Date.now() - spawnedAt;
      const firstDelay = Math.max(PROMPT_RECHECK_DELAY_MS, AUTOSEND_MIN_WAIT_MS - elapsed);

      function scheduleCheck(delay: number) {
        const snapshot = normalizeForComparison(getAgentOutputTail(agentId));
        pendingSendTimer = setTimeout(() => {
          pendingSendTimer = undefined;
          if (cancelled) return;
          const tail = getAgentOutputTail(agentId);
          if (isQuestionBlockingAutoSend(tail)) {
            onAgentReady(agentId, onReady);
            return;
          }
          const normalized = normalizeForComparison(tail);
          if (!/[❯›]/.test(stripAnsi(tail).slice(-200)) || normalized !== snapshot) {
            onAgentReady(agentId, onReady);
            return;
          }
          checksRemaining--;
          if (checksRemaining <= 0) {
            trySend();
          } else {
            scheduleCheck(PROMPT_RECHECK_DELAY_MS);
          }
        }, delay);
      }

      scheduleCheck(firstDelay);
    }

    onAgentReady(agentId, onReady);

    // --- SLOW PATH: quiescence fallback ---
    quiescenceTimer = window.setInterval(() => {
      if (cancelled) return;
      const elapsed = Date.now() - spawnedAt;

      if (elapsed > AUTOSEND_MAX_WAIT_MS) {
        cleanup();
        return;
      }
      if (elapsed < AUTOSEND_MIN_WAIT_MS) return;
      if (isAutoTrustSettling(agentId)) return;

      const tail = getAgentOutputTail(agentId);
      if (!tail) return;

      if (/[❯›]/.test(stripAnsi(tail).slice(-200))) {
        if (!pendingSendTimer) startStabilityChecks();
        return;
      }

      if (tail === lastRawTail) {
        if (stableSince > 0 && Date.now() - stableSince >= QUIESCENCE_THRESHOLD_MS) {
          if (!isQuestionBlockingAutoSend(tail)) {
            trySend();
          } else {
            stableSince = Date.now();
          }
        }
        return;
      }
      lastRawTail = tail;

      const normalized = normalizeForComparison(tail);

      if (normalized !== lastNormalized) {
        lastNormalized = normalized;
        stableSince = Date.now();
        return;
      }

      if (Date.now() - stableSince < QUIESCENCE_THRESHOLD_MS) return;

      if (isQuestionBlockingAutoSend(tail)) {
        stableSince = Date.now();
        return;
      }

      trySend();
    }, QUIESCENCE_POLL_MS);

    return cleanup;
  }, [props.initialPrompt, props.agentId, handleSend]);

  // --- Prefill effect ---
  useEffect(() => {
    const pf = props.prefillPrompt?.trim();
    if (!pf) return;
    setText(pf);
    props.onPrefillConsumed?.();
  }, [props.prefillPrompt, props.onPrefillConsumed]);

  // --- Focus terminal when agent asks a question ---
  useEffect(() => {
    if (isAgentAskingQuestion(props.agentId) && getTaskFocusedPanel(props.taskId) === 'prompt') {
      setTaskFocusedPanel(props.taskId, 'ai-terminal');
    }
  }, [props.agentId, props.taskId]);

  // --- Register focus/action handlers ---
  useEffect(() => {
    props.handle?.({ getText: () => textRef.current, setText });
    const focusKey = `${props.taskId}:prompt`;
    const actionKey = `${props.taskId}:send-prompt`;
    registerFocusFn(focusKey, () => textareaRef.current?.focus());
    registerAction(actionKey, () => handleSend());
    return () => {
      unregisterFocusFn(focusKey);
      unregisterAction(actionKey);
    };
  }, [props.taskId, props.handle, handleSend]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      cleanupAutoSendRef.current?.();
      cleanupAutoSendRef.current = undefined;
      sendAbortControllerRef.current?.abort();
    };
  }, []);

  const isQuestionActive = questionActive();

  return (
    <div
      className="focusable-panel prompt-input-panel"
      style={{ display: 'flex', height: '100%', padding: '4px 6px', borderRadius: '12px' }}
    >
      <div style={{ position: 'relative', flex: '1', display: 'flex' }}>
        <textarea
          className="prompt-textarea"
          ref={(el) => {
            textareaRef.current = el;
            if (el) props.inputRef?.(el);
          }}
          rows={3}
          value={text}
          disabled={isQuestionActive}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            isQuestionActive
              ? 'Agent is waiting for input in terminal…'
              : 'Send a prompt... (Enter to send, Shift+Enter for newline)'
          }
          style={{
            flex: '1',
            background: theme.bgInput,
            border: `1px solid ${theme.border}`,
            borderRadius: '12px',
            padding: '6px 36px 6px 10px',
            color: theme.fg,
            fontSize: sf(12),
            fontFamily: "'JetBrains Mono', monospace",
            resize: 'none',
            outline: 'none',
            opacity: isQuestionActive ? '0.5' : '1',
          }}
        />
        <button
          className="prompt-send-btn"
          type="button"
          disabled={!text.trim() || isQuestionActive}
          onClick={() => handleSend()}
          style={{
            position: 'absolute',
            right: '6px',
            bottom: '6px',
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            border: 'none',
            background: text.trim() ? theme.accent : theme.bgHover,
            color: text.trim() ? theme.accentText : theme.fgSubtle,
            cursor: text.trim() ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0',
            transition: 'background 0.15s, color 0.15s',
          }}
          title="Send prompt"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
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
    </div>
  );
}
