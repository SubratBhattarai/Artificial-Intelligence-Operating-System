import { checkPublicHttpsUrl } from './webTarget';
import type { AgentManager } from '../agents/agentManager';
import type { AgentStore, MonitorStore, ReportStore } from '../agents/stores';
import type { AgentKind } from '../../shared/agents';
import type { Tool } from './types';

export function createStartAgentTool(
  getManager: () => AgentManager,
  store: AgentStore,
): Tool<{ goal: string; kind: AgentKind }, { id: string }> {
  return {
    name: 'start_agent',
    description:
      'Start a background agent that works on a goal on its own (research, or a multi-step task) while AI OS is open. The user approves starting it, and the agent still asks before anything consequential. Results appear in the Agents app.',
    riskTier: 'medium',
    permissions: ['agents:run'],
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', minLength: 5, maxLength: 1000 },
        kind: { type: 'string', enum: ['research', 'task'] },
      },
      required: ['goal', 'kind'],
      additionalProperties: false,
    },
    preview: (params) => ({
      title: params.kind === 'research' ? 'Start a research agent' : 'Start a task agent',
      lines: [
        params.goal,
        'It can use the tools you have allowed and asks you before anything consequential.',
        'It stops if you close AI OS.',
      ],
    }),
    async execute(params) {
      const agent = getManager().start(params.goal, params.kind);
      return { id: agent.id };
    },
    verify(_params, result) {
      const agent = store.get(result.id);
      return agent && agent.status !== 'failed'
        ? { ok: true, detail: `The agent is ${agent.status}. Progress is in the Agents app.` }
        : { ok: false, detail: 'The agent could not be started.' };
    },
    rollback(_params, result) {
      getManager().cancel(result.id);
    },
  };
}

export function createCreateMonitorTool(
  store: MonitorStore,
): Tool<{ url: string; label?: string; intervalMinutes?: number }, { id: string }> {
  return {
    name: 'create_monitor',
    description:
      'Watch a public web page for changes while AI OS is open (checked at most every few minutes; needs Web access). The user approves each monitor.',
    riskTier: 'low',
    permissions: ['web:read'],
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 8, maxLength: 2000 },
        label: { type: 'string', maxLength: 80 },
        intervalMinutes: { type: 'integer', minimum: 5, maximum: 1440 },
      },
      required: ['url'],
      additionalProperties: false,
    },
    preview(params) {
      const checked = checkPublicHttpsUrl(params.url);
      return {
        title: 'Watch a website',
        lines: [
          checked.ok ? params.url : (checked.error ?? 'Invalid address'),
          `Check every ${params.intervalMinutes ?? 60} minutes while AI OS is open`,
        ],
      };
    },
    async execute(params) {
      const checked = checkPublicHttpsUrl(params.url);
      if (!checked.ok) throw new Error(checked.error ?? 'Invalid address');
      const monitor = store.add({
        url: (checked.url as URL).toString(),
        label: params.label ?? (checked.url as URL).hostname,
        intervalMinutes: params.intervalMinutes ?? 60,
      });
      return { id: monitor.id };
    },
    verify(_params, result) {
      return store.get(result.id)
        ? { ok: true, detail: 'The website is now being watched.' }
        : { ok: false, detail: 'The monitor was not saved.' };
    },
    rollback(_params, result) {
      store.remove(result.id);
    },
  };
}

export function createSaveReportTool(
  reports: ReportStore,
): Tool<{ title: string; body: string }, { id: string }> {
  return {
    name: 'save_report',
    description: 'Save a written report (Markdown) in the Agents app › Reports. The user approves.',
    riskTier: 'low',
    permissions: ['notes:write'],
    sensitiveArgs: ['body'],
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 120 },
        body: { type: 'string', minLength: 1, maxLength: 40000 },
      },
      required: ['title', 'body'],
      additionalProperties: false,
    },
    preview: (params) => ({
      title: 'Save a report',
      lines: [params.title, `${params.body.length} characters`],
    }),
    async execute(params) {
      return { id: reports.create(params).id };
    },
    verify(params, result) {
      const stored = reports.get(result.id);
      return stored && stored.body === params.body.slice(0, 60_000)
        ? { ok: true, detail: 'The report is saved.' }
        : { ok: false, detail: 'The report was not found when read back.' };
    },
    rollback(_params, result) {
      reports.remove(result.id);
    },
  };
}
