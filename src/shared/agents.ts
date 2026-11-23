/** Shared types for background agents, website monitors, reports and notifications. */

export type AgentKind = 'research' | 'task';
export type AgentStatus =
  'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentStep {
  at: number;
  kind: 'info' | 'thought' | 'tool' | 'result' | 'approval';
  text: string;
}

export interface AgentRecord {
  id: string;
  kind: AgentKind;
  goal: string;
  status: AgentStatus;
  createdAt: number;
  updatedAt: number;
  steps: AgentStep[];
  result?: string;
  error?: string;
  reportId?: string;
}

export const ACTIVE_AGENT_STATUSES: AgentStatus[] = ['queued', 'running', 'waiting_approval'];

export interface ReportRecord {
  id: string;
  title: string;
  /** Markdown. */
  body: string;
  createdAt: number;
  agentId?: string;
}

export interface MonitorRecord {
  id: string;
  url: string;
  label: string;
  intervalMinutes: number;
  createdAt: number;
  lastChecked?: number;
  lastChange?: number;
  /** What changed at the last change, in words. */
  changeSummary?: string;
  unseenChange: boolean;
  error?: string;
}

export type NotificationSource =
  'task' | 'calendar' | 'mail' | 'agent' | 'monitor' | 'security' | 'system';
export type Importance = 'urgent' | 'important' | 'info';

export interface NotificationItem {
  id: string;
  at: number;
  source: NotificationSource;
  title: string;
  body?: string;
  importance: Importance;
  read: boolean;
  /** Same key = same event, so it is only announced once. */
  key: string;
}

export type AgentEvent =
  | { type: 'agent_updated'; agent: AgentRecord }
  | { type: 'agent_approval'; agentId: string; approval: import('./protocol').ApprovalInfo }
  | { type: 'agent_approval_resolved'; agentId: string; approvalId: string };
