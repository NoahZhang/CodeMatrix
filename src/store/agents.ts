import { invoke } from '../lib/ipc';
import { getStore, setStore } from './store';
import type { AgentDef } from '../ipc/types';
import type { Agent } from './types';
import { refreshTaskStatus, clearAgentActivity, markAgentSpawned } from './taskStatus';

export async function loadAgents(): Promise<void> {
  const defaults = await invoke<AgentDef[]>('list_agents_cmd');
  const custom = getStore().customAgents;
  const customIds = new Set(custom.map((a) => a.id));
  setStore((s) => {
    s.availableAgents = [...defaults.filter((d) => !customIds.has(d.id)), ...custom];
  });
}

export async function addAgentToTask(taskId: string, agentDef: AgentDef): Promise<void> {
  const task = getStore().tasks[taskId];
  if (!task) return;

  const agentId = crypto.randomUUID();
  const agent: Agent = {
    id: agentId,
    taskId,
    def: agentDef,
    resumed: false,
    status: 'running',
    exitCode: null,
    signal: null,
    lastOutput: [],
    generation: 0,
  };

  setStore((s) => {
    s.agents[agentId] = agent;
    s.tasks[taskId].agentIds.push(agentId);
    s.activeAgentId = agentId;
  });

  markAgentSpawned(agentId);
}

export function markAgentExited(
  agentId: string,
  exitInfo: { exit_code: number | null; signal: string | null; last_output: string[] },
): void {
  const agent = getStore().agents[agentId];
  setStore((s) => {
    if (s.agents[agentId]) {
      s.agents[agentId].status = 'exited';
      s.agents[agentId].exitCode = exitInfo.exit_code;
      s.agents[agentId].signal = exitInfo.signal;
      s.agents[agentId].lastOutput = exitInfo.last_output;
    }
  });
  if (agent) {
    clearAgentActivity(agentId);
    refreshTaskStatus(agent.taskId);
  }
}

export function restartAgent(agentId: string, useResumeArgs: boolean): void {
  setStore((s) => {
    if (s.agents[agentId]) {
      s.agents[agentId].status = 'running';
      s.agents[agentId].exitCode = null;
      s.agents[agentId].signal = null;
      s.agents[agentId].lastOutput = [];
      s.agents[agentId].resumed = useResumeArgs;
      s.agents[agentId].generation += 1;
    }
  });
  markAgentSpawned(agentId);
}

export function switchAgent(agentId: string, newDef: AgentDef): void {
  setStore((s) => {
    if (s.agents[agentId]) {
      s.agents[agentId].def = newDef;
      s.agents[agentId].status = 'running';
      s.agents[agentId].exitCode = null;
      s.agents[agentId].signal = null;
      s.agents[agentId].lastOutput = [];
      s.agents[agentId].resumed = false;
      s.agents[agentId].generation += 1;
    }
  });
  markAgentSpawned(agentId);
}

export function addCustomAgent(agent: AgentDef): void {
  setStore((s) => {
    s.customAgents.push(agent);
  });
  void refreshAvailableAgents();
}

export function removeCustomAgent(agentId: string): void {
  setStore((s) => {
    s.customAgents = s.customAgents.filter((a) => a.id !== agentId);
  });
  void refreshAvailableAgents();
}

export function updateCustomAgent(agentId: string, updated: AgentDef): void {
  setStore((s) => {
    const idx = s.customAgents.findIndex((a) => a.id === agentId);
    if (idx >= 0) s.customAgents[idx] = updated;
  });
  void refreshAvailableAgents();
}

async function refreshAvailableAgents(): Promise<void> {
  const defaults = await invoke<AgentDef[]>('list_agents_cmd');
  const custom = getStore().customAgents;
  const customIds = new Set(custom.map((a) => a.id));
  setStore((s) => {
    s.availableAgents = [...defaults.filter((d) => !customIds.has(d.id)), ...custom];
  });
}
