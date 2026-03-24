import { invoke } from '../lib/ipc';
import { getStore, setStore } from './store';
import type { WorktreeStatus } from '../ipc/types';

// --- Trust-specific patterns ---
const TRUST_PATTERNS: RegExp[] = [
  /\btrust\b.*\?/i,
  /\ballow\b.*\?/i,
  /trust.*folder/i,
];

const TRUST_EXCLUSION_KEYWORDS =
  /\b(delet|remov|credential|secret|password|key|token|destro|format|drop)/i;

const autoTrustTimers = new Map<string, ReturnType<typeof setTimeout>>();
const autoTrustCooldowns = new Map<string, ReturnType<typeof setTimeout>>();

function isAutoTrustPending(agentId: string): boolean {
  return autoTrustTimers.has(agentId) || autoTrustCooldowns.has(agentId);
}

const AUTO_TRUST_BG_THROTTLE_MS = 500;
const lastAutoTrustCheckAt = new Map<string, number>();

const autoTrustAcceptedAt = new Map<string, number>();
const POST_AUTO_TRUST_SETTLE_MS = 1_000;

export function isAutoTrustSettling(agentId: string): boolean {
  if (isAutoTrustPending(agentId)) return true;
  const acceptedAt = autoTrustAcceptedAt.get(agentId);
  if (!acceptedAt) return false;
  if (Date.now() - acceptedAt >= POST_AUTO_TRUST_SETTLE_MS) {
    autoTrustAcceptedAt.delete(agentId);
    return false;
  }
  return true;
}

function clearAutoTrustState(agentId: string): void {
  lastAutoTrustCheckAt.delete(agentId);
  autoTrustAcceptedAt.delete(agentId);
  const timer = autoTrustTimers.get(agentId);
  if (timer) { clearTimeout(timer); autoTrustTimers.delete(agentId); }
  const cooldown = autoTrustCooldowns.get(agentId);
  if (cooldown) { clearTimeout(cooldown); autoTrustCooldowns.delete(agentId); }
}

export type TaskDotStatus = 'busy' | 'waiting' | 'ready';

// --- Prompt detection ---

export function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nq-uy=><~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g,
    '',
  );
}

const PROMPT_PATTERNS: RegExp[] = [
  /❯\s*$/,
  /(?:^|\s)\$\s*$/,
  /(?:^|\s)%\s*$/,
  /(?:^|\s)#\s*$/,
  /\[Y\/n\]\s*$/i,
  /\[y\/N\]\s*$/i,
];

function looksLikePrompt(line: string): boolean {
  const stripped = stripAnsi(line).trimEnd();
  if (stripped.length === 0) return false;
  return PROMPT_PATTERNS.some((re) => re.test(stripped));
}

const AGENT_READY_TAIL_PATTERNS: RegExp[] = [/❯/, /›/];

function chunkContainsAgentPrompt(stripped: string): boolean {
  if (stripped.length === 0) return false;
  const tail = stripped.slice(-50);
  return AGENT_READY_TAIL_PATTERNS.some((re) => re.test(tail));
}

// --- Agent ready callbacks ---
const agentReadyCallbacks = new Map<string, () => void>();

export function onAgentReady(agentId: string, callback: () => void): void {
  agentReadyCallbacks.set(agentId, callback);
}

export function offAgentReady(agentId: string): void {
  agentReadyCallbacks.delete(agentId);
}

function tryFireAgentReadyCallback(agentId: string): void {
  if (!agentReadyCallbacks.has(agentId)) return;
  const rawTail = outputTailBuffers.get(agentId) ?? '';
  const tailStripped = stripAnsi(rawTail)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (chunkContainsAgentPrompt(tailStripped)) {
    const cb = agentReadyCallbacks.get(agentId);
    agentReadyCallbacks.delete(agentId);
    if (cb) cb();
  }
}

export function normalizeForComparison(text: string): string {
  return stripAnsi(text)
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUESTION_PATTERNS: RegExp[] = [
  /\[Y\/n\]\s*$/i, /\[y\/N\]\s*$/i, /\(y(?:es)?\/n(?:o)?\)\s*$/i,
  /\btrust\b.*\?/i, /\bupdate\b.*\?/i, /\bproceed\b.*\?/i,
  /\boverwrite\b.*\?/i, /\bcontinue\b.*\?/i, /\ballow\b.*\?/i,
  /Do you want to/i, /Would you like to/i, /Are you sure/i,
  /trust.*folder/i,
];

export function looksLikeQuestion(tail: string): boolean {
  const visible = stripAnsi(tail);
  const chunk = visible.slice(-500);
  const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return false;
  const lastLine = lines[lines.length - 1].trimEnd();
  if (/^\s*[❯›]\s*$/.test(lastLine)) return false;
  return lines.some((line) => {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) return false;
    return QUESTION_PATTERNS.some((re) => re.test(trimmed));
  });
}

