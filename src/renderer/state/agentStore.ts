import { create } from 'zustand';
import type { AgentRecord } from '../../shared/agents';
import type { ApprovalInfo } from '../../shared/protocol';

interface AgentsState {
  agents: AgentRecord[];
  /** Approvals waiting on a click, by agent id. */
  approvals: Record<string, ApprovalInfo[]>;
  refresh: () => Promise<void>;
  start: (goal: string, kind: 'research' | 'task') => Promise<void>;
  cancel: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
}

export const useAgents = create<AgentsState>((set) => ({
  agents: [],
  approvals: {},
  async refresh() {
    const agents = await window.aios?.agents.list();
    if (agents) set({ agents });
  },
  async start(goal, kind) {
    const agent = await window.aios?.agents.start(goal, kind);
    if (agent)
      set((state) => ({ agents: [agent, ...state.agents.filter((a) => a.id !== agent.id)] }));
  },
  async cancel(id) {
    await window.aios?.agents.cancel(id);
  },
  async clearFinished() {
    const agents = await window.aios?.agents.clearFinished();
    if (agents) set({ agents });
  },
}));

let started = false;
export function initAgents(): void {
  if (started || !window.aios) return;
  started = true;
  void useAgents.getState().refresh();
  window.aios.agents.onEvent((event) => {
    if (event.type === 'agent_updated') {
      useAgents.setState((state) => ({
        agents: [event.agent, ...state.agents.filter((a) => a.id !== event.agent.id)].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      }));
    } else if (event.type === 'agent_approval') {
      useAgents.setState((state) => ({
        approvals: {
          ...state.approvals,
          [event.agentId]: [...(state.approvals[event.agentId] ?? []), event.approval],
        },
      }));
    } else {
      useAgents.setState((state) => ({
        approvals: {
          ...state.approvals,
          [event.agentId]: (state.approvals[event.agentId] ?? []).filter(
            (a) => a.id !== event.approvalId,
          ),
        },
      }));
    }
  });
}
