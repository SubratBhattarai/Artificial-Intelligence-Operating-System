/** Contracts for Mission Control: an objective, a plan you approve once, then agents run it step by step. */

export type MissionStatus =
  'planning' | 'awaiting_approval' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';
export type MissionStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface MissionStep {
  id: string;
  title: string;
  detail: string;
  status: MissionStepStatus;
  /** The agent doing this step; its approvals appear in the mission card. */
  agentId?: string;
  result?: string;
}

export interface MissionRecord {
  id: string;
  objective: string;
  status: MissionStatus;
  createdAt: number;
  updatedAt: number;
  steps: MissionStep[];
  error?: string;
  reportId?: string;
}

export const ACTIVE_MISSION_STATUSES: MissionStatus[] = [
  'planning',
  'awaiting_approval',
  'running',
  'paused',
];

export type MissionEvent = { type: 'mission_updated'; mission: MissionRecord };