export function isTrustQuestionAutoHandled(tail: string): boolean {
  if (!getStore().autoTrustFolders) return false;
  if (!looksLikeTrustDialog(tail)) return false;
  const visible = stripAnsi(tail).slice(-500);
  if (TRUST_EXCLUSION_KEYWORDS.test(visible)) return false;
  const lines = visible.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return !lines.some((line) => {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) return false;
    if (TRUST_PATTERNS.some((re) => re.test(trimmed))) return false;
    return QUESTION_PATTERNS.some((re) => re.test(trimmed));
  });
}

function looksLikeTrustDialog(tail: string): boolean {
  const visible = stripAnsi(tail);
  const chunk = visible.slice(-500);
  const lines = chunk.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.some((line) => {
    const trimmed = line.trimEnd();
    return TRUST_PATTERNS.some((re) => re.test(trimmed));
  });
}

// --- Agent question tracking (plain Set, no signals) ---
let questionAgentsSet = new Set<string>();

export function isAgentAskingQuestion(agentId: string): boolean {
  return questionAgentsSet.has(agentId);
}

function updateQuestionState(agentId: string, hasQuestion: boolean): void {
  if (hasQuestion === questionAgentsSet.has(agentId)) return;
  const next = new Set(questionAgentsSet);
  if (hasQuestion) next.add(agentId); else next.delete(agentId);
  questionAgentsSet = next;
}

// --- Agent activity tracking ---
const lastDataAt = new Map<string, number>();
const lastIdleResetAt = new Map<string, number>();
let activeAgentsSet = new Set<string>();
const IDLE_TIMEOUT_MS = 15_000;
const THROTTLE_MS = 1_000;
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

const TAIL_BUFFER_MAX = 4096;
const outputTailBuffers = new Map<string, string>();
const agentDecoders = new Map<string, TextDecoder>();

const lastAnalysisAt = new Map<string, number>();
const pendingAnalysis = new Map<string, ReturnType<typeof setTimeout>>();
const ANALYSIS_INTERVAL_MS = 200;

function addToActive(agentId: string): void {
  if (activeAgentsSet.has(agentId)) return;
  const next = new Set(activeAgentsSet);
  next.add(agentId);
  activeAgentsSet = next;
}

function removeFromActive(agentId: string): void {
  if (!activeAgentsSet.has(agentId)) return;
  const next = new Set(activeAgentsSet);
  next.delete(agentId);
  activeAgentsSet = next;
}

function resetIdleTimer(agentId: string): void {
  lastIdleResetAt.set(agentId, Date.now());
  const existing = idleTimers.get(agentId);
  if (existing) clearTimeout(existing);
  idleTimers.set(agentId, setTimeout(() => {
    removeFromActive(agentId);
    idleTimers.delete(agentId);
  }, IDLE_TIMEOUT_MS));
}

export function markAgentSpawned(agentId: string): void {
  outputTailBuffers.delete(agentId);
  clearAutoTrustState(agentId);
  lastAnalysisAt.delete(agentId);
  const pending = pendingAnalysis.get(agentId);
  if (pending) { clearTimeout(pending); pendingAnalysis.delete(agentId); }
  lastDataAt.set(agentId, Date.now());
  addToActive(agentId);
  resetIdleTimer(agentId);
}

function tryAutoTrust(agentId: string, rawTail: string): boolean {
  if (!getStore().autoTrustFolders || isAutoTrustPending(agentId)) return false;
  if (!looksLikeTrustDialog(rawTail)) return false;
  const visibleTail = stripAnsi(rawTail).slice(-500);
  if (TRUST_EXCLUSION_KEYWORDS.test(visibleTail)) return false;

  const timer = setTimeout(() => {
    autoTrustTimers.delete(agentId);
    outputTailBuffers.set(agentId, '');
    agentReadyCallbacks.delete(agentId);
    autoTrustAcceptedAt.set(agentId, Date.now());
    invoke('write_to_agent', { agentId, data: '\r' }).catch(() => {});
    const cd = setTimeout(() => autoTrustCooldowns.delete(agentId), 3_000);
    autoTrustCooldowns.set(agentId, cd);
  }, 50);
  autoTrustTimers.set(agentId, timer);
  return true;
}

