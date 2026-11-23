/** Contracts for the read-only Security Center. It observes and explains; it never kills or changes anything. */

export type FindingLevel = 'info' | 'medium' | 'high';

export interface SecurityFinding {
  /** Stable per event so a notification is raised once. */
  key: string;
  level: FindingLevel;
  title: string;
  /** Plain-language reason, so the user can judge it. */
  why: string;
}

export interface ProcessInfo {
  name: string;
  pid: number;
  path: string;
}

export interface Connection {
  proto: string;
  local: string;
  remote: string;
  state: string;
  pid: number;
}

export interface SecurityReport {
  scannedAt: number;
  processCount: number;
  listening: { port: number; process: string }[];
  established: { process: string; count: number }[];
  defender: 'on' | 'off' | 'unknown';
  firewall: 'on' | 'off' | 'unknown';
  findings: SecurityFinding[];
  note?: string;
}