function analyzeAgentOutput(agentId: string): void {
  const rawTail = outputTailBuffers.get(agentId) ?? '';
  let hasQuestion = looksLikeQuestion(rawTail);

  if (hasQuestion && getStore().autoTrustFolders) {
    const visibleTail = stripAnsi(rawTail).slice(-500);
    if (looksLikeTrustDialog(rawTail) && !TRUST_EXCLUSION_KEYWORDS.test(visibleTail)) {
      tryAutoTrust(agentId, rawTail);
      hasQuestion = false;
    }
  }

  updateQuestionState(agentId, hasQuestion);

  if (!hasQuestion && !autoTrustTimers.has(agentId)) tryFireAgentReadyCallback(agentId);
}

export function markAgentOutput(agentId: string, data: Uint8Array, taskId?: string): void {
  const now = Date.now();
  lastDataAt.set(agentId, now);

  let decoder = agentDecoders.get(agentId);
  if (!decoder) { decoder = new TextDecoder(); agentDecoders.set(agentId, decoder); }
  const text = decoder.decode(data, { stream: true });
  const prev = outputTailBuffers.get(agentId) ?? '';
  const combined = prev + text;
  outputTailBuffers.set(agentId,
    combined.length > TAIL_BUFFER_MAX
      ? combined.slice(combined.length - TAIL_BUFFER_MAX)
      : combined);

  const isActiveTask = !taskId || taskId === getStore().activeTaskId;

  if (getStore().autoTrustFolders && !isAutoTrustPending(agentId) && !isActiveTask) {
    const lastCheck = lastAutoTrustCheckAt.get(agentId) ?? 0;
    if (now - lastCheck >= AUTO_TRUST_BG_THROTTLE_MS) {
      lastAutoTrustCheckAt.set(agentId, now);
      tryAutoTrust(agentId, outputTailBuffers.get(agentId) ?? '');
    }
  }

  if (isActiveTask) {
    const lastAnalysis = lastAnalysisAt.get(agentId) ?? 0;
    if (now - lastAnalysis >= ANALYSIS_INTERVAL_MS) {
      lastAnalysisAt.set(agentId, now);
      if (pendingAnalysis.has(agentId)) {
        clearTimeout(pendingAnalysis.get(agentId));
        pendingAnalysis.delete(agentId);
      }
      analyzeAgentOutput(agentId);
    } else if (!pendingAnalysis.has(agentId)) {
      pendingAnalysis.set(agentId, setTimeout(() => {
        pendingAnalysis.delete(agentId);
        lastAnalysisAt.set(agentId, Date.now());
        analyzeAgentOutput(agentId);
      }, ANALYSIS_INTERVAL_MS));
    }
  }

  const tail = combined.slice(-200);
  let lastLine = '';
  let searchEnd = tail.length;
  while (searchEnd > 0) {
    const nlIdx = tail.lastIndexOf('\n', searchEnd - 1);
    const candidate = tail.slice(nlIdx + 1, searchEnd).trim();
    if (candidate.length > 0) { lastLine = candidate; break; }
    searchEnd = nlIdx >= 0 ? nlIdx : 0;
  }

  if (looksLikePrompt(lastLine)) {
    const pendingTimer = pendingAnalysis.get(agentId);
    if (pendingTimer) { clearTimeout(pendingTimer); pendingAnalysis.delete(agentId); }
    if (!looksLikeQuestion(outputTailBuffers.get(agentId) ?? '')) {
      updateQuestionState(agentId, false);
    }
    tryFireAgentReadyCallback(agentId);
    const timer = idleTimers.get(agentId);
    if (timer) { clearTimeout(timer); idleTimers.delete(agentId); }
    removeFromActive(agentId);
    return;
  }

  if (activeAgentsSet.has(agentId)) {
    const lastReset = lastIdleResetAt.get(agentId) ?? 0;
    if (now - lastReset < THROTTLE_MS) return;
    resetIdleTimer(agentId);
    return;
  }

  addToActive(agentId);
  resetIdleTimer(agentId);
}

export function getAgentOutputTail(agentId: string): string {
  return outputTailBuffers.get(agentId) ?? '';
}

export function isAgentIdle(agentId: string): boolean {
  return !activeAgentsSet.has(agentId);
}

export function markAgentBusy(agentId: string): void {
  addToActive(agentId);
  resetIdleTimer(agentId);
}

export function clearAgentActivity(agentId: string): void {
  lastDataAt.delete(agentId);
  lastIdleResetAt.delete(agentId);
  outputTailBuffers.delete(agentId);
  agentDecoders.delete(agentId);
  agentReadyCallbacks.delete(agentId);
  clearAutoTrustState(agentId);
  lastAnalysisAt.delete(agentId);
  const pending = pendingAnalysis.get(agentId);
  if (pending) { clearTimeout(pending); pendingAnalysis.delete(agentId); }
  const timer = idleTimers.get(agentId);
  if (timer) { clearTimeout(timer); idleTimers.delete(agentId); }
  removeFromActive(agentId);
  updateQuestionState(agentId, false);
}

// --- Derived status ---

export function getTaskDotStatus(taskId: string): TaskDotStatus {
  const s = getStore();
  const task = s.tasks[taskId];
  if (!task) return 'waiting';
  const hasActive = task.agentIds.some((id) => {
    const a = s.agents[id];
    return a?.status === 'running' && activeAgentsSet.has(id);
  });
  if (hasActive) return 'busy';

  const git = s.taskGitStatus[taskId];
  if (git?.has_committed_changes && !git?.has_uncommitted_changes) return 'ready';
  return 'waiting';
}

// --- Git status polling ---

async function refreshTaskGitStatus(taskId: string): Promise<void> {
  const task = getStore().tasks[taskId];
  if (!task) return;

  try {
    const projectRoot = getStore().projects.find((p) => p.id === task.projectId)?.path;
    const status = await invoke<WorktreeStatus>('get_worktree_status', {
      worktreePath: task.worktreePath,
      projectRoot: projectRoot ?? task.worktreePath,
    });
    setStore((s) => { s.taskGitStatus[taskId] = status; });
  } catch {
    // Worktree may not exist yet — ignore
  }
}

let isRefreshingAll = false;

export async function refreshAllTaskGitStatus(): Promise<void> {
  if (isRefreshingAll) return;
  isRefreshingAll = true;
  try {
    const s = getStore();
    const taskIds = s.taskOrder;
    const currentTaskId = s.activeTaskId;
    const toRefresh = taskIds.filter((taskId) => {
      if (taskId === currentTaskId) return false;
      const task = s.tasks[taskId];
      if (!task) return false;
      return !task.agentIds.some((id) => {
        const a = s.agents[id];
        return a?.status === 'running' && activeAgentsSet.has(id);
      });
    });

    const BATCH_SIZE = 4;
    for (let i = 0; i < toRefresh.length; i += BATCH_SIZE) {
      const batch = toRefresh.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map((taskId) => refreshTaskGitStatus(taskId)));
    }
  } finally {
    isRefreshingAll = false;
  }
}

async function refreshActiveTaskGitStatus(): Promise<void> {
  const taskId = getStore().activeTaskId;
  if (!taskId) return;
  await refreshTaskGitStatus(taskId);
}

export function refreshTaskStatus(taskId: string): void {
  void refreshTaskGitStatus(taskId);
}

let allTasksTimer: ReturnType<typeof setInterval> | null = null;
let activeTaskTimer: ReturnType<typeof setInterval> | null = null;
let lastPollingTaskCount = 0;

function computeAllTasksInterval(): number {
  const taskCount = getStore().taskOrder.length;
  return Math.min(120_000, 30_000 + Math.max(0, taskCount - 3) * 5_000);
}

export function startTaskStatusPolling(): void {
  if (allTasksTimer || activeTaskTimer) return;
  activeTaskTimer = setInterval(() => void refreshActiveTaskGitStatus(), 5_000);
  lastPollingTaskCount = getStore().taskOrder.length;
  allTasksTimer = setInterval(() => void refreshAllTaskGitStatus(), computeAllTasksInterval());
  void refreshActiveTaskGitStatus();
  void refreshAllTaskGitStatus();
}

export function rescheduleTaskStatusPolling(): void {
  if (!allTasksTimer) return;
  const currentCount = getStore().taskOrder.length;
  if (currentCount === lastPollingTaskCount) return;
  lastPollingTaskCount = currentCount;
  clearInterval(allTasksTimer);
  allTasksTimer = setInterval(() => void refreshAllTaskGitStatus(), computeAllTasksInterval());
}

export function stopTaskStatusPolling(): void {
  if (allTasksTimer) { clearInterval(allTasksTimer); allTasksTimer = null; }
  if (activeTaskTimer) { clearInterval(activeTaskTimer); activeTaskTimer = null; }
  lastPollingTaskCount = 0;
}
